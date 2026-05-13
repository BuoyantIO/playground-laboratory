import type { Sample } from './types';

export function niceCeil(n: number): number {
  if (n <= 50) return 50;
  if (n <= 100) return 100;
  if (n <= 250) return 250;
  if (n <= 500) return 500;
  if (n <= 1000) return 1000;
  if (n <= 2500) return 2500;
  if (n <= 5000) return 5000;
  return Math.ceil(n / 1000) * 1000;
}

export function statusLabel(s: Sample): string {
  if (s.status === 0) return 'ERR';
  return String(s.status);
}

export function latencyTone(ms?: number): 'ok' | 'warn' | 'err' | undefined {
  if (ms === undefined) return undefined;
  if (ms < 200) return 'ok';
  if (ms < 1000) return 'warn';
  return 'err';
}
