export type SupplierCode = 'IMPRESS' | 'SCHATTDECOR' | 'INTERPRINT' | 'UNKNOWN';
export type ReadingSource = 'QR' | 'BARCODE' | 'OCR' | 'CALCULATION' | 'MANUAL';

export interface FieldReading<T> {
  value: T | null;
  confidence: number;
  sources: ReadingSource[];
}

export interface LabelFields {
  supplier: FieldReading<SupplierCode>;
  supplierMaterialName: FieldReading<string>;
  supplierPalletCode: FieldReading<string>;
  supplierOrderNumber: FieldReading<string>;
  palletNumber: FieldReading<number>;
  supplierSscc: FieldReading<string>;
  lotCode: FieldReading<string>;
  quantitySheets: FieldReading<number>;
  widthMm: FieldReading<number>;
  lengthMm: FieldReading<number>;
  declaredAreaM2: FieldReading<number>;
  manufacturedAt: FieldReading<string>;
  expiresOn: FieldReading<string>;
  orientation: FieldReading<string>;
}

export interface QualityIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ImageQualityResult {
  width: number;
  height: number;
  megapixels: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  canAnalyze: boolean;
  issues: QualityIssue[];
}

export interface DetectedCode {
  value: string;
  format: string;
}

export interface LabelValidation {
  calculatedAreaM2: number | null;
  areaDifferenceM2: number | null;
  areaConsistent: boolean | null;
  missingCriticalFields: string[];
}

export interface LabelAnalysisResult {
  parserName: string;
  parserVersion: string;
  fields: LabelFields;
  rawText: string;
  detectedCodes: DetectedCode[];
  quality: ImageQualityResult;
  validation: LabelValidation;
  overallConfidence: number;
  reviewRequired: boolean;
  elapsedMs: number;
}

export interface AnalysisProgress {
  stage: 'quality' | 'codes' | 'ocr' | 'parsing' | 'complete';
  progress: number;
  message: string;
}

export type GuidedCaptureTarget =
  | 'code'
  | 'identity'
  | 'quantity'
  | 'dimensions'
  | 'lot'
  | 'area'
  | 'production'
  | 'expiry'
  | 'reference'
  | 'overview';

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface CaptureEvidence {
  target: GuidedCaptureTarget;
  fieldNames: (keyof LabelFields)[];
  file: File;
  quality: ImageQualityResult;
  capturedAt: string;
}

export interface GuidedObservation {
  text: string;
  words?: OcrWord[];
  ocrConfidence: number;
  codes: DetectedCode[];
  quality: ImageQualityResult;
  target: GuidedCaptureTarget;
  capturedAt: string;
}
