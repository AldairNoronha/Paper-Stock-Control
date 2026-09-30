import type { RuntimeConfig } from '../../lib/runtime';
import { parseSscc } from './sscc';
import type { CaptureEvidence, LabelAnalysisResult } from './types';

export interface SupplierDto { id: string; code: string; name: string }
export interface MaterialDto { id: string; internal_code: string; name: string; width_mm: number; length_mm: number }
export interface LocationDto { id: string; code: string; name: string }
export interface SupplierMaterialDto { id: string; supplier_id: string; material_id: string; supplier_name: string }
export interface ReceivingCatalog {
  suppliers: SupplierDto[];
  materials: MaterialDto[];
  locations: LocationDto[];
  mappings: SupplierMaterialDto[];
}
export interface ReceiptResult { id: string; internal_code: string; internal_qr: string }

async function apiRequest<T>(
  config: RuntimeConfig,
  token: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `A API respondeu com status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function loadReceivingCatalog(
  config: RuntimeConfig,
  token: string
): Promise<ReceivingCatalog> {
  const [suppliers, materials, locations, mappings] = await Promise.all([
    apiRequest<SupplierDto[]>(config, token, '/catalog/suppliers'),
    apiRequest<MaterialDto[]>(config, token, '/catalog/materials'),
    apiRequest<LocationDto[]>(config, token, '/catalog/locations'),
    apiRequest<SupplierMaterialDto[]>(config, token, '/catalog/supplier-materials')
  ]);
  return { suppliers, materials, locations, mappings };
}

export async function persistReceipt(
  config: RuntimeConfig,
  token: string,
  file: File,
  result: LabelAnalysisResult,
  supplierId: string,
  materialId: string,
  locationId: string,
  idempotencyKey: string,
  evidence: CaptureEvidence[] = [],
  existingScanId?: string,
  onScanCreated?: (scanId: string) => void
): Promise<{ receipt: ReceiptResult; scanId: string }> {
  let scanId = existingScanId;
  if (!scanId) {
    const form = new FormData();
    form.append('image', file);
    form.append('analysis', JSON.stringify({
      supplier: result.fields.supplier.value,
      parser_name: result.parserName,
      parser_version: result.parserVersion,
      overall_confidence: result.overallConfidence,
      raw_text: result.rawText,
      codes: result.detectedCodes,
      fields: result.fields,
      quality: {
        width: result.quality.width,
        height: result.quality.height,
        brightness: result.quality.brightness,
        contrast: result.quality.contrast,
        sharpness: result.quality.sharpness
      }
    }));
    form.append('evidence_manifest', JSON.stringify(evidence.map((item) => ({
      target: item.target,
      field_names: item.fieldNames,
      captured_at: item.capturedAt,
      quality: {
        width: item.quality.width,
        height: item.quality.height,
        brightness: item.quality.brightness,
        contrast: item.quality.contrast,
        sharpness: item.quality.sharpness
      }
    }))));
    for (const item of evidence) form.append('evidence_images', item.file);
    const scan = await apiRequest<{ id: string }>(config, token, '/labels/scans', {
      method: 'POST',
      body: form
    });
    scanId = scan.id;
    onScanCreated?.(scanId);
  }

  const fields = result.fields;
  const receipt = await apiRequest<ReceiptResult>(config, token, '/inventory/receipts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      supplier_id: supplierId,
      material_id: materialId,
      location_id: locationId,
      supplier_material_name: fields.supplierMaterialName.value,
      supplier_pallet_code: fields.supplierPalletCode.value,
      supplier_sscc: fields.supplierSscc.value ? parseSscc(fields.supplierSscc.value) : null,
      lot_code: fields.lotCode.value,
      quantity_sheets: fields.quantitySheets.value,
      width_mm: fields.widthMm.value,
      length_mm: fields.lengthMm.value,
      declared_area_m2: fields.declaredAreaM2.value,
      manufactured_at: fields.manufacturedAt.value,
      expires_on: fields.expiresOn.value,
      orientation: fields.orientation.value,
      raw_label_payload: {
        parser: result.parserName,
        parser_version: result.parserVersion,
        detected_codes: result.detectedCodes,
        validation: result.validation
      },
      label_scan_id: scanId
    })
  });
  return { receipt, scanId };
}
