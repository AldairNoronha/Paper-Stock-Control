import { useEffect, useId, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';

import { analyzeLabel, ImageQualityError, recalculateAnalysis } from './analyzer';
import {
  confidenceLabel,
  confidenceLevel,
  fieldValue,
  formatArea,
  formatDuration
} from './format';
import type {
  AnalysisProgress,
  FieldReading,
  ImageQualityResult,
  LabelAnalysisResult,
  LabelFields,
  SupplierCode
} from './types';

const initialProgress: AnalysisProgress = {
  stage: 'quality',
  progress: 0,
  message: 'Preparando análise…'
};

export function LabelReader() {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(initialProgress);
  const [result, setResult] = useState<LabelAnalysisResult | null>(null);
  const [qualityFailure, setQualityFailure] = useState<ImageQualityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const criticalComplete = useMemo(() => {
    if (!result) return false;
    const { fields } = result;
    return Boolean(
      fields.supplier.value &&
        fields.supplier.value !== 'UNKNOWN' &&
        fields.supplierMaterialName.value &&
        (fields.lotCode.value || fields.supplierPalletCode.value) &&
        fields.quantitySheets.value &&
        fields.widthMm.value &&
        fields.lengthMm.value
    );
  }, [result]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setError('Selecione uma fotografia em formato de imagem.');
      return;
    }
    if (selected.size > 18 * 1024 * 1024) {
      setError('A fotografia ultrapassa 18 MB. Reduza a resolução e tente novamente.');
      return;
    }
    setFile(selected);
    setResult(null);
    setQualityFailure(null);
    setError(null);
    setApproved(false);
    setProgress(initialProgress);
  }

  async function runAnalysis() {
    if (!file || isAnalyzing) return;
    setIsAnalyzing(true);
    setError(null);
    setQualityFailure(null);
    setResult(null);
    setApproved(false);
    try {
      setResult(await analyzeLabel(file, setProgress));
    } catch (caught) {
      if (caught instanceof ImageQualityError) {
        setQualityFailure(caught.result);
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Não foi possível processar a fotografia. Tente novamente.'
        );
      }
    } finally {
      setIsAnalyzing(false);
    }
  }

  function updateField<K extends keyof LabelFields>(key: K, value: string) {
    if (!result) return;
    const numericFields = new Set<keyof LabelFields>([
      'quantitySheets',
      'widthMm',
      'lengthMm',
      'declaredAreaM2'
    ]);
    const parsedNumber = Number(value.replace(',', '.'));
    const normalized = numericFields.has(key)
      ? value === '' || !Number.isFinite(parsedNumber)
        ? null
        : parsedNumber
      : value.trim() || null;
    const fields = {
      ...result.fields,
      [key]: {
        value: normalized,
        confidence: normalized === null ? 0 : 1,
        sources: normalized === null ? [] : ['MANUAL']
      }
    } as LabelFields;
    setResult(recalculateAnalysis(result, fields));
    setApproved(false);
  }

  function approveReading() {
    if (!result || !criticalComplete) return;
    const draft = {
      approvedAt: new Date().toISOString(),
      parserName: result.parserName,
      parserVersion: result.parserVersion,
      fields: result.fields,
      validation: result.validation
    };
    localStorage.setItem('paper-stock:last-approved-label-reading', JSON.stringify(draft));
    setApproved(true);
  }

  function reset() {
    setFile(null);
    setResult(null);
    setQualityFailure(null);
    setError(null);
    setApproved(false);
    setProgress(initialProgress);
  }

  return (
    <section className="reader-card" aria-labelledby="reader-title">
      <div className="reader-heading">
        <div>
          <p className="eyebrow">LEITURA PILOTO NO APARELHO</p>
          <h2 id="reader-title">Fotografe a etiqueta</h2>
          <p>
            Enquadre somente a etiqueta, evite reflexos e mantenha o celular firme.
          </p>
        </div>
        <span className="privacy-pill">Processamento local</span>
      </div>

      {!previewUrl ? (
        <label className="camera-button" htmlFor={inputId}>
          <CameraIcon />
          <span>Abrir câmera</span>
          <small>ou escolher uma foto existente</small>
        </label>
      ) : (
        <div className="capture-layout">
          <div className="photo-panel">
            <img className="label-preview" src={previewUrl} alt="Etiqueta selecionada" />
            <div className="photo-actions">
              <label className="secondary-button" htmlFor={inputId}>
                Trocar foto
              </label>
              <button className="primary-button" type="button" onClick={runAnalysis} disabled={isAnalyzing}>
                {isAnalyzing ? 'Analisando…' : result ? 'Analisar novamente' : 'Ler etiqueta'}
              </button>
            </div>
          </div>

          {isAnalyzing && <ProgressPanel progress={progress} />}
          {qualityFailure && <QualityFailure quality={qualityFailure} onReset={reset} />}
          {error && <ErrorPanel message={error} />}
          {result && (
            <ReviewPanel
              result={result}
              criticalComplete={criticalComplete}
              approved={approved}
              onFieldChange={updateField}
              onApprove={approveReading}
              onReset={reset}
            />
          )}
        </div>
      )}

      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={selectFile}
      />
    </section>
  );
}

