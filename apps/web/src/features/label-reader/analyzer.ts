import { readCodes } from './code-reader';
import { createOcrCanvas, loadImage } from './image';
import { extractText } from './ocr';
import { parseLabel } from './parsers';
import { checkImageQuality } from './quality';
import { isValidSscc } from './sscc';
import type {
  AnalysisProgress,
  FieldReading,
  LabelAnalysisResult,
  LabelFields
} from './types';

export class ImageQualityError extends Error {
  constructor(public readonly result: ReturnType<typeof checkImageQuality>) {
    super(result.issues.map((issue) => issue.message).join(' '));
  }
}

export async function analyzeLabel(
  file: File,
  onProgress: (progress: AnalysisProgress) => void
): Promise<LabelAnalysisResult> {
  const startedAt = performance.now();
  onProgress({ stage: 'quality', progress: 0.04, message: 'Avaliando foco, luz e resolução…' });
  const image = await loadImage(file);
  const quality = checkImageQuality(image);
  if (!quality.canAnalyze) {
    throw new ImageQualityError(quality);
  }

  const canvas = createOcrCanvas(image);
  onProgress({ stage: 'codes', progress: 0.16, message: 'Procurando QR e código de barras…' });
  const detectedCodes = await readCodes(image, canvas);
  onProgress({ stage: 'ocr', progress: 0.25, message: 'Iniciando leitura dos textos…' });
  const ocr = await extractText(canvas, (progress, message) => {
    onProgress({ stage: 'ocr', progress: 0.25 + progress * 0.58, message });
  });

  onProgress({ stage: 'parsing', progress: 0.88, message: 'Identificando fornecedor e conferindo valores…' });
  const parsed = parseLabel({ text: ocr.text, ocrConfidence: ocr.confidence, codes: detectedCodes });
  const validation = validateFields(parsed.fields);
  const overallConfidence = calculateOverallConfidence(parsed.fields, validation.areaConsistent);
  const reviewRequired =
    validation.missingCriticalFields.length > 0 ||
    validation.areaConsistent === false ||
    criticalReadings(parsed.fields).some((field) => field.confidence < 0.8);

  onProgress({ stage: 'complete', progress: 1, message: 'Leitura concluída. Revise os campos antes de aprovar.' });
  return {
    parserName: parsed.parserName,
    parserVersion: parsed.parserVersion,
    fields: parsed.fields,
    rawText: ocr.text,
    detectedCodes,
    quality,
    validation,
    overallConfidence,
    reviewRequired,
    elapsedMs: Math.round(performance.now() - startedAt)
  };
}

export function recalculateAnalysis(
  result: LabelAnalysisResult,
  fields: LabelFields
): LabelAnalysisResult {
  const validation = validateFields(fields);
  const overallConfidence = calculateOverallConfidence(fields, validation.areaConsistent);
  const reviewRequired =
    validation.missingCriticalFields.length > 0 ||
    validation.areaConsistent === false ||
    criticalReadings(fields).some((field) => field.confidence < 0.8);
  return { ...result, fields, validation, overallConfidence, reviewRequired };
}

function validateFields(fields: LabelFields) {
  const width = fields.widthMm.value;
  const length = fields.lengthMm.value;
  const quantity = fields.quantitySheets.value;
  const declaredArea = fields.declaredAreaM2.value;
  const calculatedAreaM2 =
    width && length && quantity ? (width / 1000) * (length / 1000) * quantity : null;
  const areaDifferenceM2 =
    calculatedAreaM2 !== null && declaredArea !== null
      ? Math.abs(calculatedAreaM2 - declaredArea)
      : null;
  const tolerance = calculatedAreaM2 === null ? null : Math.max(0.05, calculatedAreaM2 * 0.001);
  const areaConsistent =
    areaDifferenceM2 === null || tolerance === null ? null : areaDifferenceM2 <= tolerance;
  const missingCriticalFields: string[] = [];
  if (fields.supplier.value === null || fields.supplier.value === 'UNKNOWN') {
    missingCriticalFields.push('Fornecedor');
  }
  if (!fields.supplierMaterialName.value) missingCriticalFields.push('Material');
  if (!fields.lotCode.value && !fields.supplierPalletCode.value) missingCriticalFields.push('Lote/código');
  if (fields.supplier.value === 'IMPRESS' && !isValidSscc(fields.supplierSscc.value)) {
    missingCriticalFields.push('Código de barras (SSCC)');
  }
  if (fields.supplierSscc.value && !isValidSscc(fields.supplierSscc.value) && fields.supplier.value !== 'IMPRESS') {
    missingCriticalFields.push('SSCC válido');
  }
  if (!fields.quantitySheets.value) missingCriticalFields.push('Quantidade');
  if (!fields.widthMm.value || !fields.lengthMm.value) missingCriticalFields.push('Dimensões');
  return { calculatedAreaM2, areaDifferenceM2, areaConsistent, missingCriticalFields };
}

function criticalReadings(fields: LabelFields): FieldReading<unknown>[] {
  return [
    fields.supplier,
    fields.supplierMaterialName,
    fields.lotCode.value ? fields.lotCode : fields.supplierPalletCode,
    fields.quantitySheets,
    fields.widthMm,
    fields.lengthMm,
    ...(fields.supplier.value === 'IMPRESS' ? [fields.supplierSscc] : [])
  ];
}

function calculateOverallConfidence(fields: LabelFields, areaConsistent: boolean | null): number {
  const readings = criticalReadings(fields);
  const average = readings.reduce((sum, field) => {
    if (field.value === null || field.value === '' || field.value === 'UNKNOWN') return sum;
    if (field === fields.supplierSscc && !isValidSscc(fields.supplierSscc.value)) return sum;
    return sum + field.confidence;
  }, 0) / readings.length;
  // Estimated confidence is not a guarantee of correctness. Area validation never adds a bonus.
  const validated = areaConsistent === false ? Math.min(average, 0.79) : average;
  return Math.min(0.99, Math.round(validated * 100) / 100);
}
