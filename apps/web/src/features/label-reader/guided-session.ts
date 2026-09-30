import { recalculateAnalysis } from './analyzer';
import { parseLabel } from './parsers';
import { isValidSscc } from './sscc';
import { focusedMaterial, TARGET_FIELDS } from './important-fields';
import type {
  DetectedCode,
  FieldReading,
  GuidedCaptureTarget,
  GuidedObservation,
  ImageQualityResult,
  LabelAnalysisResult,
  LabelFields,
  ReadingSource,
  SupplierCode
} from './types';

export const GUIDED_TARGETS: Record<GuidedCaptureTarget, { title: string; instruction: string }> = {
  code: {
    title: 'QR ou código',
    instruction: 'Aproxime a câmera do QR ou das barras e mantenha dentro da moldura.'
  },
  identity: {
    title: 'Material',
    instruction: 'Mostre só o nome do papel: PAU FERRO, BRANCO NÓRDICO IMP ou a descrição equivalente.'
  },
  quantity: {
    title: 'Quantidade de folhas',
    instruction: 'Aponte para o texto “folhas”, “quantity (pc)” ou equivalente e seu número.'
  },
  dimensions: {
    title: 'Dimensões',
    instruction: 'Aponte para as duas medidas em milímetros, por exemplo 1865 × 2765.'
  },
  lot: {
    title: 'Lote ou pallet',
    instruction: 'Aponte para o lote, número do pallet ou código de produção.'
  },
  area: { title: 'Área em m²', instruction: 'Enquadre somente o total em m², por exemplo 4.876,92. Não inclua o peso.' },
  production: { title: 'Produção', instruction: 'Enquadre a data de produção e, se houver, a hora logo abaixo.' },
  expiry: { title: 'Validade', instruction: 'Enquadre somente a data de validade, não a data de produção.' },
  reference: { title: 'Pedido / nº do pallet', instruction: 'Enquadre ORDER NUMBER / pedido ou NUM. DO PALLET com seu valor.' },
  overview: {
    title: 'Visão geral',
    instruction: 'Mostre a parte principal da etiqueta para guardar a evidência final.'
  }
};

export interface GuidedChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  value: string | null;
  required: boolean;
}

interface CandidateState {
  normalized: string;
  count: number;
  reading: FieldReading<unknown>;
}

export interface ObservationResult {
  result: LabelAnalysisResult;
  acceptedFields: (keyof LabelFields)[];
  newCode: boolean;
}

const EMPTY_QUALITY: ImageQualityResult = {
  width: 1,
  height: 1,
  megapixels: 0,
  brightness: 0,
  contrast: 0,
  sharpness: 0,
  canAnalyze: true,
  issues: []
};

export class GuidedScanAccumulator {
  private readonly startedAt = performance.now();
  private readonly candidates = new Map<keyof LabelFields, CandidateState>();
  private readonly codes = new Map<string, DetectedCode>();
  private readonly rawTexts: string[] = [];
  private result: LabelAnalysisResult;

  constructor(supplier: SupplierCode | null = null) {
    const parsed = parseLabel({ text: '', ocrConfidence: 0, codes: [] });
    if (supplier && supplier !== 'UNKNOWN') parsed.fields.supplier = { value: supplier, confidence: 1, sources: ['MANUAL'] };
    this.result = recalculateAnalysis(
      {
        parserName: parsed.parserName,
        parserVersion: parsed.parserVersion,
        fields: parsed.fields,
        rawText: '',
        detectedCodes: [],
        quality: EMPTY_QUALITY,
        validation: {
          calculatedAreaM2: null,
          areaDifferenceM2: null,
          areaConsistent: null,
          missingCriticalFields: []
        },
        overallConfidence: 0,
        reviewRequired: true,
        elapsedMs: 0
      },
      parsed.fields
    );
  }

  current(): LabelAnalysisResult {
    return this.result;
  }

