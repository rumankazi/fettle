import { describe, expect, it } from 'vitest';
import { assess, assessRepo } from '../src/assess.js';
import { ConfigError } from '../src/config.js';
import { buildRepoReport } from '../src/report.js';
import { fixture } from './helpers/fixtures.js';
import { createTransport, type Handlers } from './helpers/transport.js';

const NOW = new Date('2026-08-15T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

interface PrSpec {
  number: number;
  createdDaysAgo: number;
  lastCommitDaysAgo: number | null;
  isDraft?: boolean;
}

function graphqlPage(prs: PrSpec[]) {
  return {
    body: {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: prs.map((pr) => ({
              number: pr.number,
              createdAt: daysAgo(pr.createdDaysAgo),
              isDraft: pr.isDraft ?? false,
              commits: {
                nodes:
                  pr.lastCommitDaysAgo === null
                    ? []
                    : [{ commit: { committedDate: daysAgo(pr.lastCommitDaysAgo) } }],
              },
            })),
          },
        },
      },
    },
  };
}

function tree(paths: string[]) {
  return {
    body: {
      sha: 'root',
      truncated: false,
      tree: paths.map((path) => ({ path, type: 'blob', sha: `sha-${path}` })),
    },
  };
}

function routes(overrides: Handlers = {}): Handlers {
  return {
    'GET /repos/acme/demo': { body: fixture('repo') },
    'GET /repos/acme/demo/git/trees/main': tree(['README.md', 'CODEOWNERS']),
    'GET /repos/acme/demo/rules/branches/main': { body: fixture('branch-rules') },
    'GET /repos/acme/demo/rulesets': { body: fixture('rulesets') },
    'POST /graphql': graphqlPage([]),
    ...overrides,
  };
}

function scan(overrides: Handlers = {}) {
  const transport = createTransport(routes(overrides));
  return transport;
}

describe('assessRepo', () => {
  it('produces one result per rule, in registry order, each with evidence', async () => {
    const transport = scan();
    const assessment = await assessRepo('acme/demo', { client: transport.client, now: NOW });

    expect(assessment.repo).toBe('acme/demo');
    expect(assessment.defaultBranch).toBe('main');
    expect(assessment.rules.map((rule) => rule.id)).toEqual([
      'branch_protection',
      'codeowners',
      'dependency_updates',
      'open_pr_count',
      'stale_prs',
    ]);
    for (const rule of assessment.rules) {
      expect(rule.evidence.length).toBeGreaterThan(0);
    }
  });

  it('reads .repohealth.yml from the branch being scanned', async () => {
    const transport = scan({
      'GET /repos/acme/demo/contents/.repohealth.yml': { body: fixture('config-file') },
    });

    const assessment = await assessRepo('acme/demo', { client: transport.client, now: NOW });
    const codeowners = assessment.rules.find((rule) => rule.id === 'codeowners');

    expect(codeowners?.weight).toBe(5);
    expect(transport.calls.some((call) => call.path.includes('ref=main'))).toBe(true);
  });

  it('falls back to the defaults when the repository has no config', async () => {
    const transport = scan();
    const assessment = await assessRepo('acme/demo', { client: transport.client, now: NOW });

    expect(assessment.rules.find((rule) => rule.id === 'codeowners')?.weight).toBe(1);
  });

  it('applies an explicit config instead of fetching the repository one', async () => {
    const transport = scan({
      'GET /repos/acme/demo/contents/.repohealth.yml': { body: fixture('config-file') },
    });

    const assessment = await assessRepo('acme/demo', {
      client: transport.client,
      now: NOW,
      config: { rules: { codeowners: { weight: 9 } } },
    });

    expect(assessment.rules.find((rule) => rule.id === 'codeowners')?.weight).toBe(9);
    expect(transport.calls.some((call) => call.path.includes('.repohealth.yml'))).toBe(false);
  });

  it('surfaces configuration warnings against the repository they came from', async () => {
    const yaml = 'rules:\n  no_such_rule:\n    weight: 2\n';
    const transport = scan({
      'GET /repos/acme/demo/contents/.repohealth.yml': {
        body: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(yaml).toString('base64'),
        },
      },
    });

    const warnings: string[] = [];
    await assessRepo('acme/demo', {
      client: transport.client,
      now: NOW,
      onWarning: (repo, warning) => warnings.push(`${repo}: ${warning}`),
    });

    expect(warnings).toEqual([
      'acme/demo: rules.no_such_rule is not a rule this version knows about and was ignored',
    ]);
  });

  it('names the repository when its configuration is invalid', async () => {
    const yaml = 'rules:\n  codeowners:\n    weight: heavy\n';
    const transport = scan({
      'GET /repos/acme/demo/contents/.repohealth.yml': {
        body: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(yaml).toString('base64'),
        },
      },
    });

    await expect(assessRepo('acme/demo', { client: transport.client, now: NOW })).rejects.toThrow(
      ConfigError,
    );
    await expect(assessRepo('acme/demo', { client: transport.client, now: NOW })).rejects.toThrow(
      /acme\/demo: rules\.codeowners\.weight must be a number/,
    );
  });
});

