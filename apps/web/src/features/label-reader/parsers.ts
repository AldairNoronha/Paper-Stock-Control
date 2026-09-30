import { ssccFromCodes, ssccFromText } from './sscc';
import { spatialImportantFields } from './important-fields';
import type {
  DetectedCode,
  FieldReading,
  LabelFields,
  OcrWord,
  ReadingSource,
  SupplierCode
} from './types';

interface ParserInput {
  text: string;
  ocrConfidence: number;
  codes: DetectedCode[];
  words?: OcrWord[];
}

interface LabelParser {
  name: string;
  version: string;
  matches(input: ParserInput): boolean;
  parse(input: ParserInput): LabelFields;
}

const empty = <T>(): FieldReading<T> => ({ value: null, confidence: 0, sources: [] });
const reading = <T>(
  value: T | null,
  confidence: number,
  ...sources: ReadingSource[]
): FieldReading<T> => ({ value, confidence: value === null ? 0 : confidence, sources: value === null ? [] : sources });

export function emptyFields(): LabelFields {
  return {
    supplier: empty<SupplierCode>(),
    supplierMaterialName: empty<string>(),
    supplierPalletCode: empty<string>(),
    supplierOrderNumber: empty<string>(),
    palletNumber: empty<number>(),
    supplierSscc: empty<string>(),
    lotCode: empty<string>(),
    quantitySheets: empty<number>(),
    widthMm: empty<number>(),
    lengthMm: empty<number>(),
    declaredAreaM2: empty<number>(),
    manufacturedAt: empty<string>(),
    expiresOn: empty<string>(),
    orientation: empty<string>()
  };
}

const impressParser: LabelParser = {
  name: 'ImpressLabelParser',
  version: '1.1.0',
  matches: ({ text, codes }) =>
    /IMPRESS/i.test(text) ||
    /E-\d{5,}/i.test(text) ||
    codes.some((code) => code.value.includes(';') && /E-\d{5,}/i.test(code.value)),
  parse(input) {
    const fields = parseImpressOcr(input);
    const qr = input.codes.find((code) => code.value.includes(';'))?.value;
    if (!qr) return fields;
    const parts = qr.split(';').map((part) => part.trim());
    const dimensions = parseDimensions(parts[0] ?? '');
    return mergeFields(fields, {
      ...emptyFields(),
      supplier: reading('IMPRESS', 1, 'QR'),
      supplierMaterialName: reading(parts[0] || null, 0.99, 'QR'),
      quantitySheets: reading(parseInteger(parts[2]), 1, 'QR'),
      supplierPalletCode: reading(parts[3] || null, 1, 'QR'),
      widthMm: reading(dimensions?.width ?? null, 0.99, 'QR'),
      lengthMm: reading(dimensions?.length ?? null, 0.99, 'QR'),
      manufacturedAt: reading(parseDate(parts[4], true), 0.98, 'QR'),
      expiresOn: reading(parseDate(parts[5]), 0.98, 'QR')
    });
  }
};

const schattdecorParser: LabelParser = {
  name: 'SchattdecorLabelParser',
  version: '1.3.0',
  matches: ({ text, codes }) =>
    /\bSCHAT[TIL1]DECOR\b/i.test(text) ||
    codes.some((code) => /^D\d{8,12}$/i.test(code.value)) ||
    codes.some((code) => code.value.split('|').length >= 7),
  parse(input) {
    const fields = parseSchattdecorOcr(input);
    const qr = input.codes.find((code) => code.value.split('|').length >= 7)?.value;
    if (!qr) return fields;
    const parts = qr.split('|').map((part) => part.trim());
    return mergeFields(fields, {
      ...emptyFields(),
      supplier: reading('SCHATTDECOR', 1, 'QR'),
      supplierMaterialName: reading(parts[0] || null, 1, 'QR'),
      lotCode: reading(parts[1] || null, 1, 'QR'),
      quantitySheets: reading(parseInteger(parts[2]), 1, 'QR'),
      widthMm: reading(parseInteger(parts[3]), 1, 'QR'),
      lengthMm: reading(parseInteger(parts[4]), 1, 'QR'),
      declaredAreaM2: reading(parseLocalizedNumber(parts[5]), 0.99, 'QR'),
      orientation: reading(parts[6]?.toUpperCase() || null, 0.99, 'QR')
    });
  }
};

