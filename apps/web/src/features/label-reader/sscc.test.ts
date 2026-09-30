import { describe, expect, it } from 'vitest';

import { isValidSscc, parseSscc, ssccFromCodes, ssccFromText } from './sscc';

describe('GS1 SSCC identification', () => {
  it('validates the barcode printed on the reported Impress label', () => {
    expect(isValidSscc('378989959000344929')).toBe(true);
    expect(parseSscc('(00)378989959000344929')).toBe('378989959000344929');
    expect(parseSscc('00378989959000344929')).toBe('378989959000344929');
    expect(parseSscc(']C100378989959000344929')).toBe('378989959000344929');
  });

  it('rejects a misread check digit and refuses to scrape digits out of an unrelated QR', () => {
    expect(parseSscc('(00)378989959000344928')).toBeNull();
    expect(parseSscc('material;378989959000344929;845')).toBeNull();
    expect(parseSscc('E-102410/270-15-I-02')).toBeNull();
  });

  it('retains OCR as OCR, with an explicit SSCC marker and valid check digit', () => {
    expect(ssccFromText('impress\n(00)378989959000344929')).toBe('378989959000344929');
    expect(ssccFromText('(00)378989959000344928')).toBeNull();
    expect(ssccFromText('pedido 102410/270\n378989959000344929')).toBeNull();
  });

  it('does not choose silently between two different valid logistic identifiers', () => {
    expect(ssccFromCodes([
      { format: 'CODE_128', value: '00378989959000344929' },
      { format: 'CODE_128', value: '00378989959000364088' }
    ])).toBeNull();
  });
});
