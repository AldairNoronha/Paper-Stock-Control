import { afterEach, describe, expect, it, vi } from 'vitest';

import { persistReceipt } from './api';
import { GuidedScanAccumulator } from './guided-session';

afterEach(() => vi.unstubAllGlobals());

describe('SSCC receipt persistence', () => {
  it('sends the reviewed SSCC instead of an obsolete barcode reading', async () => {
    const result = new GuidedScanAccumulator().current();
    result.fields.supplierSscc = {
      value: '378989959000344929', confidence: 1, sources: ['MANUAL']
    };
    result.detectedCodes = [{ format: 'CODE_128', value: '00378989959000364088' }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'pallet-id', internal_code: 'PAP-000001', internal_qr: 'PSC:1:pallet-id'
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await persistReceipt({ apiBaseUrl: 'https://api.example/api/v1', supabaseUrl: 'https://auth.example',
      supabasePublishableKey: 'public-test' }, 'test-token',
    new File(['label'], 'label.jpg', { type: 'image/jpeg' }), result,
    'supplier-id', 'material-id', 'location-id', 'stable-receipt-key', [], 'existing-scan');

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string).supplier_sscc).toBe('378989959000344929');
    expect(request.headers).toMatchObject({ 'Idempotency-Key': 'stable-receipt-key' });
  });
});
