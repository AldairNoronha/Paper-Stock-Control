import type { DetectedCode } from './types';

// GS1 AI (00) identifies an SSCC; it is not part of its 18 digits.
export function isValidSscc(value: string | null): boolean {
  if (!value || !/^\d{18}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 17; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 3 : 1);
  }
  return (10 - sum % 10) % 10 === Number(value[17]);
}

export function parseSscc(value: string): string | null {
  const normalized = value.trim().replace(/^\]C1/, '').replace(/\s/g, '');
  const match = /^(?:(?:\(00\)|00))?(\d{18})$/.exec(normalized);
  return match && isValidSscc(match[1]) ? match[1] : null;
}

export function ssccFromCodes(codes: DetectedCode[]): string | null {
  const values = new Set(codes.map((code) => parseSscc(code.value)).filter((value) => value !== null));
  return values.size === 1 ? [...values][0] : null;
}

export function ssccFromText(text: string): string | null {
  const values = new Set<string>();
  for (const match of text.matchAll(/(?:\(00\)|\bSSCC\s*[:#-]?)\s*((?:\d[ \t]*){18})(?!\d)/gi)) {
    const value = parseSscc(match[1]);
    if (value) values.add(value);
  }
  return values.size === 1 ? [...values][0] : null;
}
