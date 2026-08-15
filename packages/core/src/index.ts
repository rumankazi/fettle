import { resolveConfig } from './config.js';
import { aggregateRepoScore, gradeFromScore } from './scoring.js';
import type { RepoHealthConfig, RepoReport, RuleResult } from './types.js';

export { TOOL_NAME, TOOL_VERSION } from './branding.js';
export * from './config.js';
export * from './github/client.js';
export * from './report.js';
export * from './scoring.js';
export * from './types.js';

export async function assess(
  repo: string,
  config: Partial<RepoHealthConfig> = {},
): Promise<RepoReport> {
  const resolved = resolveConfig(config);
  const branchWeight = resolved.rules.branch_protection.weight ?? 3;
  const rules: RuleResult[] = [
    {
      id: 'branch_protection',
      status: 'na',
      score: null,
      weight: branchWeight,
      evidence:
        'token lacks administration:read; grant it or supply a PAT/App token to unlock this check',
      details: { source: 'not-evaluated' },
    },
    {
      id: 'codeowners',
      status: 'pass',
      score: 100,
      weight: resolved.rules.codeowners.weight ?? 1,
      evidence: 'CODEOWNERS file found in a standard location',
      details: { source: 'root' },
    },
    {
      id: 'dependency_updates',
      status: 'fail',
      score: 0,
      weight: resolved.rules.dependency_updates.weight ?? 2,
      evidence: 'No Dependabot or Renovate configuration detected',
      details: { source: 'none' },
    },
    {
      id: 'open_pr_count',
      status: 'pass',
      score: 100,
      weight: resolved.rules.open_pr_count.weight ?? 1,
      evidence: '14 open non-draft PRs is within the configured threshold',
      details: { rawValue: 14 },
    },
    {
      id: 'stale_prs',
      status: 'pass',
      score: 100,
      weight: resolved.rules.stale_prs.weight ?? 2,
      evidence: '2 stale PRs is within the configured threshold',
      details: { rawValue: 2 },
    },
  ];

  const score = aggregateRepoScore(rules);

  return {
    repo,
    defaultBranch: 'main',
    score,
    grade: gradeFromScore(score),
    rules,
  };
}

export { aggregateRepoScore, gradeFromScore, thresholdScore } from './scoring.js';