  observe(observation: GuidedObservation): ObservationResult {
    let newCode = false;
    for (const code of observation.codes) {
      const key = `${code.format}:${code.value}`;
      if (!this.codes.has(key)) newCode = true;
      this.codes.set(key, code);
    }
    const codes = [...this.codes.values()];
    const supplierHint = supplierText(this.result.fields.supplier.value);
    const frameText = [supplierHint, observation.text.trim()].filter(Boolean).join('\n');
    const parsed = parseLabel({
      text: frameText,
      words: observation.words,
      ocrConfidence: observation.ocrConfidence,
      codes
    });
    const candidateFields = applyTargetedFallbacks(
      parsed.fields,
      observation.target,
      observation.text,
      observation.ocrConfidence
    );
    const merged = { ...this.result.fields } as LabelFields;
    const acceptedFields: (keyof LabelFields)[] = [];

    for (const fieldName of Object.keys(candidateFields) as (keyof LabelFields)[]) {
      const candidate = candidateFields[fieldName] as FieldReading<unknown>;
      if (candidate.value === null || candidate.value === '') continue;
      const trustedCode = candidate.sources.some((source) => source === 'QR' || source === 'BARCODE');
      if (!trustedCode && !TARGET_FIELDS[observation.target].includes(fieldName)) continue;
      const normalized = normalizeCandidate(candidate.value);
      const previous = this.candidates.get(fieldName);
      const count = previous?.normalized === normalized ? previous.count + 1 : 1;
      const best = !previous || previous.normalized !== normalized || candidate.confidence >= previous.reading.confidence
        ? candidate
        : previous.reading;
      this.candidates.set(fieldName, { normalized, count, reading: best });

      const current = merged[fieldName] as FieldReading<unknown>;
      const confirmed = trustedCode || count >= 2;
      const sameAsCurrent = current.value !== null && normalizeCandidate(current.value) === normalized;
      const strongerReplacement = confirmed && candidate.confidence >= current.confidence + 0.08;
      if (confirmed && (current.value === null || sameAsCurrent || strongerReplacement)) {
        const sources = [...new Set([...current.sources, ...candidate.sources])] as ReadingSource[];
        merged[fieldName] = {
          value: best.value,
          confidence: Math.max(current.confidence, best.confidence),
          sources
        } as never;
        if (!sameAsCurrent) acceptedFields.push(fieldName);
      }
    }

    const cleanText = observation.text.trim();
    if (cleanText && !this.rawTexts.includes(cleanText)) {
      this.rawTexts.push(cleanText);
      while (this.rawTexts.join('\n---\n').length > 80_000) this.rawTexts.shift();
    }
    const quality = betterQuality(this.result.quality, observation.quality);
    const parserName = parsed.parserName === 'UnknownLabelParser'
      ? parserForSupplier(merged.supplier.value)
      : parsed.parserName;
    this.result = recalculateAnalysis(
      {
        ...this.result,
        parserName,
        parserVersion: parsed.parserVersion,
        fields: merged,
        rawText: this.rawTexts.join('\n---\n'),
        detectedCodes: codes,
        quality,
        elapsedMs: Math.round(performance.now() - this.startedAt)
      },
      merged
    );
    return { result: this.result, acceptedFields, newCode };
  }
}

export function nextGuidedTarget(
  result: LabelAnalysisResult | null
): GuidedCaptureTarget {
  const fields = result?.fields;
  if (!fields || !fields.supplier.value || fields.supplier.value === 'UNKNOWN' || !fields.supplierMaterialName.value) return 'identity';
  if (!fields.quantitySheets.value) return 'quantity';
  if (!fields.widthMm.value || !fields.lengthMm.value) return 'dimensions';
  if (!fields.lotCode.value && !fields.supplierPalletCode.value) return 'lot';
  if (fields.supplier.value === 'IMPRESS' && !isValidSscc(fields.supplierSscc.value)) return 'code';
  return 'overview';
}

