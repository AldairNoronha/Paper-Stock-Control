export interface OcrResult {
  text: string;
  confidence: number;
}

export async function extractText(
  canvas: HTMLCanvasElement,
  onProgress: (progress: number, message: string) => void
): Promise<OcrResult> {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const worker = await createWorker('por', OEM.LSTM_ONLY, {
    logger(message) {
      if (message.status === 'recognizing text') {
        onProgress(message.progress, 'Lendo textos e números da etiqueta…');
      } else if (message.status.includes('loading')) {
        onProgress(Math.min(message.progress * 0.25, 0.2), 'Preparando o leitor OCR no celular…');
      }
    }
  });
  try {
    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: PSM.SPARSE_TEXT
    });
    const result = await worker.recognize(canvas);
    return {
      text: result.data.text.trim(),
      confidence: Math.max(0, Math.min(1, result.data.confidence / 100))
    };
  } finally {
    await worker.terminate();
  }
}