function ProgressPanel({ progress }: { progress: AnalysisProgress }) {
  return (
    <div className="progress-panel" role="status" aria-live="polite">
      <div className="progress-copy">
        <span>{progress.message}</span>
        <strong>{Math.round(progress.progress * 100)}%</strong>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${progress.progress * 100}%` }} />
      </div>
      <small>Na primeira leitura, o navegador precisa preparar o OCR.</small>
    </div>
  );
}

function QualityFailure({ quality, onReset }: { quality: ImageQualityResult; onReset: () => void }) {
  return (
    <div className="message-panel danger" role="alert">
      <strong>Não foi possível ler com segurança</strong>
      <ul>
        {quality.issues.map((issue) => (
          <li key={issue.code}>{issue.message}</li>
        ))}
      </ul>
      <button className="secondary-button" type="button" onClick={onReset}>
        Tirar nova foto
      </button>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="message-panel danger" role="alert">
      <strong>Leitura interrompida</strong>
      <p>{message}</p>
      <small>Verifique a conexão na primeira leitura e tente novamente.</small>
    </div>
  );
}

interface ReviewPanelProps {
  result: LabelAnalysisResult;
  criticalComplete: boolean;
  approved: boolean;
  onFieldChange: <K extends keyof LabelFields>(key: K, value: string) => void;
  onApprove: () => void;
  onReset: () => void;
}

function ReviewPanel({
  result,
  criticalComplete,
  approved,
  onFieldChange,
  onApprove,
  onReset
}: ReviewPanelProps) {
  const overallLevel = confidenceLevel(result.overallConfidence);
  return (
    <div className="review-panel">
      <div className="review-summary">
        <div>
          <p className="eyebrow">ETIQUETA ANALISADA</p>
          <h3>{result.fields.supplier.value ?? 'Fornecedor não identificado'}</h3>
          <p>{result.reviewRequired ? 'Revise os campos destacados.' : 'Leitura consistente. Confirme os dados.'}</p>
        </div>
        <div className={`confidence-ring ${overallLevel}`}>
          <strong>{Math.round(result.overallConfidence * 100)}%</strong>
          <span>confiança</span>
        </div>
      </div>

      <div className="quality-strip">
        <span>{result.quality.width} × {result.quality.height}px</span>
        <span>{result.detectedCodes.length ? `${result.detectedCodes.length} código lido` : 'Somente OCR'}</span>
        <span>{formatDuration(result.elapsedMs)}</span>
      </div>

      {result.quality.issues.length > 0 && (
        <div className="message-panel warning">
          {result.quality.issues.map((issue) => <span key={issue.code}>{issue.message}</span>)}
        </div>
      )}

      <div className="field-grid">
        <SelectField
          label="Fornecedor *"
          field={result.fields.supplier}
          onChange={(value) => onFieldChange('supplier', value)}
        />
        <TextField
          label="Material *"
          field={result.fields.supplierMaterialName}
          onChange={(value) => onFieldChange('supplierMaterialName', value)}
        />
        <TextField
          label="Lote"
          field={result.fields.lotCode}
          onChange={(value) => onFieldChange('lotCode', value)}
        />
        <TextField
          label="Código do pallet"
          field={result.fields.supplierPalletCode}
          onChange={(value) => onFieldChange('supplierPalletCode', value)}
        />
        <NumberField
          label="Quantidade de folhas *"
          field={result.fields.quantitySheets}
          onChange={(value) => onFieldChange('quantitySheets', value)}
        />
        <NumberField
          label="Largura (mm) *"
          field={result.fields.widthMm}
          onChange={(value) => onFieldChange('widthMm', value)}
        />
        <NumberField
          label="Comprimento (mm) *"
          field={result.fields.lengthMm}
          onChange={(value) => onFieldChange('lengthMm', value)}
        />
        <NumberField
          label="Área declarada (m²)"
          field={result.fields.declaredAreaM2}
          step="0.001"
          onChange={(value) => onFieldChange('declaredAreaM2', value)}
        />
        <TextField
          label="Produção"
          field={result.fields.manufacturedAt}
          onChange={(value) => onFieldChange('manufacturedAt', value)}
        />
        <TextField
          label="Validade"
          field={result.fields.expiresOn}
          onChange={(value) => onFieldChange('expiresOn', value)}
        />
        <TextField
          label="Orientação"
          field={result.fields.orientation}
          onChange={(value) => onFieldChange('orientation', value)}
        />
      </div>

      <div className={`area-check ${result.validation.areaConsistent === false ? 'invalid' : ''}`}>
        <div>
          <span>Área calculada</span>
          <strong>{formatArea(result.validation.calculatedAreaM2)} m²</strong>
        </div>
        <p>
          {result.validation.areaConsistent === true && '✓ Área declarada confere com dimensões × folhas.'}
          {result.validation.areaConsistent === false && '⚠ A área declarada diverge do cálculo. Confira os valores.'}
          {result.validation.areaConsistent === null && 'Informe dimensões, folhas e área para validar matematicamente.'}
        </p>
      </div>

      {!criticalComplete && (
        <div className="message-panel warning" role="alert">
          <strong>Preencha os campos obrigatórios antes de aprovar.</strong>
          {result.validation.missingCriticalFields.length > 0 && (
            <span>Não identificados: {result.validation.missingCriticalFields.join(', ')}.</span>
          )}
        </div>
      )}

      {approved && (
        <div className="message-panel success" role="status">
          <strong>Leitura aprovada para o teste.</strong>
          <span>Nenhum estoque foi criado. O rascunho ficou salvo somente neste aparelho.</span>
        </div>
      )}

      <div className="review-actions">
        <button className="secondary-button" type="button" onClick={onReset}>Nova foto</button>
        <button className="primary-button" type="button" disabled={!criticalComplete} onClick={onApprove}>
          Aprovar leitura
        </button>
      </div>

      <details className="technical-details">
        <summary>Detalhes técnicos da leitura</summary>
        <p>Parser: {result.parserName} v{result.parserVersion}</p>
        {result.detectedCodes.map((code) => <code key={code.value}>{code.value}</code>)}
        <pre>{result.rawText || 'OCR não encontrou texto.'}</pre>
      </details>
    </div>
  );
}

interface FieldProps<T> {
  label: string;
  field: FieldReading<T>;
  onChange: (value: string) => void;
}

function FieldFrame<T>({ label, field, children }: FieldProps<T> & { children: React.ReactNode }) {
  const level = confidenceLevel(field.confidence);
  return (
    <label className={`review-field ${level}`}>
      <span className="field-label">
        {label}
        <small>{confidenceLabel(field.confidence)}</small>
      </span>
      {children}
      <span className="field-source">{field.sources.join(' + ') || 'Revisão necessária'}</span>
    </label>
  );
}

function TextField(props: FieldProps<string>) {
  return (
    <FieldFrame {...props}>
      <input value={fieldValue(props.field)} onChange={(event) => props.onChange(event.target.value)} />
    </FieldFrame>
  );
}

function NumberField(props: FieldProps<number> & { step?: string }) {
  return (
    <FieldFrame {...props}>
      <input
        type="number"
        min="0"
        step={props.step ?? '1'}
        inputMode="decimal"
        value={fieldValue(props.field)}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </FieldFrame>
  );
}

function SelectField(props: FieldProps<SupplierCode>) {
  return (
    <FieldFrame {...props}>
      <select value={fieldValue(props.field)} onChange={(event) => props.onChange(event.target.value)}>
        <option value="">Selecione</option>
        <option value="IMPRESS">Impress</option>
        <option value="SCHATTDECOR">Schattdecor</option>
        <option value="INTERPRINT">Interprint</option>
      </select>
    </FieldFrame>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3 7.5 5H5a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3h-2.5L15 3H9Zm3 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
    </svg>
  );
}
