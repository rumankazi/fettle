import type {
  BranchProtectionInfo,
  RepoContext,
  RuleResult,
  RuleThresholdConfig,
} from '../types.js';

function thresholdScore(value: number, goodAt: number, badAt: number): number {
  if (value <= goodAt) {
    return 100;
  }

  if (value >= badAt) {
    return 0;
  }

  return Number(((100 * (badAt - value)) / (badAt - goodAt)).toFixed(1));
}

export function evaluateBranchProtectionRule(
  ctx: RepoContext,
  config: RuleThresholdConfig = {},
): RuleResult {
  const branchProtection: BranchProtectionInfo | undefined = ctx.branchProtection;
  const weight = config.weight ?? 3;

  if (config.enabled === false) {
    return {
      id: 'branch_protection',
      status: 'disabled',
      score: null,
      weight,
      evidence: 'branch protection check disabled by policy',
      details: { enabled: false },
    };
  }

  if (branchProtection?.permissionDenied) {
    return {
      id: 'branch_protection',
      status: 'na',
      score: null,
      weight,
      evidence:
        'token lacks administration:read; grant it or supply a PAT/App token to unlock this check',
      details: { source: branchProtection.source ?? 'unknown' },
    };
  }

  if (branchProtection?.enabled) {
    return {
      id: 'branch_protection',
      status: 'pass',
      score: 100,
      weight,
      evidence: `Default branch '${ctx.defaultBranch}' is protected via ${branchProtection.source ?? 'ruleset'}`,
      details: { source: branchProtection.source ?? 'ruleset' },
    };
  }

  return {
    id: 'branch_protection',
    status: 'fail',
    score: 0,
    weight,
    evidence: `No branch protection or ruleset detected on the default branch '${ctx.defaultBranch}'`,
    details: { source: 'none' },
  };
}

export function evaluateThresholdRule(
  id: 'open_pr_count' | 'stale_prs',
  value: number,
  config: RuleThresholdConfig,
  label: string,
): RuleResult {
  const weight = config.weight ?? 1;
  const goodAt = config.good_at ?? 0;
  const badAt = config.bad_at ?? goodAt + 1;

  if (config.enabled === false) {
    return {
      id,
      status: 'disabled',
      score: null,
      weight,
      evidence: `${label} check disabled by policy`,
      details: { enabled: false },
    };
  }

  const score = thresholdScore(value, goodAt, badAt);
  return {
    id,
    status: score >= 100 ? 'pass' : score <= 0 ? 'fail' : 'fail',
    score,
    weight,
    evidence: `${label} is ${value} and scores ${score.toFixed(1)}`,
    details: { rawValue: value, good_at: goodAt, bad_at: badAt },
  };
}
