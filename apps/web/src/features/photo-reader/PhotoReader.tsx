import { useEffect, useRef, useState } from 'react';
import type { RuntimeConfig } from '../../lib/runtime';
import { analyzePhoto } from './api';
import { emptyValues, fieldKeys, fieldLabels, invalidField, requiredFields,
  type FieldKey, type PhotoAnalysis, type Values } from './contracts';

export interface PhotoReaderProps {
  config?: RuntimeConfig;
  persistence?: { config: RuntimeConfig; accessToken: string };
}

export function PhotoReader({ config, persistence }: PhotoReaderProps) {
  const runtime = persistence?.config ?? config;
  const [service, setService] = useState<'checking' | 'ready' | 'disabled' | 'offline'>('checking');
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState('');
  const [result, setResult] = useState<PhotoAnalysis | null>(null);
  const [values, setValues] = useState<Values>(emptyValues);
  const [confirmed, setConfirmed] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<FieldKey>('material');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [consent, setConsent] = useState(false);
  const [retryStatus, setRetryStatus] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const evidence = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runtime) return;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => { setService('offline'); abort.abort(); }, 15000);
    void fetch(`${runtime.apiBaseUrl}/labels/photo-analysis/status`, { signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Servidor indisponível');
        const status: unknown = await response.json();
        if (!status || typeof status !== 'object' || !('enabled' in status) || typeof status.enabled !== 'boolean') {
          throw new Error('Servidor ainda sem V2');
        }
        setService(status.enabled ? 'ready' : 'disabled');
      }).catch(() => { if (!abort.signal.aborted) setService('offline'); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); abort.abort(); };
  }, [runtime, retryStatus]);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhoto(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => controller.current?.abort(), []);

  function selectPhoto(selected?: File) {
    if (!selected) return;
    if (!['image/jpeg', 'image/png'].includes(selected.type) || selected.size > 10 * 1024 * 1024) {
      setError('Escolha uma foto JPEG ou PNG de até 10 MB.'); return;
    }
    controller.current?.abort();
    setFile(selected); setResult(null); setValues(emptyValues()); setConfirmed({});
    setReviewing(false); setConsent(false); setError(''); setNotice('');
  }

  async function analyze() {
    if (!file || !persistence || busy || !consent) return;
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 95000);
    setBusy(true); setError(''); setNotice('');
    try {
      const analysis = await analyzePhoto(file, persistence.config, persistence.accessToken, abort.signal);
      if (abort.signal.aborted) return;
      setResult(analysis);
      setValues(Object.fromEntries(fieldKeys.map(key => [key, analysis.fields[key].value ?? ''])) as Values);
      setConfirmed({}); setReviewing(true);
    } catch (failure) {
      if (controller.current === abort) setError(failure instanceof Error ? failure.message : 'Falha na análise da foto.');
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === abort) { setBusy(false); controller.current = null; }
    }
  }

  function downloadReview() {
    if (!file) return;
    const report = {
      version: 'photo-review-v2.1', reviewed_at: new Date().toISOString(),
      photo: { filename: file.name, size: file.size, last_modified: file.lastModified },
      stock_written: false, values, confirmed,
      edits: fieldKeys.filter(key => values[key] !== (result?.fields[key].value ?? '')),
      original_analysis: result,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'revisao-etiqueta-v2.json'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Revisão exportada. Nenhum pallet foi criado e o estoque não foi alterado. Guarde também a foto original.');
  }

  const required = requiredFields(values);
  const readyToExport = required.every(key => values[key].trim() && confirmed[key])
    && fieldKeys.every(key => !invalidField(key, values[key]) && (!values[key].trim() || confirmed[key]));
  const selectedSource = result?.fields[focus];
  const box = selectedSource?.box;
  const detailBox = box && result ? {
    x: Math.max(0, box.x - 0.02) * result.image_width,
    y: Math.max(0, box.y - 0.02) * result.image_height,
    width: Math.min(1 - Math.max(0, box.x - 0.02), Math.max(0.06, box.width + 0.04)) * result.image_width,
    height: Math.min(1 - Math.max(0, box.y - 0.02), Math.max(0.04, box.height + 0.04)) * result.image_height,
  } : null;
  const calculated = values.sheets && values.width_mm && values.length_mm
    && !['sheets', 'width_mm', 'length_mm'].some(key => invalidField(key as FieldKey, values[key as FieldKey]))
    ? +values.sheets * +values.width_mm * +values.length_mm / 1000000 : null;
  const areaMismatch = calculated !== null && values.area_m2 && Math.abs(+values.area_m2 - calculated) > Math.max(0.05, calculated * 0.005);
  const unavailable = !runtime ? 'API não configurada neste aplicativo.'
    : service === 'checking' ? 'Verificando o servidor de leitura…'
    : service === 'disabled' ? 'OCR V2 não ativado: falta configurar o Google Cloud Vision no servidor.'
    : service === 'offline' ? 'Servidor sem resposta ou ainda sem a V2. A análise não está disponível.'
    : !persistence ? 'OCR disponível. Entre no modo operacional para analisar a foto.' : 'OCR no servidor disponível.';

  return <section className="reader-card photo-reader" aria-labelledby="photo-reader-title">
    <div className="reader-heading"><div><p className="eyebrow">V2 · FOTO COMPLETA</p>
      <h2 id="photo-reader-title">Fotografe a etiqueta inteira</h2>
      <p>Uma foto, todos os campos juntos. QR não é necessário. Nada é salvo no estoque neste teste.</p>
    </div></div>
    <ol className="photo-steps"><li>Foto nítida</li><li>Análise no servidor</li><li>Revisão pela imagem</li></ol>
    <div className={`photo-service ${service === 'ready' && runtime ? 'ready' : ''}`}>
      <p>{unavailable}</p>
      {runtime && !busy && <button type="button" onClick={() => { setService('checking'); setRetryStatus(value => value + 1); }}>Verificar serviço</button>}
    </div>
    <div className="photo-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={() => camera.current?.click()}>Tirar foto completa</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => gallery.current?.click()}>Escolher da galeria</button>
    </div>
    <input ref={camera} type="file" accept="image/jpeg,image/png" capture="environment" aria-label="Foto pela câmera" hidden onChange={event => { selectPhoto(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={gallery} type="file" accept="image/jpeg,image/png" aria-label="Foto da galeria" hidden onChange={event => { selectPhoto(event.target.files?.[0]); event.target.value = ''; }} />
    <p className="photo-tip">Use a etiqueta física, com boa luz e sem reflexos. Inclua as bordas e aproxime até o texto ficar legível. JPEG ou PNG, até 10 MB e 20 megapixels.</p>
    {photo && <div className="photo-review-layout">
      <div className="photo-evidence" ref={evidence}>
        <figure>
          <div className="photo-source"><img src={photo} alt="Foto completa da etiqueta selecionada" />
            {reviewing && box && <span className="photo-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} />}
          </div>
          <figcaption>{file?.name} · foto completa, sem recorte automático</figcaption>
        </figure>
        {reviewing && <div className="photo-source-caption"><strong>Origem: {fieldLabels[focus]}</strong>
          {detailBox && result && <svg className="photo-detail" role="img" aria-label={`Trecho ampliado: ${fieldLabels[focus]}`} viewBox={`${detailBox.x} ${detailBox.y} ${detailBox.width} ${detailBox.height}`}>
            <image href={photo} width={result.image_width} height={result.image_height} />
          </svg>}
          <p>{selectedSource?.source_text ? `Texto lido: “${selectedSource.source_text}”` : 'Sem origem reconhecida. Confira a foto e preencha manualmente.'}</p>
          {values[focus] !== (selectedSource?.value ?? '') && values[focus] && <p>Valor editado manualmente; o destaque mostra a leitura original.</p>}
        </div>}
      </div>
      <div>
        {!reviewing && <div className="photo-start">
          <label className="photo-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
            Autorizo enviar esta foto ao servidor e ao Google Cloud Vision para extrair o texto. Pode consumir a cota do serviço.</label>
          <button type="button" className="primary-button" disabled={busy || !consent || !persistence || service !== 'ready'} onClick={() => void analyze()}>{busy ? 'Analisando a foto completa…' : 'Analisar foto no servidor'}</button>
          {busy && <button type="button" className="secondary-button" onClick={() => controller.current?.abort()}>Interromper espera</button>}
          <button type="button" className="secondary-button" disabled={busy} onClick={() => { setReviewing(true); setResult(null); setValues(emptyValues()); setConfirmed({}); setError(''); }}>Preencher manualmente sem enviar foto</button>
        </div>}
        {reviewing && <div className="photo-fields"><h3>Confira cada valor na foto</h3>
          <p>Nenhum campo é aprovado automaticamente. Toque em “Ver origem” e marque os valores que conferiu.</p>
          {fieldKeys.map(key => {
            const source = result?.fields[key];
            const manual = values[key] !== (source?.value ?? '');
            const invalid = invalidField(key, values[key]);
            return <div className={`photo-field ${focus === key ? 'focused' : ''}`} key={key}>
              <div className="photo-field-heading"><label htmlFor={`photo-${key}`}>{fieldLabels[key]}{required.includes(key) ? ' *' : ''}</label>
                <button type="button" onClick={() => { setFocus(key); evidence.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Ver origem</button></div>
              <input id={`photo-${key}`} type={key.endsWith('_date') ? 'date' : 'text'} value={values[key]} aria-invalid={invalid}
                inputMode={['sheets', 'width_mm', 'length_mm', 'pallet_number'].includes(key) ? 'numeric' : undefined}
                maxLength={200} onFocus={() => setFocus(key)} onChange={event => { setValues(current => ({ ...current, [key]: event.target.value })); setConfirmed(current => ({ ...current, [key]: false })); setNotice(''); }} />
              <small>{invalid ? 'Valor inválido. Confira formato e unidade.' : manual ? 'Preenchido / corrigido manualmente' : source?.status === 'ambiguous' ? 'Leituras conflitantes — preencha manualmente' : !values[key] ? 'Não identificado' : 'Sugestão de OCR — conferir'}</small>
              {values[key].trim() && <label className="photo-check"><input type="checkbox" checked={!!confirmed[key]} disabled={invalid} onChange={event => { setConfirmed(current => ({ ...current, [key]: event.target.checked })); setNotice(''); }} />Conferi este valor na etiqueta</label>}
            </div>;
          })}
          {calculated !== null && <p className={areaMismatch ? 'photo-warning' : 'photo-calculated'}>Área calculada: {calculated.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m² (folhas × largura × comprimento). {areaMismatch ? 'Diverge da área declarada; revise antes de usar.' : 'Não substitui a área impressa.'}</p>}
          <p className="photo-tip">Lote, código do pallet, número sequencial e SSCC são identificadores diferentes. Peso em kg nunca é quantidade de folhas.</p>
          {!!result?.warnings.length && <ul className="photo-warnings">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <button type="button" className="primary-button" disabled={!readyToExport || !!areaMismatch} onClick={downloadReview}>Exportar revisão do teste</button>
          <p className="photo-tip">Confirme todos os valores preenchidos e os campos obrigatórios (*). É necessário lote ou código do pallet. Esta exportação não movimenta estoque.</p>
          {result && <details><summary>Texto completo reconhecido</summary><pre className="photo-raw">{result.raw_text || 'Nenhum texto reconhecido.'}</pre></details>}
        </div>}
      </div>
    </div>}
    {error && <p className="photo-warning" role="alert">{error} Nenhum dado foi salvo no estoque.</p>}
    {notice && <p className="photo-notice" role="status">{notice}</p>}
  </section>;
}
