import { useEffect, useRef, useState } from 'react';

export const APP_RELEASE = '2026.09.30.2';

export function AppUpdate() {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadChosen = useRef(false);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    const serviceWorker = navigator.serviceWorker;
    let knownController = serviceWorker.controller;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const inspect = () => { if (!disposed && registration?.waiting && registration.active) setAvailable(true); };
    const installed = () => { if (installing?.state === 'installed') inspect(); };
    const updateFound = () => {
      installing?.removeEventListener('statechange', installed);
      installing = registration?.installing ?? null;
      installing?.addEventListener('statechange', installed);
    };
    const checkOnReturn = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void registration?.update().catch(() => undefined);
    };
    const changed = () => {
      if (reloadChosen.current) window.location.reload();
      else if (!disposed && knownController && knownController !== serviceWorker.controller) setAvailable(true);
      knownController = serviceWorker.controller;
    };
    serviceWorker.addEventListener('controllerchange', changed);
    document.addEventListener('visibilitychange', checkOnReturn);
    void serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then((value) => {
      if (disposed) return;
      registration = value;
      registrationRef.current = value;
      value.addEventListener('updatefound', updateFound);
      inspect(); updateFound();
      void value.update().catch(() => undefined);
    }).catch(() => { if (!disposed) setMessage('Não foi possível verificar atualizações. Tente novamente quando estiver conectado.'); });
    return () => {
      disposed = true;
      registrationRef.current = null;
      registration?.removeEventListener('updatefound', updateFound);
      installing?.removeEventListener('statechange', installed);
      serviceWorker.removeEventListener('controllerchange', changed);
      document.removeEventListener('visibilitychange', checkOnReturn);
    };
  }, []);

  async function check() {
    try {
      if (!registrationRef.current) { setMessage('Reabra o aplicativo conectado à internet para verificar a versão.'); return; }
      await registrationRef.current.update();
      if (registrationRef.current.waiting) setAvailable(true);
      setMessage('Verificação solicitada. Uma nova versão será indicada aqui quando estiver pronta.');
    } catch { setMessage('Sem conexão para verificar atualizações. Sua leitura foi mantida.'); }
  }

  function update() {
    reloadChosen.current = true;
    if (registrationRef.current?.waiting) registrationRef.current.waiting.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  }

  return (
    <div className="app-update">
      <span>Leitor {APP_RELEASE}</span>
      {available ? (
        <>
          <p>Nova versão disponível. Salve ou conclua a leitura: atualizar reinicia esta tela.</p>
          <button type="button" onClick={update}>Atualizar agora</button>
        </>
      ) : <button type="button" onClick={() => void check()}>Verificar atualização</button>}
      {message && !available && <p aria-live="polite">{message}</p>}
    </div>
  );
}
