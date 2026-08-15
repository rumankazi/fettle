import { fail, notApplicable, pass } from './result.js';
import type { BooleanRuleSettings, RepoContext, Rule, RuleResult } from '../types.js';

/** Does the default branch have a protection rule or ruleset? */
export const branchProtectionRule: Rule<'branch_protection'> = {
  id: 'branch_protection',
  kind: 'boolean',

  evaluate(ctx: RepoContext, settings: BooleanRuleSettings): RuleResult {
    const probe = ctx.branchProtection;

    // Reading protection requires administration:read, which the default
    // GITHUB_TOKEN lacks. The fetcher phrases the unlock instructions.
    if (!probe.available) {
      return notApplicable('branch_protection', settings, probe);
    }

    const { protected: isProtected, source, description } = probe.value;

    if (isProtected) {
      return pass(
        'branch_protection',
        settings,
        `Default branch '${ctx.defaultBranch}' is protected: ${description}.`,
        { source },
      );
    }

    return fail(
      'branch_protection',
      settings,
      `Default branch '${ctx.defaultBranch}' has no ruleset or branch protection rule. ` +
        `Add one in Settings → Rules so changes cannot bypass review.`,
      { source },
    );
  },
};
