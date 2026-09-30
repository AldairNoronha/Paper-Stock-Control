import type { FieldReading, GuidedCaptureTarget, LabelFields, OcrWord, SupplierCode } from './types';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const center = (word: OcrWord) => (word.bbox.x0 + word.bbox.x1) / 2;
const height = (word: OcrWord) => word.bbox.y1 - word.bbox.y0;
const MATERIAL_EXCLUSIONS = /IMPRESS|SCHAT[TIL1]DECOR|INTERPRINT|FLORAPLAC|CLIENTE|CUSTOMER|LOTE|BATCH|SHEETS|FOLHAS|LARGURA|COMPRIMENTO|PESO|WEIGHT|PRODU[CÇ][AÃ]O|VALIDADE|ORDER|PALLET|SUPERIOR|MATERIAL\s*NR|^(?:MDF|LTDA|PRODUTO|DESIGN|TOTAL|AREA|QUANTITY|QUANTIDADE|ALTGR|SHIFT|CTRL|ENTER|BACKSPACE|WINDOWS|CAPS|ESC|TAB|ALT|FN)$/i;

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
  if (supplier === 'SCHATTDECOR') {
    const material = prominentSchattdecorMaterial(words);
    if (material) fields.supplierMaterialName = material;
  }
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

export function prominentSchattdecorMaterial(words: OcrWord[]): FieldReading<string> | null {
  // A broad label has both the small product description and a large trade name.
  // Require actual label context, a readable uppercase name and size dominance.
  const labelContext = words.some((word) => /FLORAPLAC|SCHAT[TIL1]DECOR|CLIENTE|CUSTOMER|DESIGN|FOLHAS|LOTE|^D\d{8,12}$/i.test(word.text));
  if (!labelContext) return null;
  const credible = words.filter((word) => word.confidence >= 0.55 && height(word) > 0 && /[A-ZÀ-Ý]{2}/i.test(word.text));
  const sameRow = (a: OcrWord, b: OcrWord) => Math.abs((a.bbox.y0 + a.bbox.y1 - b.bbox.y0 - b.bbox.y1) / 2) <= Math.max(height(a), height(b)) * 0.45;
  const companyWords = credible.filter((word) => /FLORAPLAC|SCHAT[TIL1]DECOR|CLIENTE|CUSTOMER|^(?:MDF|LTDA)$/i.test(word.text.trim()));
  const candidates = credible.filter((word) => {
    const text = word.text.trim().replace(/^[^A-ZÀ-Ý]+|[^A-ZÀ-Ý]+$/g, '');
    const companyRow = companyWords.some((anchor) => word.bbox.y0 <= anchor.bbox.y1 && sameRow(word, anchor));
    return /^[A-ZÀ-Ý]{2,24}(?:-[A-ZÀ-Ý]+)?$/.test(text) && !MATERIAL_EXCLUSIONS.test(text) && !companyRow;
  }).sort((a, b) => height(b) - height(a));
  const largest = candidates[0];
  if (!largest) return null;
  const largeWords = candidates.filter((word) => height(word) >= height(largest) * 0.7);
  const bodyHeights = credible.filter((word) => !largeWords.includes(word)).map(height).sort((a, b) => a - b);
  const medianBody = bodyHeights[Math.floor(bodyHeights.length / 2)];
  if (medianBody && height(largest) < medianBody * 1.5) return null;
  const row = largeWords.filter((word) => sameRow(word, largest)).sort((a, b) => a.bbox.x0 - b.bbox.x0);
  // Do not combine two distant blocks merely because their font sizes match.
  for (let i = 1; i < row.length; i++) if (row[i].bbox.x0 - row[i - 1].bbox.x1 > height(largest) * 2) return null;
  const left = row[0].bbox.x0;
  const bottom = Math.max(...row.map((word) => word.bbox.y1));
  const secondRow = largeWords.filter((word) => !row.includes(word) && word.bbox.y0 >= bottom - height(largest) * 0.2
    && word.bbox.y0 <= bottom + height(largest) * 1.2).sort((a, b) => a.bbox.x0 - b.bbox.x0);
  if (secondRow.length && Math.abs(secondRow[0].bbox.x0 - left) <= height(largest)) row.push(...secondRow);
  // Another equally large unrelated name is ambiguous, not an invitation to guess.
  if (largeWords.some((word) => !row.includes(word))) return null;
  const name = row.map((word) => word.text.trim().replace(/^[^A-ZÀ-Ý]+|[^A-ZÀ-Ý]+$/g, '')).join(' ');
  if (name.length < 4 || name.length > 80) return null;
  return reading(name, Math.min(0.75, ...row.map((word) => word.confidence)));
}

export function focusedMaterial(text: string): string | null {
  // Large whitespace separates the name from staple/noise glyphs beside it.
  const lines = text.split('\n').map((line) => line.trim().split(/[ \t]{3,}/)[0]).filter(Boolean);
  const clean = lines.filter((line) => /[A-ZÀ-Ý]{2}/i.test(line) && !MATERIAL_EXCLUSIONS.test(line) && !/^(?:PRODUTO|DESIGN|NOME IMPRESS|DESCRI[CÇ][AÃ]O.*)$/i.test(line));
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
