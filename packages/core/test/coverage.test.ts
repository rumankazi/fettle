import { describe, expect, it } from 'vitest';
import { blockedGroups, coverageNote } from '../src/blocked.js';
import { buildRepoReport } from '../src/report.js';
import { coverageOf, isScoreRepresentative, MIN_COVERAGE } from '../src/scoring.js';
import type { RuleId, RuleResult } from '../src/types.js';

function rule(
  id: RuleId,
  status: RuleResult['status'],
  weight: number,
  extra: Partial<RuleResult> = {},
): RuleResult {
  return {
    id,
    status,
    score: status === 'pass' ? 100 : status === 'fail' ? 0 : null,
    weight,
    evidence: `${id} ${status}`,
    ...extra,
  };
}

function report(rules: RuleResult[]) {
  return buildRepoReport({ repo: 'acme/demo', defaultBranch: 'main', rules });
}

describe('coverageOf', () => {
  it('counts what was scored against what could have been', () => {
    expect(
      coverageOf([
        rule('codeowners', 'pass', 1),
        rule('branch_protection', 'na', 3),
        rule('stale_prs', 'fail', 2),
      ]),
    ).toEqual({
      scoredRules: 2,
      totalRules: 3,
      scoredWeight: 3,
      totalWeight: 6,
      ratio: 0.5,
    });
  });

  it('does not count a rule the user turned off against them', () => {
    // Disabling a rule changes what coverage means; it does not lose you any.
    const coverage = coverageOf([
      rule('codeowners', 'pass', 1),
      rule('branch_protection', 'disabled', 3),
    ]);

    expect(coverage).toMatchObject({ scoredRules: 1, totalRules: 1, ratio: 1 });
  });

  it('reports zero rather than dividing by zero when nothing applied', () => {
    expect(coverageOf([rule('codeowners', 'disabled', 1)])).toMatchObject({
      totalWeight: 0,
      ratio: 0,
    });
    expect(coverageOf([])).toMatchObject({ ratio: 0 });
  });
});

describe('isScoreRepresentative', () => {
  it('accepts exactly the floor, so the boundary is not a cliff of one weight unit', () => {
    expect(MIN_COVERAGE).toBe(0.5);
    expect(
      isScoreRepresentative(
        coverageOf([rule('codeowners', 'pass', 1), rule('stale_prs', 'na', 1)]),
      ),
    ).toBe(true);
  });

  it('rejects a repository that could barely be read', () => {
    expect(
      isScoreRepresentative(
        coverageOf([rule('codeowners', 'pass', 1), rule('branch_protection', 'na', 3)]),
      ),
    ).toBe(false);
  });
});

describe('buildRepoReport: withholding an unrepresentative grade', () => {
  /**
   * The case this exists for. A token with only contents:read leaves one rule of
   * five scoreable; the average over that one rule used to publish a red F that
   * described the token, not the repository.
   */
  it('withholds the score when too little could be read', () => {
    const result = report([
      rule('branch_protection', 'na', 3, { details: { needs: 'administration:read' } }),
      rule('codeowners', 'fail', 1),
      rule('dependency_updates', 'na', 2, { details: { needs: 'issues:read' } }),
      rule('open_pr_count', 'na', 1, { details: { needs: 'pull_requests:read' } }),
      rule('stale_prs', 'na', 2, { details: { needs: 'pull_requests:read' } }),
    ]);

    expect(result.score).toBeNull();
    expect(result.grade).toBe('N/A');
    expect(result.coverage).toMatchObject({ scoredWeight: 1, totalWeight: 9 });
    // The individual results are all still there; only the aggregate is withheld.
    expect(result.rules).toHaveLength(5);
    expect(result.rules[1].score).toBe(0);
  });

  it('still grades the ordinary default-token case', () => {
    // branch_protection is weight 3 of 9 and goes na on the default GITHUB_TOKEN.
    // That must keep working, or the floor would break the common path.
    const result = report([
      rule('branch_protection', 'na', 3),
      rule('codeowners', 'pass', 1),
      rule('dependency_updates', 'pass', 2),
      rule('open_pr_count', 'pass', 1),
      rule('stale_prs', 'pass', 2),
    ]);

    expect(result.grade).toBe('A');
    expect(result.score).toBe(100);
    expect(result.coverage.ratio).toBe(0.667);
  });

  it('reports coverage even when everything ran', () => {
    const result = report([rule('codeowners', 'pass', 1)]);
    expect(result.coverage).toMatchObject({ ratio: 1, scoredWeight: 1, totalWeight: 1 });
  });
});

describe('blockedGroups', () => {
  const blocked = (id: RuleId, weight: number, needs: string) =>
    rule(id, 'na', weight, { evidence: `grant ${needs}`, details: { needs } });

  it('merges rules that one grant would unlock', () => {
    const groups = blockedGroups(
      report([
        blocked('open_pr_count', 1, 'pull_requests:read'),
        blocked('stale_prs', 2, 'pull_requests:read'),
        rule('codeowners', 'pass', 1),
      ]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      needs: 'pull_requests:read',
      rules: ['open_pr_count', 'stale_prs'],
      weight: 3,
    });
  });

  it('orders by weight, which is the order worth fixing them in', () => {
    const groups = blockedGroups(
      report([
        blocked('codeowners', 1, 'contents:read'),
        blocked('branch_protection', 3, 'administration:read'),
        blocked('dependency_updates', 2, 'issues:read'),
      ]),
    );

    expect(groups.map((g) => g.needs)).toEqual([
      'administration:read',
      'issues:read',
      'contents:read',
    ]);
  });

  it('keeps checks with no fix apart, since their reasons differ', () => {
    // A rate limit and a missing GHES endpoint are both `na` with no permission to
    // grant. Merging them would attach one group's reason to the other's rule.
    const groups = blockedGroups(
      report([
        rule('open_pr_count', 'na', 1, { evidence: 'rate limit exhausted' }),
        rule('branch_protection', 'na', 3, { evidence: 'endpoint missing on this GHES' }),
      ]),
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.needs)).toEqual([null, null]);
    expect(groups[0].reason).toBe('endpoint missing on this GHES');
  });

  it('ignores a rule that merely failed, which is a result and not a blockage', () => {
    expect(blockedGroups(report([rule('codeowners', 'fail', 1)]))).toEqual([]);
  });
});

describe('coverageNote', () => {
  it('says nothing when everything ran', () => {
    expect(coverageNote(report([rule('codeowners', 'pass', 1)]))).toBeUndefined();
  });

  it('explains a withheld grade, which is what a reader needs to interpret N/A', () => {
    const note = coverageNote(
      report([rule('codeowners', 'pass', 1), rule('branch_protection', 'na', 9)]),
    );

    expect(note).toContain('1 of 10 weight');
    expect(note).toContain('no grade is reported');
  });

  it('flags partial coverage even when the grade survives', () => {
    const note = coverageNote(
      report([
        rule('codeowners', 'pass', 1),
        rule('dependency_updates', 'pass', 2),
        rule('branch_protection', 'na', 1),
      ]),
    );

    expect(note).toContain('3 of 4 weight');
    expect(note).toContain('the grade reflects only those checks');
  });
});
