import type { ImageQualityResult, QualityIssue } from './types';

const SAMPLE_MAX_SIZE = 720;
type QualityMode = 'photo' | 'live';

export function checkImageQuality(image: HTMLImageElement): ImageQualityResult {
  return checkVisualSource(image, image.naturalWidth, image.naturalHeight);
}

export function checkCanvasQuality(canvas: HTMLCanvasElement, mode: QualityMode = 'photo'): ImageQualityResult {
  return checkVisualSource(canvas, canvas.width, canvas.height, mode);
}

function checkVisualSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  mode: QualityMode = 'photo'
): ImageQualityResult {
  const scale = Math.min(1, SAMPLE_MAX_SIZE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Não foi possível avaliar a fotografia neste navegador.');
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const grayscale = new Float32Array(canvas.width * canvas.height);
  let sum = 0;
  for (let pixel = 0, channel = 0; channel < data.length; pixel += 1, channel += 4) {
    const value = data[channel] * 0.299 + data[channel + 1] * 0.587 + data[channel + 2] * 0.114;
    grayscale[pixel] = value;
    sum += value;
  }
  const brightness = sum / grayscale.length;
  let squaredDifference = 0;
  for (const value of grayscale) {
    squaredDifference += (value - brightness) ** 2;
  }
  const contrast = Math.sqrt(squaredDifference / grayscale.length);
  const sharpness = laplacianVariance(grayscale, canvas.width, canvas.height);
  const megapixels = (sourceWidth * sourceHeight) / 1_000_000;
  const issues = assessQualityIssues(sourceWidth, sourceHeight, brightness, contrast, sharpness, mode);

  return {
    width: sourceWidth,
    height: sourceHeight,
    megapixels,
    brightness,
    contrast,
    sharpness,
    canAnalyze: !issues.some((issue) => issue.severity === 'error'),
    issues
  };
}

function laplacianVariance(pixels: Float32Array, width: number, height: number): number {
  let sum = 0;
  let squaredSum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value =
        pixels[index - width] +
        pixels[index - 1] -
        4 * pixels[index] +
        pixels[index + 1] +
        pixels[index + width];
      sum += value;
      squaredSum += value * value;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return squaredSum / count - mean * mean;
}

export function assessQualityIssues(
  width: number,
  height: number,
  brightness: number,
  contrast: number,
  sharpness: number,
  mode: QualityMode = 'photo'
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const pixels = width * height;
  // Assess native pixels before OCR enlargement. Live crops are not whole photos.
  const tooSmall = mode === 'live'
    ? pixels < 40_000 || width < 240 || height < 100
    : pixels < 350_000 || width < 850;
  if (tooSmall) {
    issues.push({
      severity: 'error',
      code: 'LOW_RESOLUTION',
      message: mode === 'live'
        ? 'A área da câmera é pequena demais. Tente outra câmera ou use uma foto.'
        : 'Aproxime o celular: a etiqueta ficou pequena na fotografia.'
    });
  }
  if (brightness < 35) {
    issues.push({ severity: 'error', code: 'TOO_DARK', message: 'A foto está muito escura. Use mais luz.' });
  } else if (brightness > 245 && (mode === 'photo' || contrast < 20)) {
    issues.push({ severity: 'error', code: 'TOO_BRIGHT', message: 'A foto está estourada. Evite reflexos na etiqueta.' });
  }
  if (contrast < 12) {
    issues.push({ severity: 'error', code: 'LOW_CONTRAST', message: 'O texto não se destaca do fundo. Refaça a foto.' });
  }
  if (sharpness < 18) {
    issues.push({ severity: 'error', code: 'BLURRED', message: 'A imagem parece desfocada. Firme o celular e tente novamente.' });
  } else if (sharpness < 45) {
    issues.push({ severity: 'warning', code: 'SOFT_FOCUS', message: 'O foco pode reduzir a precisão de alguns campos.' });
  }
  if (pixels < 700_000 && !issues.some((issue) => issue.code === 'LOW_RESOLUTION')) {
    issues.push({ severity: 'warning', code: 'LIMITED_RESOLUTION', message: 'Uma foto mais próxima pode melhorar a leitura.' });
  }
  return issues;
}
