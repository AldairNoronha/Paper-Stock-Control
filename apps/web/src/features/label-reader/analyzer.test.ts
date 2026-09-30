import { describe, expect, it } from 'vitest';

import { recalculateAnalysis } from './analyzer';
import { emptyFields, parseLabel } from './parsers';
import type { DetectedCode, LabelAnalysisResult, LabelFields } from './types';

const qr: DetectedCode = {
  format: 'QR_CODE',
  value: '90113 UNICOLOR IP441 2760x1860mm;0;845;E-102410/270-15-I-02;23.08.2026 20:41;21/11/26'
};

export function analysisFixture(fields: LabelFields, codes: DetectedCode[] = [qr]): LabelAnalysisResult {
  return recalculateAnalysis({
    parserName: 'ImpressLabelParser', parserVersion: '1.1.0', fields,
    rawText: '', detectedCodes: codes,
    quality: { width: 1280, height: 960, megapixels: 1.2288,
      brightness: 160, contrast: 40, sharpness: 60, canAnalyze: true, issues: [] },
    validation: { calculatedAreaM2: null, areaDifferenceM2: null, areaConsistent: null, missingCriticalFields: [] },
    overallConfidence: 0, reviewRequired: true, elapsedMs: 1000
  }, fields);
}

describe('label analysis completeness and confidence', () => {
  it('reproduces the reported QR-only Impress result as partial and requires its barcode', () => {
    const { fields } = parseLabel({ text: '', codes: [qr], ocrConfidence: 0 });
    const result = analysisFixture(fields);

    expect(fields.supplierPalletCode.value).toBe('E-102410/270-15-I-02');
    expect(fields.lotCode.value).toBeNull();
    expect(result.overallConfidence).toBeLessThan(0.9);
    expect(result.reviewRequired).toBe(true);
    expect(result.validation.missingCriticalFields).toContain('Código de barras (SSCC)');
  });

  it('counts missing critical fields in the score instead of averaging only a detected supplier', () => {
    const fields = emptyFields();
    fields.supplier = { value: 'IMPRESS', confidence: 1, sources: ['QR'] };
    expect(analysisFixture(fields).overallConfidence).toBeLessThan(0.2);
  });

  it('completes Impress using both codes without presenting estimated confidence as certainty', () => {
    const { fields } = parseLabel({ text: '', codes: [qr,
      { format: 'CODE_128', value: '00378989959000344929' }], ocrConfidence: 0 });
    const result = analysisFixture(fields);
    expect(result.validation.missingCriticalFields).toEqual([]);
    expect(result.overallConfidence).toBe(0.99);
    expect(fields.supplierSscc.value).toBe('378989959000344929');
    expect(fields.supplierSscc.sources).toEqual(['BARCODE']);
    expect(fields.lotCode.value).toBeNull();
  });

  it('requires review when area contradicts high-confidence QR fields and never grants an area bonus', () => {
    const { fields } = parseLabel({ text: '', codes: [qr,
      { format: 'CODE_128', value: '00378989959000344929' }], ocrConfidence: 0 });
    fields.declaredAreaM2 = { value: 100, confidence: 1, sources: ['MANUAL'] };
    const result = analysisFixture(fields);
    expect(result.validation.areaConsistent).toBe(false);
    expect(result.reviewRequired).toBe(true);
    expect(result.overallConfidence).toBeLessThan(0.8);
    fields.declaredAreaM2.value = 4337.89;
    expect(analysisFixture(fields).overallConfidence).toBe(0.99);
  });

  it('rejects an invalid manually edited SSCC', () => {
    const { fields } = parseLabel({ text: '', codes: [qr], ocrConfidence: 0 });
    fields.supplierSscc = { value: '378989959000344928', confidence: 1, sources: ['MANUAL'] };
    const result = analysisFixture(fields);
    expect(result.validation.missingCriticalFields).toContain('Código de barras (SSCC)');
    expect(result.reviewRequired).toBe(true);
  });
});
