import { describe, expect, it } from 'vitest';

import { parseLabel } from './parsers';
import { focusedMaterial, spatialImportantFields } from './important-fields';
import type { OcrWord } from './types';

function word(text: string, x: number, y: number, width = 75, h = 20): OcrWord {
  return { text, confidence: 0.9, bbox: { x0: x, y0: y, x1: x + width, y1: y + h } };
}

describe('important label fields', () => {
  it('reads LENHO sheets (810) above weight (1038), even when OCR text ends with weight', () => {
    const result = parseLabel({ text: 'SCHATTDECOR\nLENHO\n2765\n1865\n810\n1038', codes: [], ocrConfidence: 0.8,
      words: [word('Comprimento', 20, 10, 110), word('Largura', 220, 10), word('folhas:', 430, 10),
        word('2765', 25, 50), word('1865', 225, 50), word('810', 425, 50), word('Peso', 220, 100), word('1038', 220, 135)] });
    expect(result.fields.quantitySheets.value).toBe(810);
    expect(result.fields.widthMm.value).toBe(1865);
    expect(result.fields.lengthMm.value).toBe(2765);
  });

  it('does not cross another header to borrow a number from the next row', () => {
    expect(spatialImportantFields([word('folhas', 220, 10), word('Peso', 220, 60), word('1038', 220, 95)], 'SCHATTDECOR').quantitySheets).toBeUndefined();
  });

  it('preserves structured QR quantity even when spatial OCR reads a different value', () => {
    const result = parseLabel({ text: 'SCHATTDECOR', ocrConfidence: 0.8,
      codes: [{ format: 'QR_CODE', value: 'LENHO|D009235654|810|1865|2765|4176.95|superior|' }],
      words: [word('folhas', 220, 10), word('1038', 220, 50)] });
    expect(result.fields.quantitySheets.value).toBe(810);
    expect(result.fields.quantitySheets.sources).toEqual(['QR']);
  });

  it('does not erase a QR dimension when only one OCR dimension header survives', () => {
    const result = parseLabel({ text: 'SCHATTDECOR', ocrConfidence: 0.8,
      codes: [{ format: 'QR_CODE', value: 'LENHO|D009235654|810|1865|2765|4176.95|superior|' }],
      words: [word('Largura', 220, 10), word('1865', 225, 50)] });
    expect(result.fields.widthMm.value).toBe(1865);
    expect(result.fields.lengthMm.value).toBe(2765);
    expect(result.fields.lengthMm.sources).toEqual(['QR']);
  });
  it('associates each Schattdecor header with its column, not with weight or order in OCR text', () => {
    const words = [word('Comprimento', 20, 10, 110), word('Largura', 220, 10), word('folhas:', 430, 10),
      word('1860', 25, 50), word('2760', 225, 50), word('1201', 425, 50),
      word('Peso', 220, 100), word('1374', 220, 135)];
    const fields = spatialImportantFields(words, 'SCHATTDECOR');
    expect(fields.lengthMm?.value).toBe(1860);
    expect(fields.widthMm?.value).toBe(2760);
    expect(fields.quantitySheets?.value).toBe(1201);
  });

  it('keeps two different measurements when only the width header survives', () => {
    const result = parseLabel({ text: 'SCHATTDECOR\n1860\n2760\n1201', codes: [], ocrConfidence: 0.8,
      words: [word('Largura', 220, 10), word('1860', 25, 50), word('2760', 225, 50)] });
    expect(result.fields.widthMm.value).toBe(2760);
    expect(result.fields.lengthMm.value).toBe(1860);
  });

  it('never substitutes quantity for a lost dimension when OCR rearranges columns', () => {
    const result = parseLabel({ text: 'SCHATTDECOR\n2760\n1201\n1860', ocrConfidence: 0.8, codes: [],
      words: [word('Largura', 220, 10), word('folhas:', 430, 10), word('1860', 25, 50), word('2760', 225, 50), word('1201', 425, 50)] });
    expect(result.fields.quantitySheets.value).toBe(1201);
    expect(result.fields.widthMm.value).toBe(2760);
    expect(result.fields.lengthMm.value).toBe(1860);
  });

  it('does not select a value equidistant between columns', () => {
    expect(spatialImportantFields([word('folhas', 100, 10, 80), word('950', 65, 50), word('1045', 135, 50)], 'IMPRESS').quantitySheets).toBeUndefined();
  });

  it('recognizes a multiline trade name and excludes staple/noise fragments', () => {
    expect(focusedMaterial('BRANCO NÓRDICO\nIMP               Í            )')).toBe('BRANCO NÓRDICO IMP');
    expect(focusedMaterial('PRODUTO\nPAU FERRO')).toBe('PAU FERRO');
    expect(focusedMaterial('FLORAPLAC MDF LTDA\nPESO 1374')).toBeNull();
  });
});
