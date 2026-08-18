import { fail, notApplicable, pass } from './result.js';
import type {
  BooleanRuleSettings,
  DependencyDashboard,
  DependencyDashboardSearch,
  RepoContext,
  Rule,
  RuleResult,
} from '../types.js';

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

function describeDashboard(dashboard: DependencyDashboard): string {
  const author =
    dashboard.author === null
      ? 'a since-deleted account'
      : `${dashboard.author}${dashboard.authorIsBot ? '' : ' (not an app account)'}`;

  return (
    `Renovate's dependency dashboard is open at issue #${dashboard.number} ` +
    `('${dashboard.title}', opened by ${author}). No config file is committed here, which ` +
    `is expected when a central Renovate operator runs this repository from a shared ` +
    `organisation-level config.`
  );
}

/**
 * Explains a missing dashboard without overstating it.
 *
 * The issue list is capped at one page, so on a repository with more open issues
 * than that, "not found" is really "not among the most recently updated issues we
 * looked at". Renovate rewrites the dashboard on every run, so on a working setup
 * it sits at the top — but the evidence should not claim more certainty than the
 * request actually bought.
 */
function describeNoDashboard(search: DependencyDashboardSearch): string {
  return search.truncated
    ? ` No Renovate dependency dashboard was found either, though only the most recently ` +
        `updated open issues were examined.`
    : ` No Renovate dependency dashboard is open either.`;
}

/**
 * Is Dependabot or Renovate configured?
 *
 * Two signals, because a repository can be covered without holding any config of
 * its own. A config file committed here is the direct evidence. Renovate's
 * dependency dashboard issue is the indirect evidence, and it is what a central
 * Renovate operator leaves behind when it onboards a repository from a shared
 * org-level config — the case that used to read as a `fail`.
 */
export const dependencyUpdatesRule: Rule<'dependency_updates'> = {
  id: 'dependency_updates',
  kind: 'boolean',

  evaluate(ctx: RepoContext, settings: BooleanRuleSettings): RuleResult {
    const paths = ctx.existingPaths;
    const search = ctx.dependencyDashboard;

    // The config file is the stronger signal and is already fetched, so it decides
    // the result on its own whenever it is there.
    if (paths.available) {
      const found = DEPENDENCY_UPDATE_LOCATIONS.find((location) => paths.value.includes(location));

      if (found !== undefined) {
        return pass('dependency_updates', settings, `Dependency update config found at ${found}.`, {
          path: found,
          source: 'config',
        });
      }
    }

    if (search.available && search.value.dashboard !== null) {
      const { dashboard } = search.value;
      return pass('dependency_updates', settings, describeDashboard(dashboard), {
        source: 'dashboard',
        issueNumber: dashboard.number,
        issueUrl: dashboard.url,
      });
    }

    // Neither signal was found. That is only a `fail` if both were actually
    // looked for — a check that could not run is never evidence of poor health
    // (SCORING.md §3).
    if (!paths.available) {
      return notApplicable('dependency_updates', settings, paths);
    }

    if (!search.available) {
      return notApplicable('dependency_updates', settings, search, {
        checkedPaths: [...DEPENDENCY_UPDATE_LOCATIONS],
      });
    }

    return fail(
      'dependency_updates',
      settings,
      `No Dependabot or Renovate config found at any of ${DEPENDENCY_UPDATE_LOCATIONS.join(', ')}.` +
        describeNoDashboard(search.value),
      { checkedPaths: [...DEPENDENCY_UPDATE_LOCATIONS], source: null },
    );
  },
};
