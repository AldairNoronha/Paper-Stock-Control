import type { GuidedCaptureTarget } from './types';

export interface OcrResult {
  text: string;
  confidence: number;
}

type TesseractModule = typeof import('tesseract.js');
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>;

export class OcrSession {
  private workerPromise: Promise<TesseractWorker> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private progressListener: ((progress: number, message: string) => void) | null = null;

  initialize(onProgress?: (progress: number, message: string) => void): Promise<TesseractWorker> {
    if (onProgress) this.progressListener = onProgress;
    if (!this.workerPromise) {
      this.workerPromise = this.createWorker();
    }
    return this.workerPromise;
  }

  recognize(
    canvas: HTMLCanvasElement,
    target: GuidedCaptureTarget,
    onProgress?: (progress: number, message: string) => void
  ): Promise<OcrResult> {
    if (onProgress) this.progressListener = onProgress;
    const task = this.queue.then(() => this.runRecognition(canvas, target));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  async terminate(): Promise<void> {
    await this.queue;
    const worker = await this.workerPromise?.catch(() => null);
    this.workerPromise = null;
    if (worker) await worker.terminate();
  }

  private async createWorker(): Promise<TesseractWorker> {
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker('por', OEM.LSTM_ONLY, {
      logger: (message) => {
        if (message.status === 'recognizing text') {
          this.progressListener?.(message.progress, 'Lendo a área destacada…');
        } else if (message.status.includes('loading')) {
          this.progressListener?.(
            Math.min(message.progress * 0.25, 0.2),
            'Preparando o leitor OCR no aparelho…'
          );
        }
      }
    });
  }

  private async runRecognition(
    canvas: HTMLCanvasElement,
    target: GuidedCaptureTarget
  ): Promise<OcrResult> {
    const [{ PSM }, worker] = await Promise.all([import('tesseract.js'), this.initialize()]);
    const numericTarget = target === 'quantity' || target === 'dimensions';
    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: numericTarget ? PSM.SINGLE_BLOCK : PSM.SPARSE_TEXT,
      tessedit_char_whitelist: numericTarget
        ? '0123456789xX×/.,:()- QUANTITYquantiyFOLHASfolhasPCpcDIMENSOESdimensoesMMmmLARGURAlarguraCOMPRIMENTOcomprimento'
        : ''
    });
    const result = await worker.recognize(canvas);
    return {
      text: result.data.text.trim(),
      confidence: Math.max(0, Math.min(1, result.data.confidence / 100))
    };
  }
}

export async function extractText(
  canvas: HTMLCanvasElement,
  onProgress: (progress: number, message: string) => void
): Promise<OcrResult> {
  const session = new OcrSession();
  try {
    await session.initialize(onProgress);
    return await session.recognize(canvas, 'overview', onProgress);
  } finally {
    await session.terminate();
  }
}
