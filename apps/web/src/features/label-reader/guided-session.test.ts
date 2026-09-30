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
  it('requires an isolated quantity close-up when headers are lost, not a row containing weight', () => {
    const accumulator = new GuidedScanAccumulator('SCHATTDECOR');
    const ambiguous = observation({ target: 'quantity', text: '2765 1865 810\n1038' });
    accumulator.observe(ambiguous); accumulator.observe(ambiguous);
    expect(accumulator.current().fields.quantitySheets.value).toBeNull();
    const closeUp = observation({ target: 'quantity', text: '810' });
    accumulator.observe(closeUp); accumulator.observe(closeUp);
    expect(accumulator.current().fields.quantitySheets.value).toBe(810);
    expect(accumulator.current().fields.quantitySheets.confidence).toBeLessThan(0.7);
  });
  it('reads highlighted Impress fields without collecting weight or treating order as lot', () => {
    const accumulator = new GuidedScanAccumulator('IMPRESS');
    const frames = [
      observation({ target: 'identity', text: 'PRODUTO\nPAU FERRO' }),
      observation({ target: 'quantity', text: 'cabeçalho ilegível\n950', ocrConfidence: 0.35 }),
      observation({ target: 'dimensions', text: '1860 X2760' }),
      observation({ target: 'area', text: '4.876,92' }),
      observation({ target: 'production', text: '12/09/2026\n17:14:31' }),
      observation({ target: 'expiry', text: '11/12/26' }),
      observation({ target: 'reference', text: '1 102893/1 30' }),
      observation({ target: 'reference', text: '2' })
    ];
    for (const frame of frames) { accumulator.observe(frame); accumulator.observe(frame); }
    const { fields } = accumulator.current();
    expect(fields.supplierMaterialName.value).toBe('PAU FERRO');
    expect(fields.quantitySheets.value).toBe(950);
    expect(fields.quantitySheets.confidence).toBeLessThan(0.7);
    expect(fields.declaredAreaM2.value).toBe(4876.92);
    expect(fields.manufacturedAt.value).toBe('2026-09-12T17:14:31');
    expect(fields.expiresOn.value).toBe('2026-12-11');
    expect(fields.supplierOrderNumber.value).toBe('102893/130');
    expect(fields.palletNumber.value).toBe(2);
    expect(fields.lotCode.value).toBeNull();
    expect(fields.supplierPalletCode.value).toBeNull();
    expect(guidedCriticalComplete(accumulator.current())).toBe(false);
  });

  it('only collects the selected OCR field, preserving other values for a separate close-up', () => {
    const accumulator = new GuidedScanAccumulator('SCHATTDECOR');
    for (let i = 0; i < 2; i++) accumulator.observe(observation({ target: 'area', text: 'Lote D009260228\n6165.45' }));
    expect(accumulator.current().fields.declaredAreaM2.value).toBe(6165.45);
    expect(accumulator.current().fields.lotCode.value).toBeNull();
    for (let i = 0; i < 2; i++) accumulator.observe(observation({ target: 'quantity', text: 'Peso (kg)\n1374' }));
    expect(accumulator.current().fields.quantitySheets.value).toBeNull();
  });

  it('does not turn an impossible time into a substring that looks valid', () => {
    const accumulator = new GuidedScanAccumulator('IMPRESS');
    for (let i = 0; i < 2; i++) accumulator.observe(observation({ target: 'production', text: '12/09/2026\n47:14:31' }));
    expect(accumulator.current().fields.manufacturedAt.value).toBe('2026-09-12');
  });
  it('keeps ambiguous Schattdecor lots pending instead of accepting damaged OCR', () => {
    const accumulator = new GuidedScanAccumulator();
    for (let index = 0; index < 2; index++) accumulator.observe(observation({ text: 'SCHATTDECOR\nDesign\nCONVÉS' }));
    for (let index = 0; index < 2; index++) accumulator.observe(observation({ target: 'lot', text: 'Lote: DOO924/388', ocrConfidence: 0.4 }));
    expect(accumulator.current().fields.lotCode.value).toBeNull();
    expect(guidedCriticalComplete(accumulator.current())).toBe(false);
  });
  it('starts with printed identity, without requiring a QR or barcode', () => {
    expect(nextGuidedTarget(null)).toBe('identity');
    expect(nextGuidedTarget(new GuidedScanAccumulator().current())).toBe('identity');
  });
  it('accepts Impress QR fields but continues looking for its separate barcode', () => {
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
    expect(nextGuidedTarget(result)).toBe('code');
    expect(guidedCriticalComplete(result)).toBe(false);
    expect(result.overallConfidence).toBeLessThan(0.9);
    const complete = accumulator.observe(observation({
      target: 'code', codes: [{ format: 'CODE_128', value: '00378989959000364088' }]
    })).result;
    expect(complete.fields.supplierSscc.value).toBe('378989959000364088');
    expect(guidedCriticalComplete(complete)).toBe(true);
    expect(nextGuidedTarget(complete)).toBe('overview');
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
