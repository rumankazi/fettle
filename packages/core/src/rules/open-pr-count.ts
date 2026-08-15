import { notApplicable, threshold } from './result.js';
import type { RepoContext, Rule, RuleResult, ThresholdRuleSettings } from '../types.js';

/**
 * Are open PRs piling up beyond a threshold?
 *
 * Drafts are excluded: a draft is declared work-in-progress, not neglect
 * (SCORING.md §2).
 */
export const openPrCountRule: Rule<'open_pr_count'> = {
  id: 'open_pr_count',
  kind: 'threshold',

  evaluate(ctx: RepoContext, settings: ThresholdRuleSettings): RuleResult {
    const probe = ctx.pullRequests;

    if (!probe.available) {
      return notApplicable('open_pr_count', settings, probe);
    }

    const openPrs = probe.value.filter((pr) => !pr.isDraft);

    return threshold(
      'open_pr_count',
      settings,
      openPrs.length,
      (score) =>
        `${openPrs.length} open non-draft pull request(s); ` +
        `${settings.good_at} or fewer scores 100, ${settings.bad_at} or more scores 0 (scored ${score}).`,
      { draftsExcluded: probe.value.length - openPrs.length },
    );
  },
};
