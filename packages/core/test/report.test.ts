import { describe, expect, it } from 'vitest';
import {
  badgeFilename,
  buildBadgePayload,
  buildFleetSummary,
  buildHealthReport,
  buildRepoReport,
  renderMarkdown,
  type RepoAssessment,
} from '../src/report.js';
import { TOOL_NAME, TOOL_VERSION } from '../src/branding.js';
import type { RuleResult } from '../src/types.js';

/** The SCORING.md §7 repository: unreadable protection, no dependency bot, PRs piling up. */
const workedExampleRules: RuleResult[] = [
  {
    id: 'branch_protection',
    status: 'na',
    score: null,
    weight: 3,
    evidence: 'token lacks administration:read; grant it to unlock this check',
  },
  {
    id: 'codeowners',
    status: 'pass',
    score: 100,
    weight: 1,
    evidence: 'CODEOWNERS found at .github/CODEOWNERS.',
  },
  {
    id: 'dependency_updates',
    status: 'fail',
    score: 0,
    weight: 2,
    evidence: 'No Dependabot or Renovate config found.',
  },
  { id: 'open_pr_count', status: 'fail', score: 80, weight: 1, evidence: '14 open PRs.' },
  { id: 'stale_prs', status: 'fail', score: 75, weight: 2, evidence: '2 stale PRs.' },
];

const workedExample: RepoAssessment = {
  repo: 'acme/demo',
  defaultBranch: 'main',
  rules: workedExampleRules,
};

const GENERATED_AT = new Date('2026-08-15T09:30:00.000Z');

describe('buildRepoReport', () => {
  it('scores and grades the worked example', () => {
    const report = buildRepoReport(workedExample);
    expect(report.score).toBe(55);
    expect(report.grade).toBe('F');
    expect(report.rules).toHaveLength(5);
  });
});

describe('buildFleetSummary', () => {
  it('averages scores and tallies grades', () => {
    const summary = buildFleetSummary([
      buildRepoReport(workedExample),
      buildRepoReport({
        repo: 'acme/other',
        defaultBranch: 'trunk',
        rules: [{ id: 'codeowners', status: 'pass', score: 100, weight: 1, evidence: 'ok' }],
      }),
    ]);

    expect(summary).toEqual({ repoCount: 2, averageScore: 77.5, grades: { F: 1, A: 1 } });
  });

  it('reports a null average when no repository could be scored', () => {
    const summary = buildFleetSummary([
      buildRepoReport({
        repo: 'acme/opaque',
        defaultBranch: 'main',
        rules: [{ id: 'codeowners', status: 'na', score: null, weight: 1, evidence: 'no access' }],
      }),
    ]);

    expect(summary).toEqual({ repoCount: 1, averageScore: null, grades: { 'N/A': 1 } });
  });

  it('handles an empty fleet', () => {
    expect(buildFleetSummary([])).toEqual({ repoCount: 0, averageScore: null, grades: {} });
  });
});

describe('buildHealthReport', () => {
  it('emits the schemaVersion 1 envelope', () => {
    const report = buildHealthReport([workedExample], GENERATED_AT);

    expect(report.schemaVersion).toBe(1);
    // Not a literal: release-please bumps TOOL_VERSION, and a test that pins the
    // version breaks on every release. `branding.test.ts` is what checks the
    // version is right; this only checks the report carries it.
    expect(report.tool).toEqual({ name: TOOL_NAME, version: TOOL_VERSION });
    expect(report.generatedAt).toBe('2026-08-15T09:30:00.000Z');
    expect(report.repos[0]).toMatchObject({ repo: 'acme/demo', score: 55, grade: 'F' });
    expect(report.fleet).toEqual({ repoCount: 1, averageScore: 55, grades: { F: 1 } });
  });
});

