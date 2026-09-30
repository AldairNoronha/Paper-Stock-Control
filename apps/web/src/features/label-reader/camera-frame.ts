import type { GuidedCaptureTarget } from './types';

export interface FrameCaptureOptions {
  region?: 'focus' | 'full';
  maxWidth?: number;
  focusHeight?: number;
}

export function cameraFocusHeight(target: GuidedCaptureTarget): number {
  if (target === 'area' || target === 'expiry') return 0.26;
  if (target === 'quantity' || target === 'dimensions' || target === 'reference' || target === 'production') return 0.32;
  if (target === 'lot') return 0.3;
  if (target === 'identity') return 0.36;
  return 0.42;
}

export function captureVideoFrame(
  video: HTMLVideoElement,
  options: FrameCaptureOptions = {}
): HTMLCanvasElement {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('A câmera ainda está ajustando a imagem. Aguarde um instante.');
  }
  const region = options.region ?? 'focus';
  const viewport = video.getBoundingClientRect();
  const source = region === 'focus' ? focusRegion(video.videoWidth, video.videoHeight, viewport.width, viewport.height, options.focusHeight) : {
    x: 0,
    y: 0,
    width: video.videoWidth,
    height: video.videoHeight
  };
  const maximumWidth = options.maxWidth ?? (region === 'focus' ? 2200 : 1920);
  const scale = Math.min(1, maximumWidth / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('O navegador não conseguiu capturar o quadro da câmera.');
  context.drawImage(
    video,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}

export function prepareOcrFrame(source: HTMLCanvasElement): HTMLCanvasElement {
  const minimumWidth = 1500;
  const maximumWidth = 2200;
  const scale = Math.min(maximumWidth / source.width, Math.max(1, minimumWidth / source.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('O navegador não disponibilizou processamento de imagem.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray =
      pixels.data[index] * 0.299 +
      pixels.data[index + 1] * 0.587 +
      pixels.data[index + 2] * 0.114;
    const enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.38 + 128));
    pixels.data[index] = enhanced;
    pixels.data[index + 1] = enhanced;
    pixels.data[index + 2] = enhanced;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

export async function canvasToFile(
  canvas: HTMLCanvasElement,
  name: string,
  quality = 0.88
): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Não foi possível guardar a evidência.')),
      'image/jpeg',
      quality
    );
  });
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

export function focusRegion(width: number, height: number, displayWidth = width, displayHeight = height, focusHeight = 0.42) {
  // Match the centered object-fit: cover preview on portrait and landscape screens.
  const scale = displayWidth > 0 && displayHeight > 0
    ? Math.max(displayWidth / width, displayHeight / height)
    : 1;
  const visibleWidth = displayWidth > 0 ? Math.min(width, displayWidth / scale) : width;
  const visibleHeight = displayHeight > 0 ? Math.min(height, displayHeight / scale) : height;
  const regionWidth = Math.round(visibleWidth * 0.9);
  const regionHeight = Math.round(visibleHeight * focusHeight);
  return {
    x: Math.round((width - regionWidth) / 2),
    y: Math.round((height - regionHeight) / 2),
    width: regionWidth,
    height: regionHeight
  };
}
