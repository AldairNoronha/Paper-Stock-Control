import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

import type { DetectedCode } from './types';

const LINEAR_FORMATS = [
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E
];

function createReader(formats: BarcodeFormat[]) {
  return new BrowserMultiFormatReader(new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, formats],
    [DecodeHintType.TRY_HARDER, true]
  ]));
}

function codeResult(result: Awaited<ReturnType<BrowserMultiFormatReader['decodeFromCanvas']>>): DetectedCode {
  const format = result.getBarcodeFormat();
  return { value: result.getText().trim(), format: BarcodeFormat[format] ?? String(format) };
}

// Narrow, overlapping bands let ZXing scan short bars in a panoramic pallet photo.
export async function readLinearCode(canvas: HTMLCanvasElement): Promise<DetectedCode | null> {
  const reader = createReader(LINEAR_FORMATS);
  try {
    return codeResult(await reader.decodeFromCanvas(canvas));
  } catch {
    // Continue with bounded regional attempts; a missing barcode is an explicit partial result.
  }
  for (const top of [0.1, 0.25, 0.4, 0.55, 0.7]) {
    const band = document.createElement('canvas');
    band.width = canvas.width;
    band.height = Math.max(1, Math.round(canvas.height * 0.25));
    const context = band.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(canvas, 0, Math.round(canvas.height * top), canvas.width, band.height,
      0, 0, band.width, band.height);
    try {
      return codeResult(await reader.decodeFromCanvas(band));
    } catch {
      // Try the next band without discarding an already-decoded QR.
    }
  }
  return null;
}

export async function readCodes(
  image: HTMLImageElement,
  processedCanvas: HTMLCanvasElement
): Promise<DetectedCode[]> {
  const formatGroups = [
    [BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX],
    LINEAR_FORMATS
  ];
  const detected = new Map<string, DetectedCode>();

  for (const formats of formatGroups) {
    const reader = createReader(formats);
    const attempts = [
      () => reader.decodeFromImageElement(image),
      () => reader.decodeFromCanvas(processedCanvas)
    ];
    for (const attempt of attempts) {
      try {
        const result = await attempt();
        const barcodeFormat = result.getBarcodeFormat();
        detected.set(result.getText().trim(), {
          value: result.getText().trim(),
          format: BarcodeFormat[barcodeFormat] ?? String(barcodeFormat)
        });
        break;
      } catch {
        // A label without this code family still continues to OCR.
      }
    }
  }
  if (![...detected.values()].some((code) => code.format !== 'QR_CODE' && code.format !== 'DATA_MATRIX')) {
    const barcode = await readLinearCode(processedCanvas);
    if (barcode) detected.set(barcode.value, barcode);
  }
  return [...detected.values()];
}
