import { createHash } from 'node:crypto';

export interface WilsonInterval {
  successes: number;
  trials: number;
  rate: number;
  lower: number;
  upper: number;
  z: number;
}

/**
 * Computes a Wilson score confidence interval for a binomial proportion.
 * Matches standard statistical reporting used in rigorous eval harnesses
 * (handles 0% and 100% proportions cleanly without collapsing to zero width).
 */
export function wilsonConfidenceInterval(
  successes: number,
  trials: number,
  z = 1.959963984540054,
): WilsonInterval {
  if (trials <= 0) {
    return { successes: 0, trials: 0, rate: 0, lower: 0, upper: 0, z };
  }
  const clampedSuccesses = Math.max(0, Math.min(trials, successes));
  const p = clampedSuccesses / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;

  return {
    successes: clampedSuccesses,
    trials,
    rate: Number(p.toFixed(4)),
    lower: Number(Math.max(0, center - margin).toFixed(4)),
    upper: Number(Math.min(1, center + margin).toFixed(4)),
    z,
  };
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(100, p));
  const index = Math.ceil((clamped / 100) * sorted.length) - 1;
  const safeIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[safeIndex] ?? 0;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Recursively sorts object keys for deterministic canonical JSON serialization.
 */
export function canonicalizeJson(value: unknown, excludeKeys: ReadonlySet<string> = new Set()): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => canonicalizeJson(item, excludeKeys));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (excludeKeys.has(key)) continue;
    const val = (value as Record<string, unknown>)[key];
    if (val !== undefined) {
      sorted[key] = canonicalizeJson(val, excludeKeys);
    }
  }
  return sorted;
}

export function canonicalSha256(value: unknown, excludeKeys: ReadonlySet<string> = new Set()): string {
  const canonical = canonicalizeJson(value, excludeKeys);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
