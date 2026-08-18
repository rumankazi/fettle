import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config.js';
import { available, unavailable } from '../src/probe.js';
import { branchProtectionRule } from '../src/rules/branch-protection.js';
import { codeownersRule } from '../src/rules/codeowners.js';
import { dependencyUpdatesRule } from '../src/rules/dependency-updates.js';
import { openPrCountRule } from '../src/rules/open-pr-count.js';
import { evaluateRules, ruleOrder } from '../src/rules/rule.js';
import { stalePrsRule } from '../src/rules/stale-prs.js';
import { daysAgo, NOW, pullRequest, pullRequests, repoContext } from './helpers/context.js';

const settings = defaultConfig.rules;

const DENIED = unavailable(
  'token lacks administration:read; grant it or supply a PAT/App token to unlock this check',
);

describe('branch_protection', () => {
  it('passes when the default branch is protected, naming what protects it', () => {
    const result = branchProtectionRule.evaluate(repoContext(), settings.branch_protection);
    expect(result.status).toBe('pass');
    expect(result.score).toBe(100);
    expect(result.evidence).toContain("ruleset 'main-protection'");
  });

  it('fails when nothing protects the default branch', () => {
    const result = branchProtectionRule.evaluate(
      repoContext({
        branchProtection: available({ protected: false, source: 'legacy', description: 'none' }),
      }),
      settings.branch_protection,
    );

    expect(result.status).toBe('fail');
    expect(result.score).toBe(0);
    expect(result.evidence).toContain('main');
  });

  it('is na, never fail, when the token cannot read protection, and says how to unlock it', () => {
    const result = branchProtectionRule.evaluate(
      repoContext({ branchProtection: DENIED }),
      settings.branch_protection,
    );

    expect(result.status).toBe('na');
    expect(result.score).toBeNull();
    expect(result.evidence).toContain('administration:read');
  });
});

describe('codeowners', () => {
  it.each(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'])('passes for %s', (path) => {
    const result = codeownersRule.evaluate(
      repoContext({ existingPaths: available([path]) }),
      settings.codeowners,
    );
    expect(result.status).toBe('pass');
    expect(result.evidence).toContain(path);
  });

  it('fails when no standard location holds one', () => {
    const result = codeownersRule.evaluate(
      repoContext({ existingPaths: available(['README.md']) }),
      settings.codeowners,
    );
    expect(result.status).toBe('fail');
    expect(result.score).toBe(0);
  });

  it('is na when the repository contents could not be read', () => {
    const result = codeownersRule.evaluate(
      repoContext({ existingPaths: unavailable('contents API unavailable') }),
      settings.codeowners,
    );
    expect(result.status).toBe('na');
    expect(result.evidence).toBe('contents API unavailable');
  });
});

