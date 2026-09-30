import { afterEach, describe, expect, it, vi } from 'vitest';

import { OcrSession } from './ocr';

afterEach(() => vi.restoreAllMocks());

function fakeWorker(secondText: string) {
  return {
    setParameters: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn()
      .mockResolvedValueOnce({ data: { text: 'D009260228g', confidence: 50, blocks: null } })
      .mockResolvedValueOnce({ data: { text: secondText, confidence: 99, blocks: null } })
  };
}

describe('constrained lot rereading', () => {
  it('accepts only a matching independent numeric reading and caps its confidence', async () => {
    const worker = fakeWorker('D009260228');
    const session = new OcrSession();
    vi.spyOn(session as unknown as { createWorker: () => Promise<unknown> }, 'createWorker').mockResolvedValue(worker);
    const result = await session.recognize(document.createElement('canvas'), 'lot');
    expect(result.text).toBe('D009260228');
    expect(result.confidence).toBe(0.65);
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    await session.terminate();
  });

  it('does not accept a different digit from the second pass', async () => {
    const worker = fakeWorker('D009260229');
    const session = new OcrSession();
    vi.spyOn(session as unknown as { createWorker: () => Promise<unknown> }, 'createWorker').mockResolvedValue(worker);
    const result = await session.recognize(document.createElement('canvas'), 'lot');
    expect(result.text).toBe('D009260228g');
    expect(result.confidence).toBe(0.5);
    await session.terminate();
  });
});
