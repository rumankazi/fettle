import { describe, expect, it } from 'vitest';
import {
  createRepoFileReader,
  fetchRepoContext,
  parseRepoRef,
  RepoAccessError,
} from '../src/github/context.js';
import type { Probe } from '../src/types.js';
import { fixture } from './helpers/fixtures.js';
import { createTransport, type Handlers } from './helpers/transport.js';

const REPO = { owner: 'acme', name: 'demo' };

const REPO_ROUTE = 'GET /repos/acme/demo';
const TREE_ROOT = 'GET /repos/acme/demo/git/trees/main';
const TREE_GITHUB = 'GET /repos/acme/demo/git/trees/aa11bb22cc33dd44ee55ff6677889900aabbccdd';
const TREE_DOCS = 'GET /repos/acme/demo/git/trees/bb22cc33dd44ee55ff6677889900aabbccddeeff';
const BRANCH_RULES = 'GET /repos/acme/demo/rules/branches/main';
const RULESETS = 'GET /repos/acme/demo/rulesets';
const LEGACY_PROTECTION = 'GET /repos/acme/demo/branches/main/protection';
const GRAPHQL = 'POST /graphql';

const FORBIDDEN = { status: 403, body: fixture('forbidden') };
const NOT_FOUND = { status: 404, body: { message: 'Not Found' } };

/** A fully readable repository; individual tests override one route at a time. */
function happyRoutes(): Handlers {
  return {
    [REPO_ROUTE]: { body: fixture('repo') },
    [TREE_ROOT]: { body: fixture('tree-root') },
    [TREE_GITHUB]: { body: fixture('tree-dot-github') },
    [TREE_DOCS]: { body: fixture('tree-docs') },
    [BRANCH_RULES]: { body: fixture('branch-rules') },
    [RULESETS]: { body: fixture('rulesets') },
    [GRAPHQL]: { body: fixture('pull-requests') },
  };
}

function fetchWith(overrides: Handlers = {}) {
  const transport = createTransport({ ...happyRoutes(), ...overrides });
  return { transport, context: fetchRepoContext(transport.client, REPO) };
}

function expectAvailable<T>(probe: Probe<T>): T {
  if (!probe.available) throw new Error(`expected an available probe, got: ${probe.reason}`);
  return probe.value;
}

function expectUnavailable(probe: Probe<unknown>): string {
  if (probe.available) throw new Error('expected an unavailable probe');
  return probe.reason;
}

describe('parseRepoRef', () => {
  it('splits org/name', () => {
    expect(parseRepoRef('acme/demo')).toEqual({ owner: 'acme', name: 'demo' });
    expect(parseRepoRef('  acme/demo  ')).toEqual({ owner: 'acme', name: 'demo' });
  });

  it.each(['demo', 'acme/demo/extra', 'acme /demo', ''])('rejects %o', (input) => {
    expect(() => parseRepoRef(input)).toThrow(RepoAccessError);
  });
});

describe('fetchRepoContext: repository metadata', () => {
  it('reads the default branch', async () => {
    const { context } = fetchWith();
    expect((await context).defaultBranch).toBe('main');
  });

  it('names the repository in the context', async () => {
    const ctx = await fetchWith().context;
    expect(ctx.owner).toBe('acme');
    expect(ctx.repo).toBe('demo');
  });

  it('throws a helpful error when the repository is not visible', async () => {
    await expect(fetchWith({ [REPO_ROUTE]: NOT_FOUND }).context).rejects.toThrow(
      /was not found.*private repository is indistinguishable/s,
    );
  });

  it('throws a helpful error when the token is rejected', async () => {
    await expect(
      fetchWith({ [REPO_ROUTE]: { status: 401, body: { message: 'Bad credentials' } } }).context,
    ).rejects.toThrow(/Not authorised.*GITHUB_TOKEN/s);
  });

  it('uses the injected instant so a fleet grades against one clock', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const transport = createTransport(happyRoutes());
    const ctx = await fetchRepoContext(transport.client, REPO, { now });
    expect(ctx.now).toBe(now);
  });
});

