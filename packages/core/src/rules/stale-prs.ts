import { notApplicable, threshold } from './result.js';
import type {
  PullRequestSummary,
  RepoContext,
  Rule,
  RuleResult,
  StalePrsRuleSettings,
} from '../types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: Date): number {
  return (to.getTime() - Date.parse(from)) / MS_PER_DAY;
}

/**
 * A PR is stale when it has been open longer than `open_days` *and* its last commit
 * is older than `inactive_days` (SCORING.md §2). Both conditions matter: a
 * long-lived PR that is still being pushed to is alive, not rotting.
 *
 * A PR with no commits has never had commit activity, so its creation time stands in
 * as the last activity.
 */
export function isStale(
  pr: PullRequestSummary,
  now: Date,
  settings: StalePrsRuleSettings,
): boolean {
  if (pr.isDraft) return false;
  if (daysBetween(pr.createdAt, now) <= settings.open_days) return false;

  const lastActivity = pr.lastCommitAt ?? pr.createdAt;
  return daysBetween(lastActivity, now) > settings.inactive_days;
}

/** How many PRs are open past `open_days` with no commit inside `inactive_days`? */
export const stalePrsRule: Rule<'stale_prs'> = {
  id: 'stale_prs',
  kind: 'threshold',

  evaluate(ctx: RepoContext, settings: StalePrsRuleSettings): RuleResult {
    const probe = ctx.pullRequests;

    if (!probe.available) {
      return notApplicable('stale_prs', settings, probe);
    }

    const stale = probe.value.filter((pr) => isStale(pr, ctx.now, settings));

    return threshold(
      'stale_prs',
      settings,
      stale.length,
      (score) =>
        `${stale.length} pull request(s) open more than ${settings.open_days} day(s) with no commit ` +
        `in the last ${settings.inactive_days} day(s); ${settings.good_at} or fewer scores 100, ` +
        `${settings.bad_at} or more scores 0 (scored ${score}).`,
      { stalePrNumbers: stale.map((pr) => pr.number) },
    );
  },
};