describe('buildBadgePayload', () => {
  it.each([
    [100, 'A', 'brightgreen'],
    [80, 'B', 'green'],
    [70, 'C', 'yellow'],
    [60, 'D', 'orange'],
    [0, 'F', 'red'],
  ])('maps score %s to a %s badge', (score, grade, color) => {
    const badge = buildBadgePayload({
      repo: 'acme/demo',
      defaultBranch: 'main',
      score,
      grade: grade as never,
      rules: [],
    });

    expect(badge).toEqual({
      schemaVersion: 1,
      label: 'repo health',
      message: `${grade} (${score.toFixed(1)})`,
      color,
    });
  });

  it('omits the score for an ungradeable repository', () => {
    const badge = buildBadgePayload({
      repo: 'acme/demo',
      defaultBranch: 'main',
      score: null,
      grade: 'N/A',
      rules: [],
    });

    expect(badge).toMatchObject({ message: 'N/A', color: 'lightgrey' });
  });
});

describe('badgeFilename', () => {
  it('turns a repository name into a safe filename', () => {
    expect(badgeFilename('acme/demo')).toBe('acme__demo.json');
    expect(badgeFilename('acme/demo.js')).toBe('acme__demo.js.json');
  });
});

describe('renderMarkdown', () => {
  const markdown = renderMarkdown(buildHealthReport([workedExample], GENERATED_AT));

  it('renders one table per repository with an evidence column', () => {
    expect(markdown).toContain('## acme/demo');
    expect(markdown).toContain('| Rule | Status | Score | Weight | Evidence |');
    expect(markdown).toContain('`codeowners`');
    expect(markdown).toContain('CODEOWNERS found at .github/CODEOWNERS.');
  });

  it('states the grade and score', () => {
    expect(markdown).toContain('**Grade F** — score 55.0');
  });

  it('calls out checks that could not run, highest weight first (SCORING.md §7)', () => {
    expect(markdown).toContain('### Checks we could not run');
    expect(markdown).toContain('`branch_protection` (weight 3) — token lacks administration:read');
  });

  it('omits the unrunnable section when every check ran', () => {
    const clean = renderMarkdown(
      buildHealthReport(
        [
          {
            repo: 'acme/clean',
            defaultBranch: 'main',
            rules: [{ id: 'codeowners', status: 'pass', score: 100, weight: 1, evidence: 'ok' }],
          },
        ],
        GENERATED_AT,
      ),
    );

    expect(clean).not.toContain('Checks we could not run');
  });

  it('summarises the fleet only when more than one repository was scanned', () => {
    expect(markdown).not.toContain('repositories');

    const fleet = renderMarkdown(
      buildHealthReport([workedExample, { ...workedExample, repo: 'acme/other' }], GENERATED_AT),
    );
    expect(fleet).toContain('2 repositories, average score 55.0: 2×F');
  });

  it('escapes pipes so evidence cannot break the table', () => {
    const escaped = renderMarkdown(
      buildHealthReport(
        [
          {
            repo: 'acme/demo',
            defaultBranch: 'main',
            rules: [{ id: 'codeowners', status: 'pass', score: 100, weight: 1, evidence: 'a | b' }],
          },
        ],
        GENERATED_AT,
      ),
    );

    expect(escaped).toContain('a \\| b');
  });

  it('flattens newlines, so repository data cannot break out of a table row', () => {
    // Evidence embeds data from the scanned repository — a ruleset named across
    // two lines must not be able to restructure the report.
    const injected = renderMarkdown(
      buildHealthReport(
        [
          {
            repo: 'acme/demo',
            defaultBranch: 'main',
            rules: [
              {
                id: 'branch_protection',
                status: 'na',
                score: null,
                weight: 3,
                evidence: 'ruleset\n\n## Injected heading\n| a | b |',
              },
            ],
          },
        ],
        GENERATED_AT,
      ),
    );

    // The text survives; what it must not do is start a line, because that is
    // what would turn it into a heading or a new table row.
    const lines = injected.split('\n');
    expect(lines.some((line) => line.startsWith('## Injected'))).toBe(false);
    expect(lines.filter((line) => line.startsWith('|'))).toHaveLength(3); // header, divider, one rule
    expect(injected).toContain('ruleset ## Injected heading \\| a \\| b \\|');
  });
});