describe('fetchRepoContext: file paths', () => {
  it('walks the root and the directories rules look in', async () => {
    const paths = expectAvailable((await fetchWith().context).existingPaths);

    expect(paths).toContain('README.md');
    expect(paths).toContain('.github/CODEOWNERS');
    expect(paths).toContain('.github/dependabot.yml');
    expect(paths).toContain('docs/index.md');
  });

  it('lists only files, never directories', async () => {
    const paths = expectAvailable((await fetchWith().context).existingPaths);
    expect(paths).not.toContain('.github');
    expect(paths).not.toContain('.github/workflows');
  });

  it('costs at most three requests however many locations the rules check', async () => {
    const { transport, context } = fetchWith();
    await context;

    const treeCalls = transport.calls.filter((call) => call.path.includes('/git/trees/'));
    expect(treeCalls).toHaveLength(3);
  });

  it('skips a directory that is absent from the root tree', async () => {
    const { transport, context } = fetchWith({
      [TREE_ROOT]: { body: { tree: [{ path: 'README.md', type: 'blob', sha: 'x' }] } },
    });

    expect(expectAvailable((await context).existingPaths)).toEqual(['README.md']);
    expect(transport.calls.filter((call) => call.path.includes('/git/trees/'))).toHaveLength(1);
  });

  it('treats an unreadable subdirectory as contributing no files', async () => {
    const paths = expectAvailable(
      (await fetchWith({ [TREE_GITHUB]: FORBIDDEN }).context).existingPaths,
    );

    expect(paths).toContain('docs/index.md');
    expect(paths).not.toContain('.github/CODEOWNERS');
  });

  it('reports an empty repository as having no files rather than as unreadable', async () => {
    const probe = (
      await fetchWith({
        [TREE_ROOT]: { status: 409, body: { message: 'Git Repository is empty.' } },
      }).context
    ).existingPaths;

    expect(expectAvailable(probe)).toEqual([]);
  });

  it('degrades to unavailable, with a permission hint, when contents cannot be read', async () => {
    const reason = expectUnavailable(
      (await fetchWith({ [TREE_ROOT]: FORBIDDEN }).context).existingPaths,
    );

    expect(reason).toContain('contents:read');
  });
});

describe('fetchRepoContext: branch protection', () => {
  it('prefers rulesets and names them', async () => {
    const protection = expectAvailable((await fetchWith().context).branchProtection);

    expect(protection).toMatchObject({ protected: true, source: 'ruleset' });
    expect(protection.description).toContain("'main-protection'");
    expect(protection.description).toContain('pull_request');
  });

  it('still reports protection when the ruleset names cannot be read', async () => {
    const protection = expectAvailable(
      (await fetchWith({ [RULESETS]: FORBIDDEN }).context).branchProtection,
    );

    expect(protection.protected).toBe(true);
    expect(protection.description).toContain('3 active ruleset rules');
  });

  it('does not ask for ruleset names when no rule covers the branch', async () => {
    const { transport, context } = fetchWith({
      [BRANCH_RULES]: { body: [] },
      [LEGACY_PROTECTION]: { status: 404, body: fixture('branch-not-protected') },
    });
    await context;

    expect(transport.callsTo(RULESETS)).toHaveLength(0);
  });

  it('falls back to the legacy endpoint and describes what it protects', async () => {
    const protection = expectAvailable(
      (
        await fetchWith({
          [BRANCH_RULES]: NOT_FOUND,
          [LEGACY_PROTECTION]: { body: fixture('branch-protection-legacy') },
        }).context
      ).branchProtection,
    );

    expect(protection).toMatchObject({ protected: true, source: 'legacy' });
    expect(protection.description).toContain('required reviews');
    expect(protection.description).toContain('required status checks');
  });

  it('reports an unprotected branch as a genuine negative once both endpoints answered', async () => {
    const protection = expectAvailable(
      (
        await fetchWith({
          [BRANCH_RULES]: { body: [] },
          [LEGACY_PROTECTION]: { status: 404, body: fixture('branch-not-protected') },
        }).context
      ).branchProtection,
    );

    expect(protection.protected).toBe(false);
  });

  it('is na with the unlock instructions when the token lacks administration:read', async () => {
    const reason = expectUnavailable(
      (await fetchWith({ [BRANCH_RULES]: FORBIDDEN, [LEGACY_PROTECTION]: FORBIDDEN }).context)
        .branchProtection,
    );

    expect(reason).toContain('administration:read');
    expect(reason).toContain('PAT or App token');
  });

  it('is na, not fail, when rulesets are unreadable and legacy says "not protected"', async () => {
    // A legacy 404 only means "unprotected" if rulesets were readable and empty.
    // Without that, a ruleset we could not see might well be protecting the branch.
    const probe = (
      await fetchWith({
        [BRANCH_RULES]: FORBIDDEN,
        [LEGACY_PROTECTION]: { status: 404, body: fixture('branch-not-protected') },
      }).context
    ).branchProtection;

    expect(probe.available).toBe(false);
  });

  it('is na with a GHES note when neither endpoint exists', async () => {
    const reason = expectUnavailable(
      (await fetchWith({ [BRANCH_RULES]: NOT_FOUND, [LEGACY_PROTECTION]: NOT_FOUND }).context)
        .branchProtection,
    );

    expect(reason).toContain('GitHub Enterprise Server');
  });

  it('degrades rather than throwing on an unexpected server error', async () => {
    const probe = (
      await fetchWith({
        [BRANCH_RULES]: { status: 500, body: { message: 'Server Error' } },
        [LEGACY_PROTECTION]: { status: 500, body: { message: 'Server Error' } },
      }).context
    ).branchProtection;

    expect(probe.available).toBe(false);
  });
});

