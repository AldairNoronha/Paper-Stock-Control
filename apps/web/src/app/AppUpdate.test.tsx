import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppUpdate, APP_RELEASE } from './AppUpdate';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('identifies the reader release', () => {
  render(<AppUpdate />);
  expect(screen.getByText(`Leitor ${APP_RELEASE}`)).toBeInTheDocument();
});

describe('service worker updates', () => {
  it('announces an activated update without automatically discarding the open page', async () => {
    vi.stubEnv('PROD', true);
    const registration = Object.assign(new EventTarget(), { waiting: null, installing: null, update: vi.fn().mockResolvedValue(undefined) });
    const serviceWorker = Object.assign(new EventTarget(), { controller: {}, register: vi.fn().mockResolvedValue(registration) });
    vi.stubGlobal('navigator', { serviceWorker, onLine: true });
    render(<AppUpdate />);
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    serviceWorker.controller = {};
    act(() => serviceWorker.dispatchEvent(new Event('controllerchange')));
    expect(screen.getByRole('button', { name: 'Atualizar agora' })).toBeInTheDocument();
  });
  it('warns before activating a waiting version and only activates on user action', async () => {
    vi.stubEnv('PROD', true);
    const postMessage = vi.fn();
    const registration = Object.assign(new EventTarget(), { active: {}, waiting: { postMessage }, installing: null, update: vi.fn().mockResolvedValue(undefined) });
    const serviceWorker = Object.assign(new EventTarget(), { register: vi.fn().mockResolvedValue(registration) });
    vi.stubGlobal('navigator', { serviceWorker, onLine: true });
    render(<AppUpdate />);
    await screen.findByRole('button', { name: 'Atualizar agora' });
    expect(screen.getByText(/atualizar reinicia esta tela/)).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('keeps the page when an update check fails', async () => {
    vi.stubEnv('PROD', true);
    const registration = Object.assign(new EventTarget(), { waiting: null, installing: null, update: vi.fn().mockRejectedValue(new Error('offline')) });
    const serviceWorker = Object.assign(new EventTarget(), { register: vi.fn().mockResolvedValue(registration) });
    vi.stubGlobal('navigator', { serviceWorker, onLine: false });
    render(<AppUpdate />);
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Verificar atualização' }));
    await screen.findByText(/Sem conexão para verificar atualizações/);
    expect(screen.queryByRole('button', { name: 'Atualizar agora' })).not.toBeInTheDocument();
  });
});
