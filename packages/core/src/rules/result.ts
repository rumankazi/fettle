/**
 * Constructors for `RuleResult`.
 *
 * Centralising them keeps two invariants true by construction rather than by every
 * rule author remembering: `score` is `null` exactly when the rule was not scored,
 * and every result carries evidence.
 */

import { thresholdScore } from '../scoring.js';
import type {
  BooleanRuleSettings,
  ProbeUnavailable,
  RuleId,
  RuleResult,
  ThresholdRuleSettings,
} from '../types.js';

export function pass(
  id: RuleId,
  settings: BooleanRuleSettings,
  evidence: string,
  details?: Record<string, unknown>,
): RuleResult {
  return { id, status: 'pass', score: 100, weight: settings.weight, evidence, details };
}

export function fail(
  id: RuleId,
  settings: BooleanRuleSettings,
  evidence: string,
  details?: Record<string, unknown>,
): RuleResult {
  return { id, status: 'fail', score: 0, weight: settings.weight, evidence, details };
}

/**
 * A check we could not run. Excluded from scoring entirely (SCORING.md §3) — never
 * a `fail`, because a permission error is not evidence of poor health.
 */
export function notApplicable(
  id: RuleId,
  settings: BooleanRuleSettings,
  probe: ProbeUnavailable,
  details?: Record<string, unknown>,
): RuleResult {
  return {
    id,
    status: 'na',
    score: null,
    weight: settings.weight,
    evidence: probe.reason,
    details,
  };
}

/** Turned off by the user's config. Scored like `na`, reported distinctly. */
export function disabled(id: RuleId, settings: BooleanRuleSettings): RuleResult {
  return {
    id,
    status: 'disabled',
    score: null,
    weight: settings.weight,
    evidence: 'Disabled in configuration; excluded from the score.',
    details: { enabled: false },
  };
}

/**
 * Scores a measured count against the rule's thresholds.
 *
 * `pass` means full marks; any shortfall is `fail` with the partial score carrying
 * the nuance, because the report schema has no third state (see DECISIONS.md).
 */
export function threshold(
  id: RuleId,
  settings: ThresholdRuleSettings,
  value: number,
  evidence: (score: number) => string,
  details?: Record<string, unknown>,
): RuleResult {
  const score = thresholdScore(value, settings.good_at, settings.bad_at);

  return {
    id,
    status: score === 100 ? 'pass' : 'fail',
    score,
    weight: settings.weight,
    evidence: evidence(score),
    details: { value, good_at: settings.good_at, bad_at: settings.bad_at, ...details },
  };
}
