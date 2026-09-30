import type { GuidedCaptureTarget, OcrWord } from './types';

export interface OcrResult {
  text: string;
  confidence: number;
  words: OcrWord[];
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
    await worker.setParameters({
      preserve_interword_spaces: '1',
      // Supplier labels mix Portuguese/English headers and numbers in columns.
      // A numeric whitelist damages those headers, preventing field association.
      tessedit_pageseg_mode: target === 'code' ? PSM.SINGLE_LINE
        : target === 'identity' ? PSM.SINGLE_BLOCK : PSM.SPARSE_TEXT,
      tessedit_char_whitelist: ''
    });
    let result = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const damagedLot = target === 'lot' ? /\b(D\d{8,12})[A-Z]\b/i.exec(result.data.text) : null;
    if (damagedLot) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: 'D0123456789' });
      const numeric = await worker.recognize(canvas, {}, { text: true, blocks: true });
      // Independent constrained reading must agree with EVERY original digit.
      if (numeric.data.text.trim() === damagedLot[1]) {
        result = numeric;
        result.data.confidence = Math.min(result.data.confidence, 65);
      }
    }
    const words = (result.data.blocks ?? []).flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines).flatMap((line) => line.words)
      .map((word) => ({ text: word.text, confidence: Math.max(0, Math.min(1, word.confidence / 100)), bbox: word.bbox }));
    return {
      text: result.data.text.trim(),
      confidence: Math.max(0, Math.min(1, result.data.confidence / 100)),
      words
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