const interprintParser: LabelParser = {
  name: 'InterprintLabelParser',
  version: '1.0.0',
  matches: ({ text }) =>
    /INTERPRINT|MATER(?:IAL|NAL)\s*NR|REFERENCE\s+DESCRIPTION|PESO\s+(?:L[ÍI]QUIDO|BRUTO)/i.test(text),
  parse(input) {
    const confidence = ocrFieldConfidence(input.ocrConfidence);
    const text = normalizeText(input.text);
    const dimensions = parseDimensions(text);
    const lot = firstMatch(text, [
      /(?:LOTE|BATCH)(?:\s+BARCODE)?\s*[:#-]?\s*(\d{8,14})/i,
      /\b(\d{10})\b/
    ]);
    const barcodeLot = input.codes.find((code) => /^\d{8,14}$/.test(code.value))?.value;
    const material = firstMatch(text, [
      /(?:REFER[ÊE]NCIA\s+DESCRI[ÇC][ÃA]O|REFERENCE\s+DESCRIPTION)\s*[:#-]?\s*\n?\s*([A-ZÀ-Ý][A-ZÀ-Ý\s-]{3,40}?)(?=\s+\d{4}\s*[Xx/])/i,
      /(?:^|\s)I?(FREIJ[ÓO]\s+TUCUM[ÃA])\b/i
    ]);
    const quantity =
      parseInteger(
        firstMatch(text, [
          /(?:QUANT\.?|QUANTIDADE|QUANTITY)\s*(?:\(PC\))?\s*[:#-]?\s*(\d{2,5})/i,
          /\b\d{8,14}\s+(\d{2,5})\s*$/m
        ])
      ) ?? standaloneQuantity(text, dimensions);
    return {
      ...emptyFields(),
      supplier: reading('INTERPRINT', 0.99, 'OCR'),
      supplierMaterialName: reading(cleanMaterial(material), confidence, 'OCR'),
      lotCode: barcodeLot
        ? reading(barcodeLot, 0.98, 'BARCODE')
        : reading(lot, confidence, 'OCR'),
      quantitySheets: reading(quantity, confidence, 'OCR'),
      widthMm: reading(dimensions?.width ?? null, confidence, 'OCR'),
      lengthMm: reading(dimensions?.length ?? null, confidence, 'OCR'),
      declaredAreaM2: reading(
        parseLocalizedNumber(
          firstMatch(text, [
            /(?:QUANTIDADE|QUANTITY)\s*\(?M[²2]\)?\s*[:#-]?\s*([\d.,]+)/i,
            /\b([45][.]?\d{3}[,.]\d{2})\b/
          ])
        ),
        confidence,
        'OCR'
      ),
      manufacturedAt: reading(
        parseDate(
          firstMatch(text, [
            /(?:DATA\s+PRODU[ÇC][ÃA]O|PROD\.?\s*DATE)\s*[:#-]?\s*(\d{2}[./-]\d{2}[./-]\d{2,4})/i,
            /\b(\d{2}[./-]\d{2}[./-]\d{4})\b/
          ])
        ),
        confidence,
        'OCR'
      ),
      orientation: reading(/\bS?UPERIOR\b/i.test(text) ? 'SUPERIOR' : null, confidence, 'OCR')
    };
  }
};

const parsers: LabelParser[] = [impressParser, schattdecorParser, interprintParser];

export function parseLabel(input: ParserInput): {
  parserName: string;
  parserVersion: string;
  fields: LabelFields;
} {
  const parser = parsers.find((candidate) => candidate.matches(input));
  const fields = parser ? parser.parse(input) : parseUnknown(input);
  if (input.words?.length) {
    const spatial = spatialImportantFields(input.words, fields.supplier.value);
    const fromCode = (key: keyof LabelFields) => fields[key].sources.some((source) => source === 'QR' || source === 'BARCODE');
    if (fields.supplier.value === 'SCHATTDECOR' && !spatial.quantitySheets
      && !fromCode('quantitySheets')) {
      fields.quantitySheets = empty<number>();
    }
    // Never use OCR text order to infer the other column: it may be the quantity.
    if (spatial.widthMm?.value && !spatial.lengthMm?.value && !fromCode('lengthMm')) fields.lengthMm = empty<number>();
    if (spatial.lengthMm?.value && !spatial.widthMm?.value && !fromCode('widthMm')) fields.widthMm = empty<number>();
    if (spatial.quantitySheets?.value) {
      if (!spatial.widthMm && fields.widthMm.value === spatial.quantitySheets.value && !fromCode('widthMm')) fields.widthMm = empty<number>();
      if (!spatial.lengthMm && fields.lengthMm.value === spatial.quantitySheets.value && !fromCode('lengthMm')) fields.lengthMm = empty<number>();
    }
    for (const key of Object.keys(spatial) as (keyof LabelFields)[]) {
      // Structured codes must not be overwritten by an unrelated OCR column.
      if (!fromCode(key)) fields[key] = spatial[key] as never;
    }
  }
  const barcodeSscc = ssccFromCodes(input.codes);
  fields.supplierSscc = barcodeSscc
    ? reading(barcodeSscc, 0.99, 'BARCODE')
    : reading(ssccFromText(input.text), ocrFieldConfidence(input.ocrConfidence), 'OCR');
  return {
    parserName: parser?.name ?? 'UnknownLabelParser',
    parserVersion: parser?.version ?? '1.0.0',
    fields
  };
}

function parseImpressOcr(input: ParserInput): LabelFields {
  const text = normalizeText(input.text);
  const confidence = ocrFieldConfidence(input.ocrConfidence);
  const dimensions = parseDimensions(text);
  return {
    ...emptyFields(),
    supplier: reading('IMPRESS', 0.96, 'OCR'),
    supplierMaterialName: reading(
      firstMatch(text, [/(\d{4,6}\s+UNICOLOR[^\n]{0,80})/i, /PRODUTO\s*\n?\s*([^\n]{3,80})/i]),
      confidence,
      'OCR'
    ),
    supplierPalletCode: reading(
      firstMatch(text, [/\b(E-\d{5,}\/\d{2,3}(?:-[A-Z0-9]+){3,})(?![A-Z0-9./-])/i]),
      confidence,
      'OCR'
    ),
    supplierOrderNumber: reading(
      firstMatch(text, [/(?:ORDER\s+NUMBER|N[ÚU]MERO\s+(?:DO\s+)?PEDIDO|ORDEM)\D{0,70}(\d{5,}\/\d{2,3})(?!\d)/i]), confidence, 'OCR'
    ),
    palletNumber: reading(
      parseInteger(firstMatch(text, [/(?:NUM\.?\s*(?:OF|DO)?\s*PALLET|N[ÚU]M(?:ERO)?\.?\s*(?:DO)?\s*PALLET)\s*[:#-]?\s*(\d{1,3})(?!\d)/i])), confidence, 'OCR'
    ),
    lotCode: reading(
      firstMatch(text, [/(?:LOTE|BATCH)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/.-]{3,40})/i]),
      confidence,
      'OCR'
    ),
    quantitySheets: reading(
      parseInteger(firstMatch(text, [/(?:QUANTITY\s+SHEETS?\s*(?:\(\s*QTD\.?\s*FOLHAS?\s*\))?|QTD\.?\s*FOLHAS?)\s*[:#-]?\s*(\d{2,5})/i])),
      confidence,
      'OCR'
    ),
    widthMm: reading(dimensions?.width ?? null, confidence, 'OCR'),
    lengthMm: reading(dimensions?.length ?? null, confidence, 'OCR'),
    declaredAreaM2: reading(
      parseLocalizedNumber(firstMatch(text, [/(?:QUANTITY|QUANTIDADE)\s*\(?M[²2]\)?\s*[:#-]?\s*([\d.,]+)/i])),
      confidence,
      'OCR'
    ),
    manufacturedAt: reading(parseDate(firstMatch(text, [/(?:DATA\s+(?:DE\s+)?PRODU[ÇC][ÃA]O|PRODUCTION\s+DATE|DATA\s+OF\s+PROD[^\n]*|DATE\s+OF\s+PROD[^\n]*)\s*[:#-]?\s*(\d{2}[./-]\d{2}[./-]\d{2,4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/i]), true), confidence, 'OCR'),
    expiresOn: reading(parseDate(firstMatch(text, [/(?:VALIDADE|VALIDITY|VALID\s+UNTIL|VALLET)\s*(?:\/\s*DATA\s+VALIDADE)?\s*[:#-]?\s*(\d{2}[./-]\d{2}[./-]\d{2,4})/i])), confidence, 'OCR')
  };
}

function parseSchattdecorOcr(input: ParserInput): LabelFields {
  const text = normalizeText(input.text);
  const confidence = ocrFieldConfidence(input.ocrConfidence);
  const dimensions = parseDimensions(text);
  const barcodeLot = input.codes.find((code) => /^D\d{8,12}$/i.test(code.value))?.value;
  const quantity =
    parseInteger(firstMatch(text, [/(?:QDE\.?\s+DE\s+FOLHAS?|QUANTITY)\s*[:#-]?\s*(\d{2,5})/i]));
  return {
    ...emptyFields(),
    supplier: reading('SCHATTDECOR', barcodeLot ? 0.99 : /SCHATTDECOR/i.test(text) ? 0.98 : 0.7, barcodeLot ? 'BARCODE' : 'OCR'),
    supplierMaterialName: reading(
      firstMatch(text, [
        /(?:DESCRI[ÇC][ÃA]O\s+PRODUTO|DESIGN)\s*[:#-]?\s*\n?\s*([A-ZÀ-Ý][A-ZÀ-Ý\s-]{2,30})/i,
        /\b(CONV[ÉE]S)\b/i
      ]),
      confidence,
      'OCR'
    ),
    lotCode: barcodeLot
      ? reading(barcodeLot, 0.99, 'BARCODE')
      : reading(firstMatch(text, [/\b(D\d{8,12})\b/i]), confidence, 'OCR'),
    supplierPalletCode: reading(firstMatch(text, [/\b(\d{1,3}-\d{3,6}-[A-Z])\b/i]), confidence, 'OCR'),
    quantitySheets: reading(quantity, confidence, 'OCR'),
    widthMm: reading(dimensions?.width ?? null, confidence, 'OCR'),
    lengthMm: reading(dimensions?.length ?? null, confidence, 'OCR'),
    declaredAreaM2: reading(
      parseLocalizedNumber(firstMatch(text, [/(?:TOTAL\s+M[²2]|AREA)\s*[:#-]?\s*([\d.,]+)/i])),
      confidence,
      'OCR'
    ),
    orientation: reading(/SUPERIOR/i.test(text) ? 'SUPERIOR' : null, confidence, 'OCR')
  };
}

function parseUnknown(input: ParserInput): LabelFields {
  const fields = emptyFields();
  const dimensions = parseDimensions(input.text);
  const confidence = ocrFieldConfidence(input.ocrConfidence) * 0.8;
  fields.widthMm = reading(dimensions?.width ?? null, confidence, 'OCR');
  fields.lengthMm = reading(dimensions?.length ?? null, confidence, 'OCR');
  return fields;
}

function mergeFields(primary: LabelFields, preferred: LabelFields): LabelFields {
  return Object.fromEntries(
    Object.keys(primary).map((key) => {
      const field = key as keyof LabelFields;
      const first = primary[field];
      const second = preferred[field];
      return [field, second.confidence >= first.confidence ? second : first];
    })
  ) as unknown as LabelFields;
}

function normalizeText(value: string): string {
  return value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
}

function firstMatch(text: string, expressions: RegExp[]): string | null {
  for (const expression of expressions) {
    const value = expression.exec(text)?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function parseInteger(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLocalizedNumber(value: string | undefined | null): number | null {
  if (!value) return null;
  const compact = value.replace(/\s/g, '');
  const normalized = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDimensions(value: string): { width: number; length: number } | null {
  const matches = value.matchAll(/(?<!\d)(\d{4})\s*(?:[xX×/]|MM\s+)?\s*(\d{4})(?!\d)\s*(?:MM)?/gi);
  for (const match of matches) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first >= 1000 && first <= 4000 && second >= 1000 && second <= 4000) {
      return { width: Math.min(first, second), length: Math.max(first, second) };
    }
  }
  return null;
}

function standaloneQuantity(
  text: string,
  dimensions: { width: number; length: number } | null
): number | null {
  const candidates = [...text.matchAll(/^\s*(\d{2,5})\s*$/gm)]
    .map((match) => Number(match[1]))
    .filter(
      (value) =>
        value >= 50 &&
        value <= 2000 &&
        value !== dimensions?.width &&
        value !== dimensions?.length
    );
  return candidates.at(-1) ?? null;
}

function parseDate(value: string | undefined | null, includeTime = false): string | null {
  if (!value) return null;
  const match = /(\d{2})[./-](\d{2})[./-](\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const date = `${year}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || !parsed.toISOString().startsWith(date)) return null;
  const validTime = match[4] && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6] ?? 0) < 60;
  return includeTime && validTime ? `${date}T${match[4]}:${match[5]}:${match[6] ?? '00'}` : date;
}

function cleanMaterial(value: string | null): string | null {
  return value?.replace(/\s+/g, ' ').trim().replace(/^I(?=FREIJ)/i, '') || null;
}

function ocrFieldConfidence(ocrConfidence: number): number {
  return Math.max(0.55, Math.min(0.9, ocrConfidence));
}
