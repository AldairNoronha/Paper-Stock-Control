import { describe, expect, it } from 'vitest';

import { focusRegion } from './camera-frame';
import { assessQualityIssues } from './quality';

describe('live camera quality', () => {
  it.each([[1280, 720], [720, 1280], [640, 480]])(
    'does not block OCR for a sharp %ix%i camera crop', (width, height) => {
      const crop = focusRegion(width, height);
      const live = assessQualityIssues(crop.width, crop.height, 180, 50, 100, 'live');
      const photo = assessQualityIssues(crop.width, crop.height, 180, 50, 100);
      expect(live.some((issue) => issue.severity === 'error')).toBe(false);
      expect(photo.some((issue) => issue.code === 'LOW_RESOLUTION')).toBe(true);
    }
  );

  it('still blocks unusably small, dark, low contrast or blurred frames', () => {
    expect(assessQualityIssues(200, 100, 180, 50, 100, 'live')[0].code).toBe('LOW_RESOLUTION');
    expect(assessQualityIssues(648, 538, 20, 50, 100, 'live').some((i) => i.code === 'TOO_DARK')).toBe(true);
    expect(assessQualityIssues(648, 538, 180, 5, 100, 'live').some((i) => i.code === 'LOW_CONTRAST')).toBe(true);
    expect(assessQualityIssues(648, 538, 180, 50, 5, 'live').some((i) => i.code === 'BLURRED')).toBe(true);
  });

  it('allows a mostly white live label with distinct dark text, but not blown-out blank frames', () => {
    expect(assessQualityIssues(576, 202, 249, 35, 100, 'live').some((i) => i.code === 'TOO_BRIGHT')).toBe(false);
    expect(assessQualityIssues(576, 202, 249, 5, 10, 'live').some((i) => i.code === 'TOO_BRIGHT')).toBe(true);
    expect(assessQualityIssues(1200, 800, 249, 35, 100).some((i) => i.code === 'TOO_BRIGHT')).toBe(true);
  });

  it('matches the displayed focus guide when cover crops a landscape video on mobile', () => {
    const crop = focusRegion(1280, 720, 360, 400);
    expect(crop).toEqual({ x: 349, y: 209, width: 583, height: 302 });
    expect(assessQualityIssues(crop.width, crop.height, 180, 50, 100, 'live').some((i) => i.severity === 'error')).toBe(false);
  });
});