describe('dependency_updates', () => {
  it.each(['.github/dependabot.yml', 'renovate.json', '.github/renovate.json5', '.renovaterc'])(
    'passes for %s',
    (path) => {
      const result = dependencyUpdatesRule.evaluate(
        repoContext({ existingPaths: available([path]) }),
        settings.dependency_updates,
      );
      expect(result.status).toBe('pass');
    },
  );

  it('fails when neither a config file nor a dashboard is there', () => {
    const result = dependencyUpdatesRule.evaluate(
      repoContext({ existingPaths: available([]) }),
      settings.dependency_updates,
    );
    expect(result.status).toBe('fail');
    expect(result.evidence).toContain('No Dependabot or Renovate config');
    expect(result.evidence).toContain('No Renovate dependency dashboard is open either');
  });

  it('says so when only part of the issue list was examined', () => {
    const result = dependencyUpdatesRule.evaluate(
      repoContext({
        existingPaths: available([]),
        dependencyDashboard: available({ dashboard: null, truncated: true }),
      }),
      settings.dependency_updates,
    );
    expect(result.status).toBe('fail');
    expect(result.evidence).toContain('only the most recently updated open issues');
  });

  it('is na when the repository contents could not be read', () => {
    const result = dependencyUpdatesRule.evaluate(
      repoContext({ existingPaths: unavailable('contents API unavailable') }),
      settings.dependency_updates,
    );
    expect(result.status).toBe('na');
  });

  describe("Renovate's dependency dashboard", () => {
    const dashboard = {
      number: 42,
      title: 'Dependency Dashboard',
      url: 'https://github.test/acme/demo/issues/42',
      author: 'renovate',
      authorIsBot: true,
    };

    /**
     * The case this rule exists to cover: an organisation runs one Renovate
     * operator from a shared config, so member repositories hold no config file of
     * their own and used to grade as `fail`.
     */
    it('passes on the dashboard alone, with no config file present', () => {
      const result = dependencyUpdatesRule.evaluate(
        repoContext({
          existingPaths: available([]),
          dependencyDashboard: available({ dashboard, truncated: false }),
        }),
        settings.dependency_updates,
      );

      expect(result.status).toBe('pass');
      expect(result.score).toBe(100);
      expect(result.evidence).toContain('#42');
      expect(result.evidence).toContain('renovate');
      expect(result.details).toMatchObject({ source: 'dashboard', issueNumber: 42 });
    });

    it('matches a customised title, since the default is configurable', () => {
      const result = dependencyUpdatesRule.evaluate(
        repoContext({
          existingPaths: available([]),
          dependencyDashboard: available({
            dashboard: { ...dashboard, title: 'ACME Platform: Dependency Dashboard' },
            truncated: false,
          }),
        }),
        settings.dependency_updates,
      );
      expect(result.status).toBe('pass');
    });

    it('flags a dashboard opened by something other than an app, rather than hiding it', () => {
      const result = dependencyUpdatesRule.evaluate(
        repoContext({
          existingPaths: available([]),
          dependencyDashboard: available({
            dashboard: { ...dashboard, author: 'some-human', authorIsBot: false },
            truncated: false,
          }),
        }),
        settings.dependency_updates,
      );

      // Still a pass — the title is the signal, and Renovate can run under a
      // machine user. The evidence names the author so a reader can judge it.
      expect(result.status).toBe('pass');
      expect(result.evidence).toContain('some-human');
      expect(result.evidence).toContain('not an app account');
    });

    it('prefers a config file, which is the stronger signal', () => {
      const result = dependencyUpdatesRule.evaluate(
        repoContext({
          existingPaths: available(['renovate.json']),
          dependencyDashboard: available({ dashboard, truncated: false }),
        }),
        settings.dependency_updates,
      );
      expect(result.details).toMatchObject({ source: 'config', path: 'renovate.json' });
    });

    it('still passes on a config file when the issues could not be read at all', () => {
      const result = dependencyUpdatesRule.evaluate(
        repoContext({
          existingPaths: available(['renovate.json']),
          dependencyDashboard: unavailable('issues:read not granted'),
        }),
        settings.dependency_updates,
      );
      expect(result.status).toBe('pass');
    });

    it('is na, not fail, when no config file exists and the issues could not be read', () => {
      const result = dependencyUpdatesRule.evaluate(
        repoContext({
          existingPaths: available([]),
          dependencyDashboard: unavailable('issues:read not granted'),
        }),
        settings.dependency_updates,
      );

      // Without the issues we cannot tell a repository with no dependency updates
      // from one configured centrally, and a check we could not run is never
      // evidence of poor health (SCORING.md §3).
      expect(result.status).toBe('na');
      expect(result.score).toBeNull();
      expect(result.evidence).toContain('issues:read');
    });
  });
});

describe('open_pr_count', () => {
  function scoreFor(count: number): number | null {
    const prs = Array.from({ length: count }, (_, index) => pullRequest({ number: index + 1 }));
    return openPrCountRule.evaluate(
      repoContext({ pullRequests: pullRequests(prs) }),
      settings.open_pr_count,
    ).score;
  }

  it('scores 100 at good_at and below', () => {
    expect(scoreFor(0)).toBe(100);
    expect(scoreFor(10)).toBe(100);
  });

  it('scores 0 at bad_at and above', () => {
    expect(scoreFor(30)).toBe(0);
    expect(scoreFor(31)).toBe(0);
  });

  it('interpolates between the thresholds', () => {
    expect(scoreFor(14)).toBe(80);
  });

  it('passes only on full marks, so partial credit reads as a shortfall', () => {
    const prs = Array.from({ length: 14 }, (_, index) => pullRequest({ number: index + 1 }));
    const result = openPrCountRule.evaluate(
      repoContext({ pullRequests: pullRequests(prs) }),
      settings.open_pr_count,
    );
    expect(result.status).toBe('fail');
    expect(result.score).toBe(80);
  });

  it('excludes drafts, which are declared work-in-progress rather than neglect', () => {
    const result = openPrCountRule.evaluate(
      repoContext({
        pullRequests: pullRequests([
          pullRequest({ number: 1 }),
          pullRequest({ number: 2, isDraft: true }),
          pullRequest({ number: 3, isDraft: true }),
        ]),
      }),
      settings.open_pr_count,
    );

    expect(result.details).toMatchObject({ value: 1, draftsExcluded: 2 });
  });

  it('is na when the pull request query failed', () => {
    const result = openPrCountRule.evaluate(
      repoContext({ pullRequests: unavailable('GraphQL API unavailable on this GHES version') }),
      settings.open_pr_count,
    );
    expect(result.status).toBe('na');
    expect(result.score).toBeNull();
  });

  it('says so when the count is only a lower bound', () => {
    const prs = Array.from({ length: 3 }, (_, index) => pullRequest({ number: index + 1 }));
    const result = openPrCountRule.evaluate(
      repoContext({ pullRequests: pullRequests(prs, true) }),
      settings.open_pr_count,
    );

    expect(result.evidence).toContain('At least 3 open non-draft pull request(s)');
    expect(result.evidence).toContain('stopped paging');
    expect(result.details).toMatchObject({ truncated: true });
  });
});