describe('assessRepo: the SCORING.md §7 worked example, end to end', () => {
  /**
   * Branch protection unreadable, CODEOWNERS present, no dependency bot, 14 open
   * non-draft PRs of which 2 are stale. The spec fixes the answer at 55.0 and F.
   */
  async function workedExample() {
    const openPrs: PrSpec[] = [
      // Two stale: open longer than 21 days, no commit inside 7 days.
      { number: 1, createdDaysAgo: 40, lastCommitDaysAgo: 30 },
      { number: 2, createdDaysAgo: 25, lastCommitDaysAgo: 20 },
      // Twelve healthy, including one old PR still being pushed to.
      { number: 3, createdDaysAgo: 60, lastCommitDaysAgo: 1 },
      ...Array.from({ length: 11 }, (_, index) => ({
        number: index + 4,
        createdDaysAgo: 3,
        lastCommitDaysAgo: 1,
      })),
      // Drafts are excluded from both counts, so these must not move the score.
      { number: 90, createdDaysAgo: 90, lastCommitDaysAgo: 80, isDraft: true },
      { number: 91, createdDaysAgo: 90, lastCommitDaysAgo: 80, isDraft: true },
    ];

    const transport = createTransport(
      routes({
        'GET /repos/acme/demo/git/trees/main': tree(['README.md', 'CODEOWNERS']),
        'GET /repos/acme/demo/rules/branches/main': { status: 403, body: fixture('forbidden') },
        'GET /repos/acme/demo/branches/main/protection': {
          status: 403,
          body: fixture('forbidden'),
        },
        'POST /graphql': graphqlPage(openPrs),
      }),
    );

    return assessRepo('acme/demo', { client: transport.client, now: NOW });
  }

  it('scores each rule exactly as the specification says', async () => {
    const { rules } = await workedExample();
    const byId = Object.fromEntries(rules.map((rule) => [rule.id, rule]));

    expect(byId.branch_protection).toMatchObject({ status: 'na', score: null, weight: 3 });
    expect(byId.codeowners).toMatchObject({ status: 'pass', score: 100, weight: 1 });
    expect(byId.dependency_updates).toMatchObject({ status: 'fail', score: 0, weight: 2 });
    expect(byId.open_pr_count).toMatchObject({ score: 80, weight: 1 });
    expect(byId.stale_prs).toMatchObject({ score: 75, weight: 2 });
  });

  it('counts 14 open non-draft PRs and 2 stale ones', async () => {
    const { rules } = await workedExample();
    const byId = Object.fromEntries(rules.map((rule) => [rule.id, rule]));

    expect(byId.open_pr_count.details).toMatchObject({ value: 14, draftsExcluded: 2 });
    expect(byId.stale_prs.details).toMatchObject({ value: 2, stalePrNumbers: [1, 2] });
  });

  it('aggregates to 55.0 and grades F', async () => {
    const report = buildRepoReport(await workedExample());
    expect(report.score).toBe(55);
    expect(report.grade).toBe('F');
  });

  it('tells the user that administration:read would unlock the heaviest check', async () => {
    const { rules } = await workedExample();
    const blocked = rules.find((rule) => rule.status === 'na');

    expect(blocked?.id).toBe('branch_protection');
    expect(blocked?.evidence).toContain('administration:read');
  });
});

describe('assess', () => {
  it('assembles a report over several repositories', async () => {
    const transport = createTransport({
      ...routes(),
      'GET /repos/acme/other': { body: { ...fixture<object>('repo'), full_name: 'acme/other' } },
      'GET /repos/acme/other/git/trees/main': tree(['README.md']),
      'GET /repos/acme/other/rules/branches/main': { body: [] },
      'GET /repos/acme/other/branches/main/protection': {
        status: 404,
        body: fixture('branch-not-protected'),
      },
    });

    const report = await assess(['acme/demo', 'acme/other'], {
      client: transport.client,
      now: NOW,
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.repos.map((repo) => repo.repo)).toEqual(['acme/demo', 'acme/other']);
    expect(report.fleet.repoCount).toBe(2);
  });

  it('keeps repositories in the order they were requested, whatever the scan order', async () => {
    const transport = createTransport({
      ...routes(),
      ...Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e'].flatMap((name) => [
          [`GET /repos/acme/${name}`, { body: fixture('repo') }],
          [`GET /repos/acme/${name}/git/trees/main`, tree(['README.md'])],
          [`GET /repos/acme/${name}/rules/branches/main`, { body: [] }],
          [
            `GET /repos/acme/${name}/branches/main/protection`,
            { status: 404, body: fixture('branch-not-protected') },
          ],
        ]),
      ),
    });

    const repos = ['acme/a', 'acme/b', 'acme/c', 'acme/d', 'acme/e'];
    const report = await assess(repos, { client: transport.client, now: NOW, maxConcurrency: 2 });

    expect(report.repos.map((repo) => repo.repo)).toEqual(repos);
  });

  it('grades every repository against one clock', async () => {
    const transport = createTransport(routes());
    const report = await assess(['acme/demo'], { client: transport.client, now: NOW });
    expect(report.generatedAt).toBe(NOW.toISOString());
  });

  it('reports an empty fleet without inventing an average', async () => {
    const transport = createTransport(routes());
    const report = await assess([], { client: transport.client, now: NOW });

    expect(report.repos).toEqual([]);
    expect(report.fleet).toEqual({ repoCount: 0, averageScore: null, grades: {} });
  });
});
