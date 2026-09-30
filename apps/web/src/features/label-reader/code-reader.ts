import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

import type { DetectedCode } from './types';

export async function readCodes(
  image: HTMLImageElement,
  processedCanvas: HTMLCanvasElement
): Promise<DetectedCode[]> {
  const formatGroups = [
    [BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX],
    [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E
    ]
  ];
  const detected = new Map<string, DetectedCode>();

  for (const formats of formatGroups) {
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, formats]]);
    const reader = new BrowserMultiFormatReader(hints);
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
  return [...detected.values()];
}
