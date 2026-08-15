import { fail, notApplicable, pass } from './result.js';
import type { BooleanRuleSettings, RepoContext, Rule, RuleResult } from '../types.js';

/** Locations GitHub honours, in the order it resolves them. */
export const CODEOWNERS_LOCATIONS = [
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
] as const;

/** Does a CODEOWNERS file exist in a standard location? */
export const codeownersRule: Rule<'codeowners'> = {
  id: 'codeowners',
  kind: 'boolean',

  evaluate(ctx: RepoContext, settings: BooleanRuleSettings): RuleResult {
    const probe = ctx.existingPaths;

    if (!probe.available) {
      return notApplicable('codeowners', settings, probe);
    }

    const found = CODEOWNERS_LOCATIONS.find((location) => probe.value.includes(location));

    if (found !== undefined) {
      return pass('codeowners', settings, `CODEOWNERS found at ${found}.`, { path: found });
    }

    return fail(
      'codeowners',
      settings,
      `No CODEOWNERS file at any of ${CODEOWNERS_LOCATIONS.join(', ')}. ` +
        `Adding one routes reviews to the people who own each path.`,
      { checkedPaths: [...CODEOWNERS_LOCATIONS] },
    );
  },
};
