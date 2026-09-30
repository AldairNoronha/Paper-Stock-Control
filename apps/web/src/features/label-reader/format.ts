import type { FieldReading } from './types';

export function confidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.95) return 'high';
  if (confidence >= 0.8) return 'medium';
  return 'low';
}

export function confidenceLabel(confidence: number): string {
  if (confidence === 0) return 'Não identificado';
  return `${Math.min(99, Math.round(confidence * 100))}%`;
}

export function fieldValue<T>(field: FieldReading<T>): string {
  return field.value === null ? '' : String(field.value);
}

export function formatArea(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  }).format(value);
}

export function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1).replace('.', ',')} s`;
}
