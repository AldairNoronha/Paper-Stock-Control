import { useEffect, useMemo, useState } from 'react';

import type { RuntimeConfig } from '../../lib/runtime';
import { analyzeLabel, ImageQualityError, recalculateAnalysis } from './analyzer';
import {
  loadReceivingCatalog,
  persistReceipt
} from './api';
import type { ReceiptResult, ReceivingCatalog } from './api';
import {
  confidenceLabel,
  confidenceLevel,
  fieldValue,
  formatArea,
  formatDuration
} from './format';
import { GuidedScanner } from './GuidedScanner';
import { isValidSscc, parseSscc } from './sscc';
import type {
  AnalysisProgress,
  CaptureEvidence,
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

interface LabelReaderProps {
  persistence?: { config: RuntimeConfig; accessToken: string };
}

export function LabelReader({ persistence }: LabelReaderProps = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [evidence, setEvidence] = useState<CaptureEvidence[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(initialProgress);
  const [result, setResult] = useState<LabelAnalysisResult | null>(null);
  const [qualityFailure, setQualityFailure] = useState<ImageQualityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [approved, setApproved] = useState(false);
  const [catalog, setCatalog] = useState<ReceivingCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [scanId, setScanId] = useState<string | undefined>();
  const [receipt, setReceipt] = useState<ReceiptResult | null>(null);
  const [receiptKey, setReceiptKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!persistence) return;
    setCatalogError(null);
    void loadReceivingCatalog(persistence.config, persistence.accessToken)
      .then((loaded) => {
        setCatalog(loaded);
        if (loaded.locations.length === 1) setSelectedLocationId(loaded.locations[0].id);
      })
      .catch((caught: unknown) => {
        setCatalogError(caught instanceof Error ? caught.message : 'Não foi possível carregar o catálogo.');
      });
  }, [persistence]);

  useEffect(() => {
    if (!catalog || !result) return;
    const supplier = catalog.suppliers.find((item) => item.code === result.fields.supplier.value);
    if (!supplier) return;
    const mappedMaterialIds = new Set(
      catalog.mappings.filter((item) => item.supplier_id === supplier.id).map((item) => item.material_id)
    );
    const compatible = catalog.materials.filter(
      (item) =>
        mappedMaterialIds.has(item.id) &&
        item.width_mm === result.fields.widthMm.value &&
        item.length_mm === result.fields.lengthMm.value
    );
    if (compatible.length === 1) setSelectedMaterialId(compatible[0].id);
  }, [catalog, result]);

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
    return result.validation.missingCriticalFields.length === 0;
  }, [result]);

  function selectFile(selected: File) {
    if (!selected.type.startsWith('image/')) {
      setError('Selecione uma fotografia em formato de imagem.');
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError('A fotografia ultrapassa 10 MB. Reduza a resolução e tente novamente.');
      return;
    }
    setFile(selected);
    setEvidence([]);
    setResult(null);
    setQualityFailure(null);
    setError(null);
    setApproved(false);
    setReceipt(null);
    setScanId(undefined);
    setReceiptKey(crypto.randomUUID());
    setProgress(initialProgress);
  }

  function reviewGuidedReading(
    overview: File,
    guidedResult: LabelAnalysisResult,
    guidedEvidence: CaptureEvidence[]
  ) {
    setFile(overview);
    setEvidence(guidedEvidence);
    setResult(guidedResult);
    setQualityFailure(null);
    setError(null);
    setApproved(false);
    setReceipt(null);
    setScanId(undefined);
    setReceiptKey(crypto.randomUUID());
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
      : key === 'supplierSscc'
        ? parseSscc(value) ?? (value.trim() || null)
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

  async function approveReading() {
    if (!result || !file || !criticalComplete) return;
    if (persistence) {
      if (!catalog || !selectedMaterialId || !selectedLocationId) return;
      const supplier = catalog.suppliers.find((item) => item.code === result.fields.supplier.value);
      if (!supplier) {
        setError('O fornecedor identificado não existe no catálogo ativo.');
        return;
      }
      setIsSaving(true);
      setError(null);
      try {
        const saved = await persistReceipt(
          persistence.config,
          persistence.accessToken,
          file,
          result,
          supplier.id,
          selectedMaterialId,
          selectedLocationId,
          receiptKey,
          evidence,
          scanId,
          setScanId
        );
        setReceipt(saved.receipt);
        setApproved(true);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Não foi possível confirmar a entrada.');
      } finally {
        setIsSaving(false);
      }
      return;
    }
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
    setEvidence([]);
    setResult(null);
    setQualityFailure(null);
    setError(null);
    setApproved(false);
    setReceipt(null);
    setScanId(undefined);
    setReceiptKey(crypto.randomUUID());
    setProgress(initialProgress);
  }

  return (
    <section className="reader-card" aria-labelledby="reader-title">
      <div className="reader-heading">
        <div>
          <p className="eyebrow">LEITURA GUIADA NO APARELHO</p>
          <h2 id="reader-title">Percorra a etiqueta com a câmera</h2>
          <p>
            O leitor coleta QR, códigos e textos por partes e avisa o que ainda falta.
          </p>
        </div>
        <span className="privacy-pill">Processamento local</span>
      </div>

      {!file && !result ? (
        <GuidedScanner onReview={reviewGuidedReading} onPhotoSelected={selectFile} />
      ) : (
        <div className="capture-layout">
          <div className="photo-panel">
            {previewUrl && <img className="label-preview" src={previewUrl} alt="Etiqueta selecionada" />}
            {evidence.length === 0 && (
              <div className="photo-actions">
                {!result && <button className="secondary-button" type="button" onClick={reset}>Cancelar foto</button>}
                <button className="primary-button" type="button" onClick={runAnalysis} disabled={isAnalyzing}>
                  {isAnalyzing ? 'Analisando…' : result ? 'Analisar novamente' : 'Ler etiqueta'}
                </button>
              </div>
            )}
          </div>

          {isAnalyzing && <ProgressPanel progress={progress} />}
          {qualityFailure && <QualityFailure quality={qualityFailure} onReset={reset} />}
          {error && <ErrorPanel message={error} />}
          {result && (
            <ReviewPanel
              result={result}
              criticalComplete={criticalComplete}
              approved={approved}
              persistenceEnabled={Boolean(persistence)}
              catalog={catalog}
              catalogError={catalogError}
              selectedMaterialId={selectedMaterialId}
              selectedLocationId={selectedLocationId}
              isSaving={isSaving}
              receipt={receipt}
              onFieldChange={updateField}
              onApprove={() => void approveReading()}
              onMaterialChange={setSelectedMaterialId}
              onLocationChange={setSelectedLocationId}
              onReset={reset}
            />
          )}
        </div>
      )}

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
  persistenceEnabled: boolean;
  catalog: ReceivingCatalog | null;
  catalogError: string | null;
  selectedMaterialId: string;
  selectedLocationId: string;
  isSaving: boolean;
  receipt: ReceiptResult | null;
  onFieldChange: <K extends keyof LabelFields>(key: K, value: string) => void;
  onApprove: () => void;
  onMaterialChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onReset: () => void;
}

function ReviewPanel({
  result,
  criticalComplete,
  approved,
  persistenceEnabled,
  catalog,
  catalogError,
  selectedMaterialId,
  selectedLocationId,
  isSaving,
  receipt,
  onFieldChange,
  onApprove,
  onMaterialChange,
  onLocationChange,
  onReset
}: ReviewPanelProps) {
  const overallLevel = result.validation.missingCriticalFields.length > 0 || result.validation.areaConsistent === false
    ? 'low'
    : confidenceLevel(result.overallConfidence);
  const qrCount = result.detectedCodes.filter((code) => code.format === 'QR_CODE').length;
  const barcodeCount = result.detectedCodes.filter((code) => code.format !== 'QR_CODE' && code.format !== 'DATA_MATRIX').length;
  const matrixCount = result.detectedCodes.filter((code) => code.format === 'DATA_MATRIX').length;
  const detectedSupplier = catalog?.suppliers.find(
    (supplier) => supplier.code === result.fields.supplier.value
  );
  const allowedMaterialIds = new Set(
    catalog?.mappings
      .filter((mapping) => mapping.supplier_id === detectedSupplier?.id)
      .map((mapping) => mapping.material_id) ?? []
  );
  const materialOptions = catalog?.materials.filter((material) => allowedMaterialIds.has(material.id)) ?? [];
  return (
    <div className="review-panel">
      <div className="review-summary">
        <div>
          <p className="eyebrow">ETIQUETA ANALISADA</p>
          <h3>{result.fields.supplier.value ?? 'Fornecedor não identificado'}</h3>
          <p>{result.validation.missingCriticalFields.length > 0
            ? 'Leitura parcial. Complete os campos destacados.'
            : result.reviewRequired ? 'Revise os campos destacados.' : 'Dados obrigatórios encontrados. Confira a etiqueta.'}</p>
        </div>
        <div className={`confidence-ring ${overallLevel}`}>
          <strong>{Math.round(result.overallConfidence * 100)}%</strong>
          <span>estimativa</span>
        </div>
      </div>

      <div className="quality-strip">
        <span>{result.quality.width} × {result.quality.height}px</span>
        <span>QR: {qrCount} · Barras: {barcodeCount}{matrixCount > 0 ? ` · Data Matrix: ${matrixCount}` : ''}</span>
        <span>{formatDuration(result.elapsedMs)}</span>
      </div>

      {result.fields.supplier.value === 'IMPRESS' && !isValidSscc(result.fields.supplierSscc.value) && (
        <div className="message-panel warning" role="alert">
          <strong>{result.fields.supplierSscc.value
            ? 'SSCC inválido. Confira o número e seu dígito verificador.'
            : 'O código de barras (SSCC) ainda não foi identificado.'}</strong>
          <span>Aproxime a câmera das barras ou digite o número de 18 dígitos impresso após (00). O QR e o código do pallet são identificadores separados.</span>
        </div>
      )}

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
          label="Lote (quando informado)"
          field={result.fields.lotCode}
          onChange={(value) => onFieldChange('lotCode', value)}
        />
        <TextField
          label="Código do pallet"
          field={result.fields.supplierPalletCode}
          onChange={(value) => onFieldChange('supplierPalletCode', value)}
        />
        <TextField
          label={result.fields.supplier.value === 'IMPRESS' ? 'Código de barras (SSCC) *' : 'Código de barras (SSCC)'}
          field={result.fields.supplierSscc}
          onChange={(value) => onFieldChange('supplierSscc', value)}
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

      {persistenceEnabled && (
        <div className="receiving-fields">
          <p className="eyebrow">DESTINO DA ENTRADA</p>
          {catalogError && <div className="message-panel danger">{catalogError}</div>}
          {!catalog && !catalogError && <span>Carregando materiais e localizações…</span>}
          {catalog && (
            <div className="field-grid">
              <label className="review-field">
                <span className="field-label">Material interno *</span>
                <select value={selectedMaterialId} onChange={(event) => onMaterialChange(event.target.value)}>
                  <option value="">Selecione</option>
                  {materialOptions.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.internal_code} · {material.name} · {material.width_mm}×{material.length_mm}
                    </option>
                  ))}
                </select>
              </label>
              <label className="review-field">
                <span className="field-label">Localização *</span>
                <select value={selectedLocationId} onChange={(event) => onLocationChange(event.target.value)}>
                  <option value="">Selecione</option>
                  {catalog.locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.code} · {location.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

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
          <strong>{receipt ? `Pallet ${receipt.internal_code} recebido.` : 'Leitura aprovada para o teste.'}</strong>
          <span>{receipt ? `QR interno: ${receipt.internal_qr}` : 'Nenhum estoque foi criado. O rascunho ficou salvo somente neste aparelho.'}</span>
        </div>
      )}

      <div className="review-actions">
        <button className="secondary-button" type="button" onClick={onReset}>Nova leitura</button>
        <button
          className="primary-button"
          type="button"
          disabled={
            !criticalComplete ||
            isSaving ||
            (persistenceEnabled && (!catalog || !selectedMaterialId || !selectedLocationId))
          }
          onClick={onApprove}
        >
          {isSaving ? 'Confirmando…' : persistenceEnabled ? 'Confirmar entrada' : 'Aprovar leitura'}
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
        <small>{field.sources.includes('MANUAL') ? 'Conferido manualmente' : confidenceLabel(field.confidence)}</small>
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