describe('stale_prs', () => {
  const stale = () => pullRequest({ createdAt: daysAgo(30), lastCommitAt: daysAgo(10) });

  function evaluate(prs: ReturnType<typeof pullRequest>[]) {
    return stalePrsRule.evaluate(
      repoContext({ pullRequests: pullRequests(prs) }),
      settings.stale_prs,
    );
  }

  it('counts a PR open past open_days with no commit inside inactive_days', () => {
    expect(evaluate([stale()]).details).toMatchObject({ value: 1 });
  });

  it('spares a PR that is old but still being pushed to', () => {
    expect(
      evaluate([pullRequest({ createdAt: daysAgo(30), lastCommitAt: daysAgo(2) })]).details,
    ).toMatchObject({ value: 0 });
  });

  it('spares a young PR even with no recent commits', () => {
    expect(
      evaluate([pullRequest({ createdAt: daysAgo(5), lastCommitAt: daysAgo(5) })]).details,
    ).toMatchObject({ value: 0 });
  });

  it('treats both thresholds as strict, so a PR exactly at the boundary is not stale', () => {
    expect(
      evaluate([pullRequest({ createdAt: daysAgo(21), lastCommitAt: daysAgo(7) })]).details,
    ).toMatchObject({ value: 0 });
  });

  it('falls back to creation time for a PR with no commits', () => {
    expect(
      evaluate([pullRequest({ createdAt: daysAgo(30), lastCommitAt: null })]).details,
    ).toMatchObject({ value: 1 });
  });

  it('excludes drafts', () => {
    expect(evaluate([{ ...stale(), isDraft: true }]).details).toMatchObject({ value: 0 });
  });

  it('scores the threshold boundaries', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...stale(), number: index + 1 }));

    expect(evaluate(many(1)).score).toBe(100);
    expect(evaluate(many(2)).score).toBe(75);
    expect(evaluate(many(5)).score).toBe(0);
    expect(evaluate(many(9)).score).toBe(0);
  });

  it('lists the offending pull requests so the evidence is actionable', () => {
    const result = evaluate([{ ...stale(), number: 42 }]);
    expect(result.details).toMatchObject({ stalePrNumbers: [42] });
  });

  it('says so when the count is only a lower bound', () => {
    const result = stalePrsRule.evaluate(
      repoContext({ pullRequests: pullRequests([stale()], true) }),
      settings.stale_prs,
    );

    expect(result.evidence).toContain('At least 1 pull request(s)');
    expect(result.details).toMatchObject({ truncated: true });
  });

  it('respects a configured inactive_days window', () => {
    const result = stalePrsRule.evaluate(
      repoContext({
        pullRequests: pullRequests([
          pullRequest({ createdAt: daysAgo(30), lastCommitAt: daysAgo(10) }),
        ]),
      }),
      { ...settings.stale_prs, inactive_days: 14 },
    );
    expect(result.details).toMatchObject({ value: 0 });
  });
});

describe('the registry', () => {
  it('reports every rule, always, in a stable order', () => {
    expect(ruleOrder).toEqual([
      'branch_protection',
      'codeowners',
      'dependency_updates',
      'open_pr_count',
      'stale_prs',
    ]);
    expect(evaluateRules(repoContext(), settings).map((rule) => rule.id)).toEqual(ruleOrder);
  });

  it('reports a disabled rule as disabled without asking the rule to run', () => {
    const results = evaluateRules(repoContext({ branchProtection: DENIED }), {
      ...settings,
      branch_protection: { enabled: false, weight: 3 },
    });

    const result = results.find((rule) => rule.id === 'branch_protection');
    expect(result?.status).toBe('disabled');
    expect(result?.score).toBeNull();
    expect(result?.weight).toBe(3);
  });

  it('gives every result a non-empty evidence string', () => {
    const results = evaluateRules(
      repoContext({ branchProtection: DENIED, existingPaths: available([]) }),
      settings,
    );
    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
    }
  });

  it('evaluates against the injected instant rather than the wall clock', () => {
    const results = evaluateRules(
      repoContext({
        now: NOW,
        pullRequests: pullRequests([
          pullRequest({ createdAt: daysAgo(30), lastCommitAt: daysAgo(10) }),
        ]),
      }),
      settings,
    );
    expect(results.find((rule) => rule.id === 'stale_prs')?.details).toMatchObject({ value: 1 });
  });
});
