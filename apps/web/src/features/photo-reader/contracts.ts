import { z } from 'zod';

export const fieldKeys = ['supplier', 'material', 'sheets', 'width_mm', 'length_mm', 'lot', 'pallet',
  'area_m2', 'weight_kg', 'production_date', 'expiry_date', 'order', 'pallet_number', 'sscc'] as const;
export type FieldKey = typeof fieldKeys[number];
export const fieldLabels: Record<FieldKey, string> = {
  supplier: 'Fornecedor', material: 'Nome do papel', sheets: 'Quantidade de folhas',
  width_mm: 'Largura (mm)', length_mm: 'Comprimento (mm)', lot: 'Lote', pallet: 'Código do pallet',
  area_m2: 'Área declarada (m²)', weight_kg: 'Peso líquido (kg)', production_date: 'Data de produção',
  expiry_date: 'Validade', order: 'Ordem do fornecedor', pallet_number: 'Número sequencial do pallet',
  sscc: 'SSCC impresso',
};
const fieldSchema = z.object({
  value: z.string().nullable(), status: z.enum(['review', 'missing', 'ambiguous']),
  source_text: z.string().nullable(), method: z.string().nullable(),
  ocr_confidence: z.number().min(0).max(1).nullable(),
  box: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).nullable(),
});
export const analysisSchema = z.object({
  version: z.literal('photo-v2.1'), provider: z.string(),
  image_width: z.number().int().positive(), image_height: z.number().int().positive(),
  fields: z.record(z.enum(fieldKeys), fieldSchema), missing_critical: z.array(z.string()),
  warnings: z.array(z.string()), calculated_area_m2: z.number().nullable(), raw_text: z.string(),
});
export type PhotoAnalysis = z.infer<typeof analysisSchema>;
export type Values = Record<FieldKey, string>;
export const emptyValues = (): Values => Object.fromEntries(fieldKeys.map(key => [key, ''])) as Values;
export function invalidField(key: FieldKey, value: string): boolean {
  if (!value.trim()) return false;
  if (key === 'sheets' || key === 'pallet_number') return !/^\d+$/.test(value) || +value < 1 || +value > 100000;
  if (key === 'width_mm' || key === 'length_mm') return !/^\d+(?:\.\d+)?$/.test(value) || +value < 500 || +value > 5000;
  if (key === 'area_m2' || key === 'weight_kg') return !/^\d+(?:\.\d+)?$/.test(value) || +value <= 0 || +value > 100000;
  if (key === 'production_date' || key === 'expiry_date') {
    const parsed = Date.parse(value);
    return !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value;
  }
  if (key === 'sscc') {
    if (!/^\d{18}$/.test(value)) return true;
    const sum = [...value.slice(0, -1)].reduce((total, digit, index) => total + +digit * (index % 2 ? 1 : 3), 0);
    return (10 - sum % 10) % 10 !== +value[17];
  }
  return value.length > 200;
}
export function requiredFields(values: Values): FieldKey[] {
  const required: FieldKey[] = ['supplier', 'material', 'sheets', 'width_mm', 'length_mm'];
  if (values.lot.trim()) required.push('lot');
  else if (values.pallet.trim()) required.push('pallet');
  else required.push('lot');
  return required;
}
