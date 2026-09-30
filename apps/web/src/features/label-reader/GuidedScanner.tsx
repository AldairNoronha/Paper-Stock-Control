import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { canvasToFile, captureVideoFrame, prepareOcrFrame } from './camera-frame';
import { readLinearCode } from './code-reader';
import {
  GUIDED_TARGETS,
  GuidedScanAccumulator,
  guidedChecklist,
  guidedCriticalComplete,
  nextGuidedTarget
} from './guided-session';
import { OcrSession } from './ocr';
import { checkCanvasQuality } from './quality';
import type {
  CaptureEvidence,
  DetectedCode,
  GuidedCaptureTarget,
  ImageQualityResult,
  LabelAnalysisResult,
  LabelFields
} from './types';

interface GuidedScannerProps {
  onReview: (file: File, result: LabelAnalysisResult, evidence: CaptureEvidence[]) => void;
  onPhotoSelected: (file: File) => void;
}

type ScannerStatus = 'idle' | 'requesting' | 'scanning' | 'ready' | 'error';

interface ZoomCapability {
  min: number;
  max: number;
  step?: number;
}

interface ExtendedCapabilities extends MediaTrackCapabilities {
  zoom?: ZoomCapability;
  torch?: boolean;
}

export function GuidedScanner({ onReview, onPhotoSelected }: GuidedScannerProps) {
  const inputId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const ocrRef = useRef<OcrSession | null>(null);
  const intervalRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const accumulatorRef = useRef(new GuidedScanAccumulator());
  const resultRef = useRef<LabelAnalysisResult | null>(null);
  const evidenceRef = useRef<CaptureEvidence[]>([]);
  const hasCodeRef = useRef(false);
  const initialCodePassRef = useRef(false);
  const attemptsRef = useRef(0);
  const targetRef = useRef<GuidedCaptureTarget>('code');

  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [result, setResult] = useState<LabelAnalysisResult | null>(null);
  const [target, setTarget] = useState<GuidedCaptureTarget>('code');
  const [hasCode, setHasCode] = useState(false);
  const [message, setMessage] = useState(GUIDED_TARGETS.code.instruction);
  const [qualityMessage, setQualityMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomCapability, setZoomCapability] = useState<ZoomCapability | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => () => {
    stopResources();
  }, []);

  async function startCamera() {
    if (status === 'requesting' || status === 'scanning') return;
    accumulatorRef.current = new GuidedScanAccumulator();
    resultRef.current = null;
    evidenceRef.current = [];
    hasCodeRef.current = false;
    initialCodePassRef.current = false;
    attemptsRef.current = 0;
    targetRef.current = 'code';
    setResult(null);
    setHasCode(false);
    setTarget('code');
    setTorchOn(false);
    setStatus('requesting');
    setError(null);
    setQualityMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError('Este navegador não oferece câmera contínua. Use uma foto ou abra o endereço em HTTPS.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 24, max: 30 }
        }
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('A visualização da câmera não foi encontrada.');
      video.srcObject = stream;
      await video.play();
      configureCameraCapabilities(stream);
      startCodeReader(stream, video);
      const ocr = new OcrSession();
      ocrRef.current = ocr;
      void ocr.initialize((progress) => setOcrProgress(progress)).catch(() => {
        setQualityMessage('O OCR não iniciou. QR e códigos continuam ativos; também é possível revisar manualmente.');
      });
      intervalRef.current = window.setInterval(() => void sampleFrame(), 1400);
      setStatus('scanning');
      setMessage(GUIDED_TARGETS.code.instruction);
    } catch (caught) {
      stopResources();
      setStatus('error');
      const name = caught instanceof DOMException ? caught.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'A câmera foi bloqueada. Libere a permissão do site ou use uma foto existente.'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'Nenhuma câmera foi encontrada neste aparelho. Use uma foto existente.'
            : name === 'OverconstrainedError'
              ? 'A câmera não aceitou a resolução solicitada. Tente novamente ou use uma foto.'
          : caught instanceof Error
            ? caught.message
            : 'Não foi possível abrir a câmera traseira.'
      );
    }
  }

  function startCodeReader(stream: MediaStream, video: HTMLVideoElement) {
    const formats = [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E
    ];
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, formats],
      [DecodeHintType.TRY_HARDER, true]
    ]);
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 650
    });
    readerRef.current = reader;
    void reader.decodeFromStream(stream, video, (decoded, _error, controls) => {
      controlsRef.current = controls;
      setTorchSupported(Boolean(controls.switchTorch));
      if (!decoded) return;
      const barcodeFormat = decoded.getBarcodeFormat();
      const code: DetectedCode = {
        value: decoded.getText().trim(),
        format: BarcodeFormat[barcodeFormat] ?? String(barcodeFormat)
      };
      void acceptCode(code);
    }).then((controls) => {
      controlsRef.current = controls;
      setTorchSupported(Boolean(controls.switchTorch));
    }).catch((caught: unknown) => {
      setQualityMessage(caught instanceof Error ? caught.message : 'O leitor de códigos foi interrompido.');
    });
  }

  async function acceptCode(code: DetectedCode) {
    const video = videoRef.current;
    if (!video) return;
    try {
      const frame = captureVideoFrame(video, { region: 'focus' });
      const quality = checkCanvasQuality(frame);
      const observed = accumulatorRef.current.observe({
        text: '',
        ocrConfidence: 0,
        codes: [code],
        quality,
        target: 'code',
        capturedAt: new Date().toISOString()
      });
      if (observed.newCode) {
        hasCodeRef.current = true;
        setHasCode(true);
        updateFromObservation(observed.result);
        await saveEvidence(frame, quality, 'code', observed.acceptedFields);
        notifyAccepted();
        setMessage('Código encontrado. Continue passando a câmera pelas áreas solicitadas.');
      }
    } catch {
      // A próxima leitura contínua tenta novamente sem encerrar a sessão.
    }
  }

  async function sampleFrame() {
    const video = videoRef.current;
    const ocr = ocrRef.current;
    if (!video || !ocr || busyRef.current || status === 'ready') return;
    busyRef.current = true;
    try {
      const frame = captureVideoFrame(video, { region: 'focus' });
      const quality = checkCanvasQuality(frame);
      const blockingIssue = quality.issues.find((issue) => issue.severity === 'error');
      if (blockingIssue) {
        setQualityMessage(blockingIssue.message);
        return;
      }
      setQualityMessage(null);
      attemptsRef.current += 1;
      if (attemptsRef.current >= 3) initialCodePassRef.current = true;
      const currentTarget = targetRef.current;
      if (currentTarget === 'code') {
        // A multi-format video reader may keep returning the QR. Search bars independently.
        const barcode = await readLinearCode(frame);
        if (barcode) {
          const observed = accumulatorRef.current.observe({
            text: '', ocrConfidence: 0, codes: [barcode], quality,
            target: 'code', capturedAt: new Date().toISOString()
          });
          hasCodeRef.current = true;
          setHasCode(true);
          updateFromObservation(observed.result);
          if (observed.newCode) {
            await saveEvidence(frame, quality, 'code', observed.acceptedFields);
            notifyAccepted();
          }
          if (guidedCriticalComplete(observed.result)) return;
        }
      }
      setOcrProgress(0);
      const recognized = await ocr.recognize(
        prepareOcrFrame(frame),
        currentTarget,
        (progress) => setOcrProgress(progress)
      );
      const observed = accumulatorRef.current.observe({
        text: recognized.text,
        ocrConfidence: recognized.confidence,
        codes: [],
        quality,
        target: currentTarget,
        capturedAt: new Date().toISOString()
      });
      updateFromObservation(observed.result);
      if (observed.acceptedFields.length > 0) {
        await saveEvidence(frame, quality, currentTarget, observed.acceptedFields);
        notifyAccepted();
      }
    } catch (caught) {
      setQualityMessage(caught instanceof Error ? caught.message : 'Não foi possível analisar este quadro.');
    } finally {
      setOcrProgress(null);
      busyRef.current = false;
    }
  }

  function updateFromObservation(nextResult: LabelAnalysisResult) {
    resultRef.current = nextResult;
    setResult(nextResult);
    const nextTarget = nextGuidedTarget(
      nextResult,
      hasCodeRef.current,
      initialCodePassRef.current
    );
    targetRef.current = nextTarget;
    setTarget(nextTarget);
    if (guidedCriticalComplete(nextResult)) {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
      setStatus('ready');
      setMessage('Campos obrigatórios encontrados. Revise os valores antes de confirmar.');
    } else {
      setMessage(nextTarget === 'code' && nextResult.fields.supplier.value === 'IMPRESS'
        ? 'O QR já pode estar completo. Aproxime agora das barras e do número impresso após (00).'
        : GUIDED_TARGETS[nextTarget].instruction);
    }
  }

  async function saveEvidence(
    canvas: HTMLCanvasElement,
    quality: ImageQualityResult,
    evidenceTarget: GuidedCaptureTarget,
    fieldNames: (keyof LabelFields)[]
  ) {
    if (fieldNames.length === 0) return;
    const file = await canvasToFile(canvas, `${evidenceTarget}-${Date.now()}.jpg`, 0.88);
    const evidence: CaptureEvidence = {
      target: evidenceTarget,
      fieldNames,
      file,
      quality,
      capturedAt: new Date().toISOString()
    };
    const withoutSameTarget = evidenceRef.current.filter((item) => item.target !== evidenceTarget);
    evidenceRef.current = [...withoutSameTarget, evidence].slice(-10);
  }

  async function finishForReview() {
    const video = videoRef.current;
    const current = resultRef.current;
    if (!video || !current) {
      setError('Ainda não há dados para revisar. Passe a câmera por uma área da etiqueta.');
      return;
    }
    try {
      const overview = captureVideoFrame(video, { region: 'full' });
      const primaryFile = await canvasToFile(overview, `label-overview-${Date.now()}.jpg`, 0.9);
      await stopResources();
      onReview(primaryFile, current, evidenceRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível abrir a revisão.');
    }
  }

  async function toggleTorch() {
    const control = controlsRef.current;
    if (!control?.switchTorch) return;
    const next = !torchOn;
    try {
      await control.switchTorch(next);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
      setQualityMessage('A lanterna não está disponível nesta câmera.');
    }
  }

  async function changeZoom(value: number) {
    setZoom(value);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
    } catch {
      setZoomCapability(null);
    }
  }

  function configureCameraCapabilities(stream: MediaStream) {
    const track = stream.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() as ExtendedCapabilities | undefined;
    if (capabilities?.torch) setTorchSupported(true);
    if (capabilities?.zoom && capabilities.zoom.max > capabilities.zoom.min) {
      setZoomCapability(capabilities.zoom);
      const initialZoom = Math.max(capabilities.zoom.min, Math.min(capabilities.zoom.max, 1));
      setZoom(initialZoom);
    }
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Selecione uma imagem JPEG, PNG ou WebP.');
      return;
    }
    stopResources();
    onPhotoSelected(file);
  }

  function stopResources(): Promise<void> {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    const termination = ocrRef.current?.terminate() ?? Promise.resolve();
    ocrRef.current = null;
    return termination;
  }

  const checklist = guidedChecklist(result);
  const completeCount = checklist.filter((item) => item.complete).length;
  const scanning = status === 'scanning' || status === 'ready' || status === 'requesting';

  return (
    <div className="guided-scanner">
      {!scanning && (
        <div className="scanner-start">
          <button className="camera-button" type="button" onClick={() => void startCamera()}>
            <CameraIcon />
            <span>Iniciar leitura guiada</span>
            <small>A câmera fica aberta enquanto você percorre a etiqueta</small>
          </button>
          <label className="secondary-button photo-fallback" htmlFor={inputId}>
            Usar uma foto existente
          </label>
        </div>
      )}

      <div className={`live-camera ${scanning ? 'visible' : ''}`}>
        <div className="video-stage">
          <video ref={videoRef} autoPlay muted playsInline aria-label="Câmera traseira para leitura da etiqueta" />
          <div className="focus-guide" aria-hidden="true">
            <span />
          </div>
          {status === 'requesting' && <div className="camera-wait">Abrindo a câmera…</div>}
          <div className="camera-badge">{GUIDED_TARGETS[target].title}</div>
        </div>

        <div className="scanner-coach" aria-live="polite">
          <div>
            <p className="eyebrow">AGORA PROCURE</p>
            <strong>{message}</strong>
          </div>
          <span className="scanner-progress">{completeCount}/{checklist.length}</span>
        </div>

        {qualityMessage && <div className="frame-warning">{qualityMessage}</div>}
        {ocrProgress !== null && (
          <div className="live-progress" role="status">
            <span style={{ width: `${Math.max(8, ocrProgress * 100)}%` }} />
          </div>
        )}

        <div className="scanner-tools">
          {torchSupported && (
            <button className="secondary-button" type="button" onClick={() => void toggleTorch()}>
              {torchOn ? 'Apagar lanterna' : 'Ligar lanterna'}
            </button>
          )}
          {zoomCapability && zoom !== null && (
            <label className="zoom-control">
              Zoom
              <input
                type="range"
                min={zoomCapability.min}
                max={zoomCapability.max}
                step={zoomCapability.step ?? 0.1}
                value={zoom}
                onChange={(event) => void changeZoom(Number(event.target.value))}
              />
            </label>
          )}
        </div>

        <div className="capture-checklist">
          <div className={`checklist-item ${hasCode ? 'complete' : ''}`}>
            <span>{hasCode ? '✓' : '○'}</span>
            <div><strong>QR / código</strong><small>{hasCode ? 'Encontrado' : 'Leitura continua ativa'}</small></div>
          </div>
          {checklist.map((item) => (
            <div className={`checklist-item ${item.complete ? 'complete' : ''}`} key={item.key}>
              <span>{item.complete ? '✓' : '○'}</span>
              <div><strong>{item.label}</strong><small>{item.value ?? 'Ainda falta'}</small></div>
            </div>
          ))}
        </div>

        <div className="scanner-actions">
          <button className="secondary-button" type="button" onClick={() => {
            void stopResources();
            setStatus('idle');
          }}>
            Cancelar
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!result}
            onClick={() => void finishForReview()}
          >
            {guidedCriticalComplete(result) ? 'Revisar dados encontrados' : 'Revisar e completar manualmente'}
          </button>
        </div>
      </div>

      {error && <div className="message-panel danger" role="alert">{error}</div>}
      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={selectPhoto}
      />
    </div>
  );
}

function notifyAccepted() {
  navigator.vibrate?.(80);
  try {
    const AudioContextClass = window.AudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.05, context.currentTime);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.addEventListener('ended', () => void context.close());
  } catch {
    // Vibração e som são melhorias; a confirmação visual permanece suficiente.
  }
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3 7.5 5H5a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3h-2.5L15 3H9Zm3 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
    </svg>
  );
}
