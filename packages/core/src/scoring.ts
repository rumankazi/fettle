/**
 * The scoring math from SCORING.md, and the only place it is implemented.
 *
 * SCORING.md is normative: if this file and that document disagree, this file is
 * wrong. Rules must call into here rather than reimplementing a curve.
 */

import type { Coverage, Grade, RuleResult } from './types.js';

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

/**
 * The share of applicable weight that must be scoreable for the aggregate to mean
 * anything (SCORING.md §3).
 *
 * A token with only `contents:read` leaves one rule of five scoreable, and the
 * average over that one rule is arithmetically correct and completely misleading:
 * it reports a confident `F` about a repository it could barely read. Half is the
 * line because it keeps the ordinary case working — `branch_protection` is weight
 * 3 of 9 and goes `na` on the default `GITHUB_TOKEN`, which still leaves two
 * thirds and a grade worth printing.
 */
export const MIN_COVERAGE = 0.5;

/**
 * How much of a repository could be graded.
 *
 * `disabled` rules leave the denominator as well as the numerator: a user who
 * turned a rule off has not lost coverage, they have changed what coverage means.
 */
export function coverageOf(rules: readonly RuleResult[]): Coverage {
  const applicable = rules.filter((rule) => rule.status !== 'disabled');
  const scored = applicable.filter(countsTowardScore);

  const totalWeight = applicable.reduce((sum, rule) => sum + rule.weight, 0);
  const scoredWeight = scored.reduce((sum, rule) => sum + rule.weight, 0);

  return {
    scoredRules: scored.length,
    totalRules: applicable.length,
    scoredWeight,
    totalWeight,
    ratio: totalWeight === 0 ? 0 : Math.round((scoredWeight / totalWeight) * 1000) / 1000,
  };
}

/** Whether enough of the repository was readable to stand behind an aggregate. */
export function isScoreRepresentative(coverage: Coverage): boolean {
  return coverage.totalWeight > 0 && coverage.ratio >= MIN_COVERAGE;
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

/**
 * Grades that can serve as a floor, best first.
 *
 * `N/A` is excluded: a floor of "no check succeeded" would gate on nothing.
 */
export const FLOOR_GRADES = ['A', 'B', 'C', 'D', 'F'] as const;

export type FloorGrade = (typeof FLOOR_GRADES)[number];

export function isFloorGrade(value: string): value is FloorGrade {
  return (FLOOR_GRADES as readonly string[]).includes(value);
}

/** Ranking used by a grade floor; higher is better. `N/A` is unrankable. */
const GRADE_RANK: Record<FloorGrade, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

/**
 * Compares a graded repo against a floor.
 *
 * `N/A` means every check was inconclusive, which is not evidence of poor health,
 * so it never trips a floor.
 */
export function meetsGradeFloor(grade: Grade, floor: FloorGrade): boolean {
  if (grade === 'N/A') return true;
  return GRADE_RANK[grade] >= GRADE_RANK[floor];
}
