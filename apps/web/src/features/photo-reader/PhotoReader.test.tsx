import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PhotoReader } from './PhotoReader';
import { emptyValues, fieldKeys, fieldLabels, invalidField, type PhotoAnalysis } from './contracts';

const config = { apiBaseUrl: 'https://api.example.test/api/v1', supabaseUrl: 'https://auth.example.test', supabasePublishableKey: 'public' };
const persistence = { config, accessToken: 'test-token' };
function fixture(): PhotoAnalysis {
  const values = { ...emptyValues(), supplier: 'SCHATTDECOR', material: 'LENHO', sheets: '800',
    width_mm: '1865', length_mm: '2765', weight_kg: '1009', lot: 'D009235577', pallet: '1-0757-B' };
  return { version: 'photo-v2.1', provider: 'google-vision', image_width: 1000, image_height: 600,
    raw_text: 'synthetic fixture; not a real OCR benchmark', warnings: ['Revise todos os valores.'],
    missing_critical: [], calculated_area_m2: 4125.38,
    fields: Object.fromEntries(fieldKeys.map(key => [key, { value: values[key] || null,
      status: values[key] ? 'review' : 'missing', source_text: values[key] || null,
      box: values[key] ? { x: 0.2, y: 0.3, width: 0.1, height: 0.04 } : null,
      ocr_confidence: values[key] ? 0.92 : null, method: values[key] ? 'label-column' : null }])) as PhotoAnalysis['fields'] };
}
function selectPhoto() {
  fireEvent.change(screen.getByLabelText('Foto da galeria'), { target: { files: [new File(['photo'], 'etiqueta.jpg', { type: 'image/jpeg' })] } });
}
beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: vi.fn() }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('allows a full photo and manual review without credentials, but never calls OCR', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<PhotoReader />); selectPhoto();
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:photo');
  expect(screen.getByText('Analisar foto no servidor')).toBeDisabled();
  fireEvent.click(screen.getByText('Preencher manualmente sem enviar foto'));
  expect(screen.getByLabelText('Nome do papel *')).toHaveValue('');
  expect(screen.getByText('Exportar revisão do teste')).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
});

it('extracts all fields together and requires explicit confirmation, not a confidence badge', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true })))
    .mockResolvedValueOnce(new Response(JSON.stringify(fixture())));
  vi.stubGlobal('fetch', fetch);
  render(<PhotoReader persistence={persistence} />);
  await screen.findByText('OCR no servidor disponível.'); selectPhoto();
  fireEvent.click(screen.getByLabelText(/Autorizo enviar esta foto/));
  fireEvent.click(screen.getByText('Analisar foto no servidor'));
  await screen.findByDisplayValue('LENHO');
  expect(screen.getByDisplayValue('800')).toBeInTheDocument();
  expect(screen.getByDisplayValue('1009')).toBeInTheDocument();
  expect(screen.getByDisplayValue('1865')).toBeInTheDocument();
  expect(screen.queryByText('100%')).not.toBeInTheDocument();
  expect(screen.getByText('Exportar revisão do teste')).toBeDisabled();
  expect(document.querySelector('.photo-box')).toHaveStyle({ left: '20%', top: '30%' });
  expect(fetch.mock.calls[1][0]).toBe(`${config.apiBaseUrl}/labels/photo-analysis`);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer test-token');
  const body = fetch.mock.calls[1][1].body as FormData;
  expect(body.get('image')).toBeInstanceOf(File);
  expect([...body.keys()]).toEqual(['image']);
  for (const checkbox of screen.getAllByLabelText('Conferi este valor na etiqueta')) fireEvent.click(checkbox);
  expect(screen.getByText('Exportar revisão do teste')).toBeEnabled();
  fireEvent.focus(screen.getByLabelText('Quantidade de folhas *'));
  fireEvent.change(screen.getByLabelText('Quantidade de folhas *'), { target: { value: '1009' } });
  expect(screen.getByText('Exportar revisão do teste')).toBeDisabled();
  expect(screen.getByText('Origem: Quantidade de folhas')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2); // No stock or scan persistence endpoint.
});

it('reports cloud configuration failure without inventing values or retrying', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'OCR V2 ainda não configurado no servidor.' }), { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  render(<PhotoReader persistence={persistence} />);
  await screen.findByText('OCR no servidor disponível.'); selectPhoto();
  fireEvent.click(screen.getByLabelText(/Autorizo enviar esta foto/));
  fireEvent.click(screen.getByText('Analisar foto no servidor'));
  expect(await screen.findByRole('alert')).toHaveTextContent('OCR V2 ainda não configurado');
  expect(screen.queryByText('Confira cada valor na foto')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('disables analysis in anonymous pilot even when the service is ready', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true })));
  vi.stubGlobal('fetch', fetch);
  render(<PhotoReader config={config} />);
  await screen.findByText(/Entre no modo operacional/); selectPhoto();
  fireEvent.click(screen.getByLabelText(/Autorizo enviar esta foto/));
  expect(screen.getByText('Analisar foto no servidor')).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('requires a lot or pallet and exports only reviewed values', async () => {
  vi.stubGlobal('fetch', vi.fn());
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(<PhotoReader />); selectPhoto();
  fireEvent.click(screen.getByText('Preencher manualmente sem enviar foto'));
  for (const [key, value] of Object.entries({ supplier: 'SCHATTDECOR', material: 'LENHO', sheets: '800', width_mm: '1865', length_mm: '2765' })) {
    fireEvent.change(screen.getByLabelText(`${fieldLabels[key as keyof typeof fieldLabels]} *`), { target: { value } });
  }
  for (const checkbox of screen.getAllByLabelText('Conferi este valor na etiqueta')) fireEvent.click(checkbox);
  expect(screen.getByText('Exportar revisão do teste')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Lote *'), { target: { value: 'D009235577' } });
  fireEvent.click(screen.getAllByLabelText('Conferi este valor na etiqueta').at(-1)!);
  await waitFor(() => expect(screen.getByText('Exportar revisão do teste')).toBeEnabled());
  fireEvent.click(screen.getByText('Exportar revisão do teste'));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Nenhum pallet foi criado');
});

it.each([['sheets', '-1'], ['sheets', '1009.5'], ['width_mm', '100'],
  ['production_date', '2026-02-31'], ['sscc', '378989959000373210']] as const)('rejects invalid %s values', (key, value) => {
  expect(invalidField(key, value)).toBe(true);
});
