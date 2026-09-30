export interface FrameCaptureOptions {
  region?: 'focus' | 'full';
  maxWidth?: number;
}

export function captureVideoFrame(
  video: HTMLVideoElement,
  options: FrameCaptureOptions = {}
): HTMLCanvasElement {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('A câmera ainda está ajustando a imagem. Aguarde um instante.');
  }
  const region = options.region ?? 'focus';
  const source = region === 'focus' ? focusRegion(video.videoWidth, video.videoHeight) : {
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

function focusRegion(width: number, height: number) {
  const regionWidth = Math.round(width * 0.9);
  const regionHeight = Math.round(height * 0.42);
  return {
    x: Math.round((width - regionWidth) / 2),
    y: Math.round((height - regionHeight) / 2),
    width: regionWidth,
    height: regionHeight
  };
}
