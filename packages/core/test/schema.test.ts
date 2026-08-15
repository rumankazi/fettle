import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config.js';
import { available, unavailable } from '../src/probe.js';
import { evaluateRules } from '../src/rules/rule.js';
import { buildHealthReport } from '../src/report.js';
import { daysAgo, pullRequest, pullRequests, repoContext } from './helpers/context.js';

/**
 * The report is the published contract (SCORING.md §6). These tests pin the parts
 * of it that documentation promises, so the doc cannot quietly drift from the code.
 */

function rulesFor() {
  return evaluateRules(
    repoContext({
      existingPaths: available(['.github/CODEOWNERS']),
      branchProtection: unavailable('token lacks administration:read'),
      pullRequests: pullRequests([
        pullRequest({ number: 1, createdAt: daysAgo(40), lastCommitAt: daysAgo(30) }),
        pullRequest({ number: 2, isDraft: true }),
      ]),
    }),
    defaultConfig.rules,
  );
}

describe('the published report schema', () => {
  const report = buildHealthReport(
    [{ repo: 'acme/demo', defaultBranch: 'main', rules: rulesFor() }],
    new Date('2026-08-15T09:30:00.000Z'),
  );

  it('carries the documented envelope', () => {
    expect(Object.keys(report).sort()).toEqual([
      'fleet',
      'generatedAt',
      'repos',
      'schemaVersion',
      'tool',
    ]);
    expect(report.schemaVersion).toBe(1);
  });

  it('carries the documented repository fields', () => {
    expect(Object.keys(report.repos[0]).sort()).toEqual([
      'defaultBranch',
      'grade',
      'repo',
      'rules',
      'score',
    ]);
  });

  it('carries the documented rule fields, and always all five rules', () => {
    expect(report.repos[0].rules).toHaveLength(5);
    for (const rule of report.repos[0].rules) {
      expect(Object.keys(rule).sort()).toEqual([
        'details',
        'evidence',
        'id',
        'score',
        'status',
        'weight',
      ]);
    }
  });

  it('never emits an empty evidence string, whatever the status', () => {
    for (const rule of report.repos[0].rules) {
      expect(rule.evidence.trim().length).toBeGreaterThan(0);
    }
  });

  it('scores null exactly when the rule was not scored', () => {
    for (const rule of report.repos[0].rules) {
      const scored = rule.status === 'pass' || rule.status === 'fail';
      expect(rule.score === null).toBe(!scored);
    }
  });

  it('promises value, thresholds and truncated on the threshold rules', () => {
    for (const id of ['open_pr_count', 'stale_prs'] as const) {
      const details = report.repos[0].rules.find((r) => r.id === id)?.details ?? {};
      expect(Object.keys(details)).toEqual(
        expect.arrayContaining(['value', 'good_at', 'bad_at', 'truncated']),
      );
      expect(typeof details.value).toBe('number');
    }
  });

  it('promises path on a file rule that passed', () => {
    expect(report.repos[0].rules.find((r) => r.id === 'codeowners')?.details).toHaveProperty(
      'path',
    );
  });

  it('promises source on branch_protection once it could be read', () => {
    const readable = evaluateRules(
      repoContext({
        branchProtection: available({
          protected: true,
          source: 'ruleset',
          description: "ruleset 'main'",
        }),
      }),
      defaultConfig.rules,
    );

    expect(readable.find((r) => r.id === 'branch_protection')?.details).toHaveProperty(
      'source',
      'ruleset',
    );
  });

  it('carries no measurement on a rule that could not be run', () => {
    // A promise of `source` would be a lie here: there was nothing to read. The
    // documented contract says to check `status` first for exactly this reason.
    const blocked = report.repos[0].rules.find((r) => r.id === 'branch_protection');

    expect(blocked?.status).toBe('na');
    expect(blocked?.score).toBeNull();
    expect(blocked?.details?.source).toBeUndefined();
    expect(blocked?.evidence).toContain('administration:read');
  });

  it('omits fleet grades that no repository earned', () => {
    expect(report.fleet.grades.A).toBeUndefined();
    expect(Object.values(report.fleet.grades).every((n) => n > 0)).toBe(true);
  });
});
