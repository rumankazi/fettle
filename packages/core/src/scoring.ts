/**
 * The scoring math from SCORING.md, and the only place it is implemented.
 *
 * SCORING.md is normative: if this file and that document disagree, this file is
 * wrong. Rules must call into here rather than reimplementing a curve.
 */

import type { Grade, RuleResult } from './types.js';

/** Rule scores and aggregates are reported to 1 decimal (SCORING.md §1, §3). */
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Piecewise-linear clamp for threshold rules (SCORING.md §1).
 *
 * @param value  the raw measurement, e.g. a count of open PRs
 * @param goodAt at or below this, the rule scores 100
 * @param badAt   at or above this, the rule scores 0; must be greater than `goodAt`
 */
export function thresholdScore(value: number, goodAt: number, badAt: number): number {
  if (badAt <= goodAt) {
    // Config validation rejects this, so reaching it means a caller bypassed
    // `resolveConfig`. Fail loudly rather than dividing by zero.
    throw new RangeError(`threshold requires good_at < bad_at, received ${goodAt} and ${badAt}`);
  }

  if (value <= goodAt) return 100;
  if (value >= badAt) return 0;

  return roundToOneDecimal((100 * (badAt - value)) / (badAt - goodAt));
}

/** Whether a rule participates in the weighted aggregate (SCORING.md §3, §5). */
export function countsTowardScore(rule: RuleResult): boolean {
  return rule.status === 'pass' || rule.status === 'fail';
}

/**
 * Weighted aggregate over scored rules (SCORING.md §3).
 *
 * `na` and `disabled` rules leave both the numerator and the denominator, so a repo
 * is neither penalised nor rewarded for a check we could not run. Returns `null`
 * when nothing was scoreable.
 */
export function aggregateRepoScore(rules: readonly RuleResult[]): number | null {
  const scored = rules.filter(countsTowardScore);

  let numerator = 0;
  let denominator = 0;

  for (const rule of scored) {
    if (rule.score === null) {
      // `score === null` is defined to mean `na`/`disabled`; a scoreable rule
      // without a score is a bug in that rule, not a repo with a missing check.
      throw new TypeError(`rule '${rule.id}' has status '${rule.status}' but no score`);
    }
    numerator += rule.score * rule.weight;
    denominator += rule.weight;
  }

  if (denominator === 0) return null;

  return roundToOneDecimal(numerator / denominator);
}

/** Grade bands, boundaries taking the higher grade (SCORING.md §4). */
export function gradeFromScore(score: number | null): Grade {
  if (score === null) return 'N/A';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Ranking used by `--fail-below`; higher is better. `N/A` is unrankable. */
const GRADE_RANK: Record<Exclude<Grade, 'N/A'>, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

/**
 * Compares a graded repo against a floor.
 *
 * `N/A` means every check was inconclusive, which is not evidence of poor health,
 * so it never trips a floor.
 */
export function meetsGradeFloor(grade: Grade, floor: Exclude<Grade, 'N/A'>): boolean {
  if (grade === 'N/A') return true;
  return GRADE_RANK[grade] >= GRADE_RANK[floor];
}
