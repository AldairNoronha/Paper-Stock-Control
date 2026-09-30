import { describe, expect, it } from 'vitest';

import { GuidedScanAccumulator, guidedCriticalComplete, nextGuidedTarget } from './guided-session';
import type { GuidedObservation, ImageQualityResult } from './types';

const quality: ImageQualityResult = {
  width: 1600,
  height: 700,
  megapixels: 1.12,
  brightness: 145,
  contrast: 42,
  sharpness: 80,
  canAnalyze: true,
  issues: []
};

function observation(partial: Partial<GuidedObservation>): GuidedObservation {
  return {
    text: '',
    ocrConfidence: 0.84,
    codes: [],
    quality,
    target: 'identity',
    capturedAt: '2026-09-30T12:00:00.000Z',
    ...partial
  };
}

describe('guided scan accumulator', () => {
  it('accepts a QR payload immediately and skips fields already supplied by it', () => {
    const accumulator = new GuidedScanAccumulator();
    const { result } = accumulator.observe(observation({
      target: 'code',
      codes: [{
        format: 'QR_CODE',
        value: '90113 UNICOLOR IP420 2760x1860mm;0;820;E-102893/010-15-I-01;05.09.2026 19:07;04/12/26'
      }]
    }));

    expect(result.fields.supplier.value).toBe('IMPRESS');
    expect(result.fields.quantitySheets.value).toBe(820);
    expect(result.fields.widthMm.value).toBe(1860);
    expect(result.fields.lengthMm.value).toBe(2760);
    expect(nextGuidedTarget(result, true, true)).toBe('overview');
  });

  it('requires the same OCR value twice before accepting a critical field', () => {
    const accumulator = new GuidedScanAccumulator();
    const frame = observation({
      target: 'quantity',
      text: 'Schattdecor\nQde. de folhas 850'
    });

    expect(accumulator.observe(frame).result.fields.quantitySheets.value).toBeNull();
    expect(accumulator.observe(frame).result.fields.quantitySheets.value).toBe(850);
  });

  it('accumulates separate regions until all required fields are present', () => {
    const accumulator = new GuidedScanAccumulator();
    const frames = [
      observation({ target: 'identity', text: 'schattdecor\nDesign\nCONVÉS' }),
      observation({ target: 'identity', text: 'schattdecor\nDesign\nCONVÉS' }),
      observation({ target: 'quantity', text: 'Qde. de folhas 850' }),
      observation({ target: 'quantity', text: 'Qde. de folhas 850' }),
      observation({ target: 'dimensions', text: 'Comprimento 2765\nLargura 1865\n1865 x 2765' }),
      observation({ target: 'dimensions', text: 'Comprimento 2765\nLargura 1865\n1865 x 2765' }),
      observation({ target: 'lot', text: 'Lote: D009247388' }),
      observation({ target: 'lot', text: 'Lote: D009247388' })
    ];
    let result = accumulator.current();
    for (const frame of frames) result = accumulator.observe(frame).result;

    expect(result.fields.supplier.value).toBe('SCHATTDECOR');
    expect(result.fields.supplierMaterialName.value).toBe('CONVÉS');
    expect(result.fields.quantitySheets.value).toBe(850);
    expect(result.fields.lotCode.value).toBe('D009247388');
    expect(guidedCriticalComplete(result)).toBe(true);
  });
});
