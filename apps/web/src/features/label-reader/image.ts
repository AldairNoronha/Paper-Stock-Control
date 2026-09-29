export async function loadImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function createOcrCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const minimumWidth = 1800;
  const maximumWidth = 2600;
  const scale = Math.min(maximumWidth / image.naturalWidth, Math.max(1, minimumWidth / image.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('O navegador não disponibilizou processamento de imagem.');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray =
      pixels.data[index] * 0.299 +
      pixels.data[index + 1] * 0.587 +
      pixels.data[index + 2] * 0.114;
    const enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.25 + 128));
    pixels.data[index] = enhanced;
    pixels.data[index + 1] = enhanced;
    pixels.data[index + 2] = enhanced;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}