describe('fetchRepoContext: pull requests', () => {
  it('returns every open PR, drafts included, for the rules to filter', async () => {
    const { items, truncated } = expectAvailable((await fetchWith().context).pullRequests);

    expect(items.map((pr) => pr.number)).toEqual([101, 102, 103, 104]);
    expect(items.find((pr) => pr.number === 103)?.isDraft).toBe(true);
    expect(truncated).toBe(false);
  });

  it('reads the last commit date, and tolerates a PR with no commits', async () => {
    const { items } = expectAvailable((await fetchWith().context).pullRequests);

    expect(items.find((pr) => pr.number === 101)?.lastCommitAt).toBe('2026-08-14T10:15:00Z');
    expect(items.find((pr) => pr.number === 104)?.lastCommitAt).toBeNull();
  });

  it('costs one request for a repository that fits in a page', async () => {
    const { transport, context } = fetchWith();
    await context;
    expect(transport.callsTo(GRAPHQL)).toHaveLength(1);
  });

  it('follows the cursor across pages', async () => {
    let page = 0;
    const { transport, context } = fetchWith({
      [GRAPHQL]: () => {
        page += 1;
        return {
          body: {
            data: {
              repository: {
                pullRequests: {
                  pageInfo: { hasNextPage: page < 3, endCursor: `cursor-${page}` },
                  nodes: [
                    {
                      number: page,
                      createdAt: '2026-08-01T00:00:00Z',
                      isDraft: false,
                      commits: { nodes: [{ commit: { committedDate: '2026-08-02T00:00:00Z' } }] },
                    },
                  ],
                },
              },
            },
          },
        };
      },
    });

    const { items } = expectAvailable((await context).pullRequests);
    expect(items.map((pr) => pr.number)).toEqual([1, 2, 3]);

    const cursors = transport
      .callsTo(GRAPHQL)
      .map((call) => (call.body as { variables: { cursor: string | null } }).variables.cursor);
    expect(cursors).toEqual([null, 'cursor-1', 'cursor-2']);
  });

  it('asks for the maximum page size, to stay inside the request budget', async () => {
    const { transport, context } = fetchWith();
    await context;

    const variables = (transport.callsTo(GRAPHQL)[0].body as { variables: { pageSize: number } })
      .variables;
    expect(variables.pageSize).toBe(100);
  });

  it('stops paging at the cap and flags the counts as a lower bound', async () => {
    let page = 0;
    const { transport, context } = fetchWith({
      [GRAPHQL]: () => {
        page += 1;
        return {
          body: {
            data: {
              repository: {
                pullRequests: {
                  // Never-ending, as a repository everyone sends pull requests to.
                  pageInfo: { hasNextPage: true, endCursor: `cursor-${page}` },
                  nodes: [
                    {
                      number: page,
                      createdAt: '2026-08-01T00:00:00Z',
                      isDraft: false,
                      commits: { nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        };
      },
    });

    const { items, truncated } = expectAvailable((await context).pullRequests);

    expect(truncated).toBe(true);
    expect(items).toHaveLength(5);
    expect(transport.callsTo(GRAPHQL)).toHaveLength(5);
  });

  it('degrades with a permission hint when pull requests cannot be read', async () => {
    const reason = expectUnavailable(
      (await fetchWith({ [GRAPHQL]: FORBIDDEN }).context).pullRequests,
    );
    expect(reason).toContain('pull_requests:read');
  });

  it('degrades with a GHES note when GraphQL is not available', async () => {
    const reason = expectUnavailable(
      (await fetchWith({ [GRAPHQL]: NOT_FOUND }).context).pullRequests,
    );
    expect(reason).toContain('GitHub Enterprise Server');
  });

  it('degrades when GraphQL answers with errors rather than data', async () => {
    const probe = (
      await fetchWith({
        [GRAPHQL]: { body: { data: null, errors: [{ message: 'Something went wrong' }] } },
      }).context
    ).pullRequests;

    expect(probe.available).toBe(false);
  });
});

describe('fetchRepoContext: rate limiting', () => {
  /** GitHub answers both "forbidden" and "rate limited" with a 403. */
  const RATE_LIMITED = {
    status: 403,
    body: { message: 'API rate limit exceeded for 203.0.113.1.' },
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1786000000' },
  };

  it('says the rate limit is exhausted rather than blaming a missing permission', async () => {
    const reason = expectUnavailable(
      (await fetchWith({ [BRANCH_RULES]: RATE_LIMITED, [LEGACY_PROTECTION]: RATE_LIMITED }).context)
        .branchProtection,
    );

    expect(reason).toContain('rate limit is exhausted');
    expect(reason).not.toContain('administration:read');
  });

  it('says when the limit resets, and how to raise it', async () => {
    const reason = expectUnavailable(
      (await fetchWith({ [GRAPHQL]: RATE_LIMITED }).context).pullRequests,
    );

    expect(reason).toContain('resets at 2026-08-06');
    expect(reason).toContain('$GITHUB_TOKEN');
  });

  it('reports it on the file probe too', async () => {
    const reason = expectUnavailable(
      (await fetchWith({ [TREE_ROOT]: RATE_LIMITED }).context).existingPaths,
    );

    expect(reason).toContain('rate limit is exhausted');
  });

  it('fails the whole scan when even the repository cannot be read', async () => {
    await expect(fetchWith({ [REPO_ROUTE]: RATE_LIMITED }).context).rejects.toThrow(
      /rate limit is exhausted/,
    );
  });
});

describe('fetchRepoContext: request budget', () => {
  it('stays within about ten requests for a typical repository', async () => {
    const { transport, context } = fetchWith();
    await context;

    // 1 metadata + 3 trees + 1 branch rules + 1 rulesets + 1 GraphQL.
    expect(transport.calls.length).toBeLessThanOrEqual(10);
    expect(transport.calls).toHaveLength(7);
  });
});

describe('createRepoFileReader', () => {
  const CONFIG_ROUTE = 'GET /repos/acme/demo/contents/.repohealth.yml';

  it('decodes a base64 file', async () => {
    const transport = createTransport({ [CONFIG_ROUTE]: { body: fixture('config-file') } });
    const read = createRepoFileReader(transport.client, REPO, 'main');

    expect(await read('.repohealth.yml')).toBe('rules:\n  codeowners:\n    weight: 5\n');
  });

  it('requests the branch being scanned', async () => {
    const transport = createTransport({ [CONFIG_ROUTE]: { body: fixture('config-file') } });
    await createRepoFileReader(transport.client, REPO, 'release')('.repohealth.yml');

    expect(transport.calls[0].path).toContain('ref=release');
  });

  it('returns null when there is no config file', async () => {
    const transport = createTransport({});
    expect(
      await createRepoFileReader(transport.client, REPO, 'main')('.repohealth.yml'),
    ).toBeNull();
  });

  it('returns null when the path is a directory', async () => {
    const transport = createTransport({
      [CONFIG_ROUTE]: { body: [{ name: 'a.yml', type: 'file' }] },
    });

    expect(
      await createRepoFileReader(transport.client, REPO, 'main')('.repohealth.yml'),
    ).toBeNull();
  });

  it('returns null for a file too large to be inlined', async () => {
    const transport = createTransport({
      [CONFIG_ROUTE]: { body: { type: 'file', encoding: 'none', content: '', size: 2_000_000 } },
    });

    expect(
      await createRepoFileReader(transport.client, REPO, 'main')('.repohealth.yml'),
    ).toBeNull();
  });

  it('surfaces an authorisation failure rather than silently using the defaults', async () => {
    const transport = createTransport({ [CONFIG_ROUTE]: FORBIDDEN });
    await expect(
      createRepoFileReader(transport.client, REPO, 'main')('.repohealth.yml'),
    ).rejects.toThrow();
  });
});
