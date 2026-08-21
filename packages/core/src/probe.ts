import type { Probe, ProbeUnavailable } from './types.js';

/** Constructors for {@link Probe}; see `types.ts` for why the shape exists. */

export function available<T>(value: T): Probe<T> {
  return { available: true, value };
}

/**
 * @param needs the permission that would unlock this, e.g. `issues:read`. Omit
 *   when no grant would help, such as an exhausted rate limit.
 */
export function unavailable(reason: string, needs?: string): ProbeUnavailable {
  return needs === undefined ? { available: false, reason } : { available: false, reason, needs };
}
