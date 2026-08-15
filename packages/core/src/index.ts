/**
 * Public entry point for the library.
 *
 * The scoring pipeline is pure: hand it a `RepoContext` and a config and it returns
 * a report. Fetching a `RepoContext` from the GitHub API lands in Phase 2; until
 * then this package deliberately exposes no function that pretends to have done so.
 */

import { evaluateRules } from './rules/rule.js';
import { buildHealthReport, buildRepoReport, type RepoAssessment } from './report.js';
import type { HealthReport, RepoContext, RepoReport, ResolvedConfig } from './types.js';

export { BADGE_LABEL, CONFIG_FILENAME, TOOL_NAME, TOOL_VERSION } from './branding.js';
export {
  ConfigError,
  defaultConfig,
  loadConfig,
  parseConfig,
  resolveConfig,
  SUPPORTED_CONFIG_VERSION,
  type ConfigReader,
  type ConfigResolution,
} from './config.js';
export {
  createGitHubClient,
  GITHUB_COM_API_URL,
  resolveApiBaseUrl,
  type GitHubClient,
  type GitHubClientOptions,
} from './github/client.js';
export { available, unavailable } from './probe.js';
export {
  badgeFilename,
  buildBadgePayload,
  buildFleetSummary,
  buildHealthReport,
  buildRepoReport,
  renderMarkdown,
  type RepoAssessment,
} from './report.js';
export { evaluateRules, ruleOrder, ruleRegistry } from './rules/rule.js';
export {
  aggregateRepoScore,
  countsTowardScore,
  gradeFromScore,
  meetsGradeFloor,
  thresholdScore,
} from './scoring.js';
export * from './types.js';

/** Scores one already-fetched repository context. */
export function assessContext(ctx: RepoContext, config: ResolvedConfig): RepoReport {
  return buildRepoReport({
    repo: `${ctx.owner}/${ctx.repo}`,
    defaultBranch: ctx.defaultBranch,
    rules: evaluateRules(ctx, config.rules),
  });
}

/**
 * Scores a fleet of already-fetched repository contexts into one report.
 *
 * Each repository carries its own resolved config, since `.repohealth.yml` is read
 * from the repository being scanned.
 */
export function assessContexts(
  entries: readonly { ctx: RepoContext; config: ResolvedConfig }[],
  generatedAt?: Date,
): HealthReport {
  const assessments: RepoAssessment[] = entries.map(({ ctx, config }) => ({
    repo: `${ctx.owner}/${ctx.repo}`,
    defaultBranch: ctx.defaultBranch,
    rules: evaluateRules(ctx, config.rules),
  }));

  return buildHealthReport(assessments, generatedAt);
}
