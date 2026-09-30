import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { analyzeLabel } from './analyzer';
import { GuidedScanAccumulator } from './guided-session';
import { LabelReader } from './LabelReader';

vi.mock('./analyzer', async (importOriginal) => ({
  ...await importOriginal<typeof import('./analyzer')>(), analyzeLabel: vi.fn()
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('review of partial Impress identification', () => {
  it('warns that only the QR was decoded and requires a valid SSCC before approval', async () => {
    const accumulator = new GuidedScanAccumulator();
    const result = accumulator.observe({
      text: '', ocrConfidence: 0, target: 'code', capturedAt: '2026-09-30T12:00:00Z',
      quality: { width: 1280, height: 960, megapixels: 1.2, brightness: 160, contrast: 40,
        sharpness: 60, canAnalyze: true, issues: [] },
      codes: [{ format: 'QR_CODE', value:
        '90113 UNICOLOR IP441 2760x1860mm;0;845;E-102410/270-15-I-02;23.08.2026 20:41;21/11/26' }]
    }).result;
    vi.mocked(analyzeLabel).mockResolvedValue(result);
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL() { return 'blob:test-label'; }
      static revokeObjectURL() {}
    });
    const { container } = render(<LabelReader />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['label'], 'label.jpg', { type: 'image/jpeg' })] }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ler etiqueta' }));
    expect(await screen.findByText('Leitura parcial. Complete os campos destacados.')).toBeInTheDocument();
    expect(screen.getByText('QR: 1 · Barras: 0')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar leitura' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: /^Código de barras \(SSCC\)/ }), {
      target: { value: '(00)378989959000344929' }
    });
    expect(screen.getByDisplayValue('378989959000344929')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar leitura' })).toBeEnabled();
    expect(screen.getByText('Conferido manualmente')).toBeInTheDocument();
    expect(screen.getByText('QR: 1 · Barras: 0')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('378989959000344929'), {
      target: { value: '378989959000344928' }
    });
    expect(screen.getByRole('button', { name: 'Aprovar leitura' })).toBeDisabled();
    expect(screen.getByText('SSCC inválido. Confira o número e seu dígito verificador.')).toBeInTheDocument();
  });
});
