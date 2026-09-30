import type { FieldReading, GuidedCaptureTarget, LabelFields, OcrWord, SupplierCode } from './types';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const center = (word: OcrWord) => (word.bbox.x0 + word.bbox.x1) / 2;
const height = (word: OcrWord) => word.bbox.y1 - word.bbox.y0;

function reading<T>(value: T, confidence: number): FieldReading<T> {
  return { value, confidence: Math.max(0, Math.min(0.9, confidence)), sources: ['OCR'] };
}

function localizedNumber(text: string): number | null {
  const compact = text.replace(/\s/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(compact)) return null;
  const normalized = compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : compact;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Associate headers with the nearest value BELOW them in the same column.
// Do not flatten a row of headers and a row of numbers into an arbitrary sequence.
function below(words: OcrWord[], anchor: OcrWord, valid: (text: string) => boolean): OcrWord | null {
  const candidates = words.filter((word) => {
    const gap = word.bbox.y0 - anchor.bbox.y1;
    const tolerance = Math.max((anchor.bbox.x1 - anchor.bbox.x0) * 0.75, height(anchor) * 4, (word.bbox.x1 - word.bbox.x0) * 0.8);
    const crossedHeader = words.some((other) => other !== anchor && other !== word
      && /^(?:PESO|WEIGHT|KG|TOTAL|AREA|M2|LARGURA|WIDTH|COMPRIMENTO|LENGTH|FOLHAS|SHEETS)$/.test(normalize(other.text))
      && other.bbox.y0 > anchor.bbox.y1 && other.bbox.y1 <= word.bbox.y0
      && Math.abs(center(other) - center(anchor)) <= Math.max(tolerance, (other.bbox.x1 - other.bbox.x0) * 0.75));
    return valid(word.text) && !crossedHeader && gap >= -height(anchor) * 0.3 && gap <= Math.max(height(anchor) * 7, height(word) * 4)
      && Math.abs(center(word) - center(anchor)) <= tolerance;
  }).sort((a, b) => a.bbox.y0 - b.bbox.y0 || Math.abs(center(a) - center(anchor)) - Math.abs(center(b) - center(anchor)));
  const first = candidates[0];
  if (!first) return null;
  const rival = candidates[1];
  if (rival && Math.abs(rival.bbox.y0 - first.bbox.y0) < height(first) * 0.5
    && Math.abs(Math.abs(center(rival) - center(anchor)) - Math.abs(center(first) - center(anchor))) < height(anchor)) return null;
  return first;
}

export function spatialImportantFields(words: OcrWord[], supplier: SupplierCode | null): Partial<LabelFields> {
  const fields: Partial<LabelFields> = {};
  const matchedWords = new Map<keyof LabelFields, OcrWord>();
  const numericHeaders: Array<[keyof LabelFields, RegExp, (value: number) => boolean]> = [
    ['quantitySheets', /^(?:FOLHAS|SHEETS|SHEET)$/, (n) => Number.isInteger(n) && n >= 1 && n <= 20000],
    ['widthMm', /^(?:LARGURA|WIDTH)(?:MM)?$/, (n) => Number.isInteger(n) && n >= 1000 && n <= 4000],
    ['lengthMm', /^(?:[CV]OMPR[I1LN]MENTO|LENGTH)(?:MM)?$/, (n) => Number.isInteger(n) && n >= 1000 && n <= 4000],
    ['declaredAreaM2', /^(?:M2|AREA)$/, (n) => n > 0 && n < 1000000]
  ];
  for (const [key, expression, valid] of numericHeaders) {
    for (const anchor of words.filter((word) => expression.test(normalize(word.text)))) {
      const valueWord = below(words, anchor, (text) => {
        const value = localizedNumber(text);
        return value !== null && valid(value);
      });
      if (valueWord) {
        fields[key] = reading(localizedNumber(valueWord.text)!, Math.min(anchor.confidence, valueWord.confidence)) as never;
        matchedWords.set(key, valueWord);
        break;
      }
    }
  }
  for (const [known, missing] of [['widthMm', 'lengthMm'], ['lengthMm', 'widthMm']] as const) {
    const knownWord = matchedWords.get(known);
    if (!knownWord || fields[missing]) continue;
    const candidates = words.filter((word) => /^\d{4}$/.test(word.text)
      && Number(word.text) >= 1000 && Number(word.text) <= 4000
      && Number(word.text) !== fields.quantitySheets?.value && word !== knownWord
      && Math.abs((word.bbox.y0 + word.bbox.y1) / 2 - (knownWord.bbox.y0 + knownWord.bbox.y1) / 2) < Math.max(height(word), height(knownWord)) * 0.6);
    if (candidates.length === 1) fields[missing] = reading(Number(candidates[0].text), Math.min(candidates[0].confidence, 0.65));
  }
  if (supplier === 'IMPRESS') {
    for (const anchor of words.filter((word) => normalize(word.text) === 'PALLET')) {
      const valueWord = below(words, anchor, (text) => /^\d{1,3}$/.test(text));
      if (valueWord) fields.palletNumber = reading(Number(valueWord.text), Math.min(anchor.confidence, valueWord.confidence));
    }
  }
  return fields;
}

export function focusedMaterial(text: string): string | null {
  // Large whitespace separates the name from staple/noise glyphs beside it.
  const lines = text.split('\n').map((line) => line.trim().split(/[ \t]{3,}/)[0]).filter(Boolean);
  const unwanted = /IMPRESS|SCHAT[TIL1]DECOR|INTERPRINT|FLORAPLAC|CLIENTE|CUSTOMER|LOTE|BATCH|SHEETS|FOLHAS|LARGURA|COMPRIMENTO|PESO|WEIGHT|PRODU[CÇ][AÃ]O|VALIDADE|ORDER|PALLET|SUPERIOR|MATERIAL\s*NR/i;
  const clean = lines.filter((line) => /[A-ZÀ-Ý]{2}/i.test(line) && !unwanted.test(line) && !/^(?:PRODUTO|DESIGN|NOME IMPRESS|DESCRI[CÇ][AÃ]O.*)$/i.test(line));
  if (clean.length === 0 || clean.length > 3) return null;
  const material = clean.join(' ').replace(/\s+/g, ' ').trim();
  if (material.length < 4 || material.length > 100 || !/[A-ZÀ-Ý]{3}/i.test(material) || /\d{6,}|^E-|^D\d/i.test(material)) return null;
  return material;
}

export const TARGET_FIELDS: Record<GuidedCaptureTarget, (keyof LabelFields)[]> = {
  identity: ['supplier', 'supplierMaterialName'],
  quantity: ['supplier', 'quantitySheets', 'widthMm', 'lengthMm'],
  dimensions: ['supplier', 'widthMm', 'lengthMm', 'quantitySheets'],
  lot: ['supplier', 'lotCode', 'supplierPalletCode'],
  area: ['supplier', 'declaredAreaM2'],
  production: ['supplier', 'manufacturedAt'],
  expiry: ['supplier', 'expiresOn'],
  reference: ['supplier', 'supplierOrderNumber', 'palletNumber'],
  code: ['supplier', 'supplierSscc', 'lotCode', 'supplierPalletCode'],
  overview: ['supplier', 'supplierMaterialName', 'supplierOrderNumber', 'palletNumber', 'supplierPalletCode', 'supplierSscc', 'lotCode', 'quantitySheets', 'widthMm', 'lengthMm', 'declaredAreaM2', 'manufacturedAt', 'expiresOn', 'orientation']
};
