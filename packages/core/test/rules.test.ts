import { describe, expect, it } from 'vitest';
import { evaluateBranchProtectionRule } from '../src/rules/branch-protection.js';
import { evaluateCodeownersRule } from '../src/rules/codeowners.js';
import { evaluateDependencyUpdatesRule } from '../src/rules/dependency-updates.js';
import { evaluateOpenPrCountRule } from '../src/rules/open-pr-count.js';
import { evaluateStalePrsRule } from '../src/rules/stale-prs.js';
import type { RepoContext, RuleConfigMap } from '../src/types.js';

const baseConfig: RuleConfigMap = {
  branch_protection: { enabled: true, weight: 3 },
  codeowners: { enabled: true, weight: 1 },
  dependency_updates: { enabled: true, weight: 2 },
  open_pr_count: { enabled: true, weight: 1, good_at: 10, bad_at: 30 },
  stale_prs: { enabled: true, weight: 2, good_at: 1, bad_at: 5, open_days: 21, inactive_days: 7 },
};

function makeContext(overrides: Partial<RepoContext> = {}): RepoContext {
  return {
    owner: 'acme',
    repo: 'demo',
    defaultBranch: 'main',
    octokit: {} as RepoContext['octokit'],
    files: ['.github/CODEOWNERS'],
    branchProtection: { enabled: true },
    prFlow: {
      openPrCount: 14,
      stalePrCount: 2,
      prs: [],
    },
    ...overrides,
  };
}

describe('branch protection rule', () => {
  it('passes when a ruleset or protection exists', () => {
    const result = evaluateBranchProtectionRule(makeContext(), baseConfig.branch_protection);
    expect(result.status).toBe('pass');
    expect(result.score).toBe(100);
  });

  it('returns na when access is denied', () => {
    const result = evaluateBranchProtectionRule(
      makeContext({ branchProtection: { enabled: false, permissionDenied: true } }),
      baseConfig.branch_protection,
    );

    expect(result.status).toBe('na');
    expect(result.evidence).toContain('administration:read');
  });
});

describe('codeowners rule', () => {
  it('passes when CODEOWNERS exists in a standard location', () => {
    const result = evaluateCodeownersRule(makeContext(), baseConfig.codeowners);
    expect(result.status).toBe('pass');
    expect(result.score).toBe(100);
  });

  it('fails when CODEOWNERS is absent', () => {
    const result = evaluateCodeownersRule(
      makeContext({ files: ['README.md'] }),
      baseConfig.codeowners,
    );
    expect(result.status).toBe('fail');
    expect(result.score).toBe(0);
  });
});

describe('dependency updates rule', () => {
  it('passes when Dependabot or Renovate config exists', () => {
    const result = evaluateDependencyUpdatesRule(
      makeContext({ files: ['.github/dependabot.yml'] }),
      baseConfig.dependency_updates,
    );
    expect(result.status).toBe('pass');
    expect(result.score).toBe(100);
  });

  it('fails when no dependency update config exists', () => {
    const result = evaluateDependencyUpdatesRule(
      makeContext({ files: ['README.md'] }),
      baseConfig.dependency_updates,
    );
    expect(result.status).toBe('fail');
    expect(result.score).toBe(0);
  });
});

describe('threshold rules', () => {
  it('scores open PR count at the good and bad boundary values', () => {
    expect(
      evaluateOpenPrCountRule(
        makeContext({ prFlow: { openPrCount: 10, prs: [] } }),
        baseConfig.open_pr_count,
      ).score,
    ).toBe(100);
    expect(
      evaluateOpenPrCountRule(
        makeContext({ prFlow: { openPrCount: 30, prs: [] } }),
        baseConfig.open_pr_count,
      ).score,
    ).toBe(0);
    expect(
      evaluateOpenPrCountRule(
        makeContext({ prFlow: { openPrCount: 14, prs: [] } }),
        baseConfig.open_pr_count,
      ).score,
    ).toBe(80);
  });

  it('scores stale PRs across its threshold range', () => {
    expect(
      evaluateStalePrsRule(
        makeContext({ prFlow: { stalePrCount: 1, prs: [] } }),
        baseConfig.stale_prs,
      ).score,
    ).toBe(100);
    expect(
      evaluateStalePrsRule(
        makeContext({ prFlow: { stalePrCount: 5, prs: [] } }),
        baseConfig.stale_prs,
      ).score,
    ).toBe(0);
    expect(
      evaluateStalePrsRule(
        makeContext({ prFlow: { stalePrCount: 2, prs: [] } }),
        baseConfig.stale_prs,
      ).score,
    ).toBe(75);
  });
});