export function guidedChecklist(result: LabelAnalysisResult | null): GuidedChecklistItem[] {
  const fields = result?.fields;
  const value = (field: FieldReading<unknown> | undefined) =>
    field?.value === null || field?.value === undefined ? null : String(field.value);
  const lot = fields?.lotCode.value ?? fields?.supplierPalletCode.value ?? null;
  const dimensions = fields?.widthMm.value && fields.lengthMm.value
    ? `${fields.widthMm.value} × ${fields.lengthMm.value} mm`
    : null;
  return [
    { key: 'supplier', label: 'Fornecedor', complete: Boolean(fields?.supplier.value && fields.supplier.value !== 'UNKNOWN'), value: value(fields?.supplier), required: true },
    { key: 'material', label: 'Material', complete: Boolean(fields?.supplierMaterialName.value), value: value(fields?.supplierMaterialName), required: true },
    { key: 'quantity', label: 'Folhas', complete: Boolean(fields?.quantitySheets.value), value: value(fields?.quantitySheets), required: true },
    { key: 'dimensions', label: 'Dimensões', complete: Boolean(dimensions), value: dimensions, required: true },
    { key: 'lot', label: 'Lote / pallet', complete: Boolean(lot), value: lot ? String(lot) : null, required: true },
    ...(fields?.supplier.value === 'IMPRESS' ? [{
      key: 'sscc', label: 'Código de barras (SSCC)', complete: isValidSscc(fields.supplierSscc.value),
      value: value(fields.supplierSscc), required: true
    }] : [])
  ];
}

export function guidedCriticalComplete(result: LabelAnalysisResult | null): boolean {
  return guidedChecklist(result).filter((item) => item.required).every((item) => item.complete);
}

