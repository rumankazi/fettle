import type { Probe, ProbeUnavailable } from './types.js';

/** Constructors for {@link Probe}; see `types.ts` for why the shape exists. */

export function available<T>(value: T): Probe<T> {
  return { available: true, value };
}

export function unavailable(reason: string): ProbeUnavailable {
  return { available: false, reason };
}
