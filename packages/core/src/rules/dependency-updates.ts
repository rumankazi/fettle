import { fail, notApplicable, pass } from './result.js';
import type { BooleanRuleSettings, RepoContext, Rule, RuleResult } from '../types.js';

/** Dependabot's only supported location, plus Renovate's documented config paths. */
export const DEPENDENCY_UPDATE_LOCATIONS = [
  '.github/dependabot.yml',
  '.github/dependabot.yaml',
  'renovate.json',
  'renovate.json5',
  '.renovaterc',
  '.renovaterc.json',
  '.github/renovate.json',
  '.github/renovate.json5',
] as const;

/**
 * Is Dependabot or Renovate configured?
 *
 * File presence is the only signal available without extra permissions, so a
 * Renovate app driving this repo from a central config reads as a `fail`. The
 * evidence says so rather than leaving the user to guess.
 */
export const dependencyUpdatesRule: Rule<'dependency_updates'> = {
  id: 'dependency_updates',
  kind: 'boolean',

  evaluate(ctx: RepoContext, settings: BooleanRuleSettings): RuleResult {
    const probe = ctx.existingPaths;

    if (!probe.available) {
      return notApplicable('dependency_updates', settings, probe);
    }

    const found = DEPENDENCY_UPDATE_LOCATIONS.find((location) => probe.value.includes(location));

    if (found !== undefined) {
      return pass('dependency_updates', settings, `Dependency update config found at ${found}.`, {
        path: found,
      });
    }

    return fail(
      'dependency_updates',
      settings,
      `No Dependabot or Renovate config found at any of ${DEPENDENCY_UPDATE_LOCATIONS.join(', ')}. ` +
        `Note that a Renovate app configured centrally, outside this repository, cannot be detected from here.`,
      { checkedPaths: [...DEPENDENCY_UPDATE_LOCATIONS] },
    );
  },
};