function applyTargetedFallbacks(
  fields: LabelFields,
  target: GuidedCaptureTarget,
  sourceText: string,
  ocrConfidence: number
): LabelFields {
  const text = sourceText.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const confidence = Math.max(0.55, Math.min(0.9, ocrConfidence));
  const next = { ...fields };
  if (/PESO|WEIGHT|\bKG\b/i.test(text) && !/FOLHAS|SHEETS|QUANT(?:ITY|IDADE)/i.test(text)
    && !next.quantitySheets.sources.some((source) => source === 'QR' || source === 'BARCODE')) {
    next.quantitySheets = { value: null, confidence: 0, sources: [] };
  }
  if ((target === 'code' || target === 'identity') && !next.supplier.value) {
    const supplier = detectSupplier(text);
    if (supplier) next.supplier = reading(supplier, confidence, 'OCR');
  }
  if (target === 'identity' && !next.supplierMaterialName.value) {
    const material = firstMatch(text, [
      /(?:PRODUTO|DESIGN|DESCRI(?:ÇÃO|CAO)\s+PRODUTO)\s*[:#-]?\s*\n?\s*([^\n]{3,80})/i,
      /(?:REFERENCE\s+DESCRIPTION|REFER[ÊE]NCIA\s+DESCRI(?:ÇÃO|CAO))\s*[:#-]?\s*\n?\s*([^\n]{3,80})/i
    ]);
    const name = material ?? (next.supplier.value ? focusedMaterial(sourceText) : null);
    if (name) next.supplierMaterialName = reading(name, Math.min(confidence, material ? 0.9 : 0.75), 'OCR');
  }
  if (target === 'quantity' && !next.quantitySheets.value) {
    const quantity = firstMatch(text, [
      /(?:QDE\.?\s+DE\s+FOLHAS?|QUANTIDADE\s*(?:DE\s+FOLHAS?)?|QUANTITY\s*(?:SHEETS?|\(PC\)|PC))\D{0,20}(\d{2,5})/i,
      /(?:FOLHAS?|SHEETS?)\s*[:#-]?\s*(\d{2,5})/i
    ]);
    if (quantity) next.quantitySheets = reading(Number(quantity), confidence, 'OCR');
  }
  if (target === 'dimensions' && (!next.widthMm.value || !next.lengthMm.value)) {
    const match = /(?<!\d)(\d{4})\s*(?:[xX×/]|MM\s+)?\s*(\d{4})(?!\d)/i.exec(text);
    if (match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (validDimension(first) && validDimension(second)) {
        next.widthMm = reading(Math.min(first, second), confidence, 'OCR');
        next.lengthMm = reading(Math.max(first, second), confidence, 'OCR');
      }
    }
  }
  if (target === 'quantity' && !next.quantitySheets.value && next.supplier.value && !/PESO|WEIGHT|\bKG\b/i.test(text)) {
    const candidates = [...text.matchAll(/^\s*(\d{2,5})\s*$/gm)];
    if (candidates.length === 1) {
      // Explicit close-up of one selected field is tentative, never 100% confidence.
      next.quantitySheets = reading(Number(candidates[0][1]), Math.min(confidence, 0.65), 'OCR');
    }
  }
  if (target === 'area' && !next.declaredAreaM2.value) {
    const match = /(?<![\d.,])(\d{1,7}(?:[.,]\d{3})*[.,]\d{2})(?![\d.,])/.exec(text);
    if (match && !/PESO|WEIGHT|\bKG\b/i.test(text)) {
      const compact = match[1];
      const value = Number(compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : compact);
      if (value > 0) next.declaredAreaM2 = reading(value, Math.min(confidence, 0.75), 'OCR');
    }
  }
  if (target === 'production' || target === 'expiry') {
    const dates = [...text.matchAll(/\b(\d{2})[./-](\d{2})[./-](\d{2,4})\b/g)];
    if (dates.length === 1) {
      const [, day, month, rawYear] = dates[0];
      const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
      const date = `${year}-${month}-${day}`;
      const parsed = new Date(`${date}T12:00:00Z`);
      if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(date)) {
        if (target === 'expiry' && !next.expiresOn.value) next.expiresOn = reading(date, Math.min(confidence, 0.8), 'OCR');
        if (target === 'production' && !next.manufacturedAt.value) {
          const time = /(?<![\d:])([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?![\d:])/.exec(text);
          next.manufacturedAt = reading(time ? `${date}T${time[1]}:${time[2]}:${time[3] ?? '00'}` : date, Math.min(confidence, 0.8), 'OCR');
        }
      }
    }
  }
  if (target === 'reference' && next.supplier.value === 'IMPRESS') {
    const order = !/E-\d/i.test(text) ? /(?<!\d)(\d{6})\s*\/\s*(\d(?:[ \t]*\d){1,2})(?!\d)/.exec(text) : null;
    if (!next.supplierOrderNumber.value && order) next.supplierOrderNumber = reading(`${order[1]}/${order[2].replace(/\s/g, '')}`, Math.min(confidence, 0.65), 'OCR');
    if (!next.palletNumber.value && /^\d{1,3}$/.test(text)) next.palletNumber = reading(Number(text), Math.min(confidence, 0.6), 'OCR');
  }
  if (target === 'lot' && !next.lotCode.value && !next.supplierPalletCode.value) {
    const lot = firstMatch(text, next.supplier.value === 'SCHATTDECOR' ? [
      /\b(D\d{8,12})\b/i
    ] : [
      /(?:LOTE|BATCH)\s*(?:BARCODE)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/.-]{5,30})/i
    ]);
    if (lot) next.lotCode = reading(lot, confidence, 'OCR');
  }
  return next;
}

function detectSupplier(text: string): SupplierCode | null {
  if (/IMPRESS/i.test(text)) return 'IMPRESS';
  if (/\bSCHAT[TIL1]DECOR\b/i.test(text)) return 'SCHATTDECOR';
  if (/INTERPRINT/i.test(text)) return 'INTERPRINT';
  return null;
}

function firstMatch(text: string, expressions: RegExp[]): string | null {
  for (const expression of expressions) {
    const value = expression.exec(text)?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function reading<T>(value: T, confidence: number, source: ReadingSource): FieldReading<T> {
  return { value, confidence, sources: [source] };
}

function validDimension(value: number): boolean {
  return value >= 1000 && value <= 4000;
}

function normalizeCandidate(value: unknown): string {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function supplierText(supplier: SupplierCode | null): string {
  return supplier && supplier !== 'UNKNOWN' ? supplier : '';
}

function parserForSupplier(supplier: SupplierCode | null): string {
  if (!supplier || supplier === 'UNKNOWN') return 'GuidedLabelParser';
  return `${supplier[0]}${supplier.slice(1).toLowerCase()}LabelParser`;
}

function betterQuality(current: ImageQualityResult, next: ImageQualityResult): ImageQualityResult {
  if (current.width <= 1) return next;
  return next.sharpness > current.sharpness ? next : current;
}
