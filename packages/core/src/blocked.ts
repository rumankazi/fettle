/**
 * Turns the checks that could not run into an actionable list.
 *
 * Grouped by the grant that fixes them, not by the rule that failed: with a narrow
 * token `pull_requests:read` blocks two rules, and telling a user the same thing
 * twice is worse than telling them once with both names on it.
 */

import type { RepoReport, RuleResult } from './types.js';

export interface BlockedGroup {
  /** The permission to grant, or `null` when no grant would help. */
  needs: string | null;
  /** Rule ids this would unlock, in registry order. */
  rules: string[];
  /** Total weight currently unscoreable because of this. */
  weight: number;
  /**
   * One representative reason. Rules blocked by the same grant say the same thing,
   * so repeating it per rule adds length and no information.
   */
  reason: string;
}

function needsOf(rule: RuleResult): string | null {
  const needs = rule.details?.needs;
  return typeof needs === 'string' ? needs : null;
}

/**
 * Groups a repository's `na` rules by the permission that would unlock them,
 * heaviest first, which is the order in which they are worth fixing.
 *
 * Rules with no permission to grant (an exhausted rate limit, an endpoint a GHES
 * version lacks) each stay their own group, because their reasons differ and
 * merging them would produce a group whose single `reason` was wrong for the rest.
 */
export function blockedGroups(repo: RepoReport): BlockedGroup[] {
  const groups = new Map<string, BlockedGroup>();

  for (const rule of repo.rules) {
    if (rule.status !== 'na') continue;

    const needs = needsOf(rule);
    // Keyed by rule id when there is no grant, so those never merge together.
    const key = needs ?? ` ${rule.id}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, { needs, rules: [rule.id], weight: rule.weight, reason: rule.evidence });
    } else {
      existing.rules.push(rule.id);
      existing.weight += rule.weight;
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.weight - a.weight || a.rules[0].localeCompare(b.rules[0]),
  );
}

/**
 * One line explaining what the coverage was, or `undefined` when everything ran.
 *
 * Says whether a grade was withheld, because that is the part a reader needs in
 * order to interpret an `N/A` that would previously have been an `F`.
 */
export function coverageNote(repo: RepoReport): string | undefined {
  const { scoredWeight, totalWeight } = repo.coverage;
  if (totalWeight === 0) return 'No checks were applicable to this repository.';
  if (scoredWeight === totalWeight) return undefined;

  const scale = `${scoredWeight} of ${totalWeight} weight could be scored`;

  return repo.score === null
    ? `Only ${scale}, so no grade is reported: too little of this repository could be read to stand behind one.`
    : `${scale}; the grade reflects only those checks.`;
}
