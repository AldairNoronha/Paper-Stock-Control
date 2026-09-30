import { lazy, Suspense, useState } from 'react';
import { PhotoReader, type PhotoReaderProps } from './PhotoReader';

const LegacyReader = lazy(async () => ({ default: (await import('../label-reader/LabelReader')).LabelReader }));

export function ReaderWorkspace(props: PhotoReaderProps) {
  const [legacy, setLegacy] = useState(false);
  return <>
    <div className="reader-modes" aria-label="Modo de leitura">
      <button type="button" aria-pressed={!legacy} onClick={() => setLegacy(false)}>V2 · Foto completa</button>
      <button type="button" aria-pressed={legacy} onClick={() => setLegacy(true)}>Leitor anterior</button>
    </div>
    {legacy ? <><p className="photo-warning">Leitor anterior: OCR contínuo no celular. Mantido para comparação; não é o novo fluxo V2.</p><Suspense fallback={<p>Abrindo leitor anterior…</p>}><LegacyReader persistence={props.persistence} /></Suspense></> : <PhotoReader {...props} />}
  </>;
}
