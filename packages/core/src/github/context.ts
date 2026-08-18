/**
 * Builds a `RepoContext` from the GitHub API.
 *
 * This module owns every network call the rules depend on, which is what keeps the
 * rules pure (DECISIONS.md D1). Two obligations follow:
 *
 * - Nothing here may throw for a check that merely could not be run. Each probe
 *   catches its own failures and returns `unavailable` with a reason the user can
 *   act on. Only a repository we cannot identify at all is fatal.
 * - The request budget is roughly ten per repository (ARCHITECTURE.md §API
 *   strategy), so paths are discovered by walking git trees rather than by probing
 *   each candidate location.
 */

import { available, unavailable } from '../probe.js';
import type {
  BranchProtection,
  Probe,
  PullRequestData,
  PullRequestSummary,
  ProbeUnavailable,
  RepoContext,
} from '../types.js';
import { GITHUB_COM_API_URL, type GitHubClient } from './client.js';
import {
  PULL_REQUEST_PAGE_SIZE,
  PULL_REQUESTS_QUERY,
  type PullRequestNode,
  type PullRequestsPage,
} from './queries.js';

/**
 * How many pages of open pull requests to walk before giving up and reporting the
 * counts as a lower bound.
 *
 * Each page is one request, and the throttling plugin paces GraphQL at one per
 * second, so an uncapped crawl of a repository with thousands of open PRs would
 * take a minute and blow the ~10-request budget on its own. Five pages covers 500
 * open pull requests, far past the point where any sane threshold scores zero.
 */
const MAX_PULL_REQUEST_PAGES = 5;

/** Directories below the repository root that can hold files a rule looks for. */
const PROBED_DIRECTORIES = ['.github', 'docs'] as const;

export interface RepoRef {
  owner: string;
  name: string;
}

/** Raised when the repository itself cannot be read; every other failure degrades. */
export class RepoAccessError extends Error {
  constructor(
    message: string,
    readonly repo: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RepoAccessError';
  }
}

/** Parses `org/name`. */
export function parseRepoRef(repo: string): RepoRef {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repo.trim());
  if (match === null) {
    throw new RepoAccessError(`'${repo}' is not a repository name of the form org/name`, repo);
  }
  return { owner: match[1], name: match[2] };
}

export function formatRepoRef(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

/**
 * Octokit rejects with a `RequestError` carrying an HTTP status. Read it
 * structurally rather than importing the error class, which is a transitive
 * dependency we do not otherwise need.
 */
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const { status } = error as { status: unknown };
  return typeof status === 'number' ? status : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Explains a failure to reach the host at all.
 *
 * A connection error against the default host almost always means the user meant a
 * GitHub Enterprise Server instance and did not say so, and nothing else in the
 * error hints at it.
 *
 * Octokit gives a network failure a synthetic `status: 500`, so the status cannot
 * distinguish one from a genuine server error. The absence of a `response` can: a
 * real 500 came back from somewhere.
 */
function unreachableHostHint(error: unknown, baseUrl: string): string | undefined {
  const hasResponse =
    typeof error === 'object' && error !== null && (error as { response?: unknown }).response;
  if (hasResponse) return undefined;

  const detail = message(error);
  const looksLikeConnection = /timeout|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|network/i.test(
    detail,
  );
  if (!looksLikeConnection) return undefined;

  if (baseUrl !== GITHUB_COM_API_URL) {
    return `Could not reach ${baseUrl}: ${detail}. Check the host is correct and reachable from here.`;
  }

  return (
    `Could not reach ${GITHUB_COM_API_URL}: ${detail}. No API URL was configured, so this used ` +
    `github.com. For GitHub Enterprise Server, pass --api-url https://your-host/api/v3 or ` +
    `--gh-host your-host, or set $GITHUB_API_URL or $GH_HOST.`
  );
}

/** True for statuses meaning "this endpoint is not here", e.g. an older GHES. */
function isMissingEndpoint(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/**
 * Explains an exhausted rate limit, or returns `undefined` if that is not what
 * went wrong.
 *
 * GitHub answers both "you may not do this" and "you have asked too often" with a
 * 403, so without this check every rate-limited scan would tell the user to grant
 * a permission they already have.
 */
function rateLimitHint(error: unknown): string | undefined {
  const response = (error as { response?: { headers?: Record<string, unknown> } }).response;
  const remaining = response?.headers?.['x-ratelimit-remaining'];
  const looksRateLimited =
    String(remaining) === '0' || /rate limit/i.test(error instanceof Error ? error.message : '');

  if (!looksRateLimited) return undefined;

  const reset = response?.headers?.['x-ratelimit-reset'];
  const resetsAt =
    typeof reset === 'string' || typeof reset === 'number'
      ? new Date(Number(reset) * 1000).toISOString()
      : undefined;

  return (
    `GitHub's API rate limit is exhausted${resetsAt === undefined ? '' : `; it resets at ${resetsAt}`}. ` +
    `Set $GITHUB_TOKEN to raise the limit, or retry later.`
  );
}

/* -------------------------------------------------------------------------- */
/* Repository metadata                                                        */
/* -------------------------------------------------------------------------- */

interface RepoMetadata {
  defaultBranch: string;
}

async function fetchMetadata(client: GitHubClient, repo: RepoRef): Promise<RepoMetadata> {
  const name = formatRepoRef(repo);

  try {
    const response = await client.request('GET /repos/{owner}/{repo}', {
      owner: repo.owner,
      repo: repo.name,
    });
    return { defaultBranch: response.data.default_branch };
  } catch (error) {
    const status = httpStatus(error);

    if (status === 404) {
      throw new RepoAccessError(
        `Repository ${name} was not found. Check the name, and that the token can see it — ` +
          `a private repository is indistinguishable from a missing one.`,
        name,
        status,
      );
    }

    if (status === 401 || status === 403) {
      const rateLimited = rateLimitHint(error);
      throw new RepoAccessError(
        rateLimited ??
          `Not authorised to read ${name}. Check that $GITHUB_TOKEN is set and has repository ` +
            `contents:read and metadata:read.`,
        name,
        status,
      );
    }

    const unreachable = unreachableHostHint(
      error,
      String(client.request.endpoint.DEFAULTS.baseUrl),
    );
    if (unreachable !== undefined) throw new RepoAccessError(unreachable, name, status);

    throw new RepoAccessError(`Could not read ${name}: ${message(error)}`, name, status);
  }
}

/* -------------------------------------------------------------------------- */
/* File paths                                                                 */
/* -------------------------------------------------------------------------- */

interface TreeEntry {
  path?: string;
  type?: string;
  sha?: string;
}

async function fetchTree(client: GitHubClient, repo: RepoRef, sha: string): Promise<TreeEntry[]> {
  const response = await client.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
    owner: repo.owner,
    repo: repo.name,
    tree_sha: sha,
  });
  return response.data.tree ?? [];
}

/**
 * Lists the files at the repository root and inside the directories rules care
 * about.
 *
 * Walking trees costs at most three requests regardless of how many candidate
 * locations the rules check, and subtrees are addressed by sha so no path needs
 * escaping into a URL.
 */
async function fetchExistingPaths(
  client: GitHubClient,
  repo: RepoRef,
  defaultBranch: string,
): Promise<Probe<readonly string[]>> {
  try {
    const root = await fetchTree(client, repo, defaultBranch);
    const paths = root.filter((entry) => entry.type === 'blob' && entry.path).map((e) => e.path!);

    for (const directory of PROBED_DIRECTORIES) {
      const entry = root.find((item) => item.path === directory && item.type === 'tree');
      if (entry?.sha === undefined) continue;

      try {
        const subtree = await fetchTree(client, repo, entry.sha);
        for (const item of subtree) {
          if (item.type === 'blob' && item.path) paths.push(`${directory}/${item.path}`);
        }
      } catch {
        // A directory we cannot read simply contributes no paths; the rules that
        // look inside it will report the file as absent, which is the same
        // conclusion a user browsing the repository would reach.
      }
    }

    return available(paths);
  } catch (error) {
    const status = httpStatus(error);

    if (status === 409) {
      // GitHub answers 409 for a repository with no commits.
      return available([]);
    }

    return unavailable(
      rateLimitHint(error) ??
        `Could not list the contents of ${formatRepoRef(repo)}: ${message(error)}. ` +
          `Grant the token contents:read to unlock the file-based checks.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Branch protection                                                          */
/* -------------------------------------------------------------------------- */

const PERMISSION_HINT =
  'Reading branch protection needs repository administration:read, which the default ' +
  'GITHUB_TOKEN does not have. Grant it, or supply a PAT or App token, to unlock this check.';

interface BranchRule {
  type?: string;
  ruleset_id?: number;
}

/** Names the rulesets behind a set of branch rules, best-effort. */
async function describeRulesets(
  client: GitHubClient,
  repo: RepoRef,
  rules: BranchRule[],
): Promise<string> {
  const types = [...new Set(rules.map((rule) => rule.type).filter(Boolean))].sort();
  const ids = [...new Set(rules.map((rule) => rule.ruleset_id).filter((id) => id !== undefined))];

  let names: string[] = [];
  try {
    const response = await client.request('GET /repos/{owner}/{repo}/rulesets', {
      owner: repo.owner,
      repo: repo.name,
      includes_parents: true,
    });
    const byId = new Map(response.data.map((ruleset) => [ruleset.id, ruleset.name]));
    names = ids.map((id) => byId.get(id)).filter((name): name is string => name !== undefined);
  } catch {
    // Naming a ruleset is a nicety; the rules covering the branch are the finding.
  }

  const subject =
    names.length > 0
      ? `ruleset${names.length > 1 ? 's' : ''} ${names.map((name) => `'${name}'`).join(', ')}`
      : `${rules.length} active ruleset rule${rules.length > 1 ? 's' : ''}`;

  return types.length > 0 ? `${subject} (${types.join(', ')})` : subject;
}

/** Summarises which legacy protections are switched on. */
function describeLegacyProtection(protection: Record<string, unknown>): string {
  const enabled: string[] = [];
  if (protection.required_pull_request_reviews) enabled.push('required reviews');
  if (protection.required_status_checks) enabled.push('required status checks');
  if ((protection.enforce_admins as { enabled?: boolean } | undefined)?.enabled) {
    enabled.push('enforced for admins');
  }
  if (protection.restrictions) enabled.push('push restrictions');

  return enabled.length > 0
    ? `branch protection rule (${enabled.join(', ')})`
    : 'a branch protection rule';
}

/**
 * Resolves protection from rulesets first, then the legacy endpoint
 * (ARCHITECTURE.md §Token permissions).
 *
 * The distinction that matters is "no protection" versus "we could not look".
 * Only the first is a `fail`; an unreadable endpoint is always `na`, even when we
 * already know no ruleset covers the branch, because a legacy rule we cannot see
 * would still be protecting it.
 */
async function fetchBranchProtection(
  client: GitHubClient,
  repo: RepoRef,
  branch: string,
): Promise<Probe<BranchProtection>> {
  let rulesetsReadable = false;

  try {
    const response = await client.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', {
      owner: repo.owner,
      repo: repo.name,
      branch,
    });

    rulesetsReadable = true;
    const rules = response.data as BranchRule[];

    if (rules.length > 0) {
      return available({
        protected: true,
        source: 'ruleset',
        description: await describeRulesets(client, repo, rules),
      });
    }
  } catch {
    // Fall through to the legacy endpoint.
  }

  try {
    const response = await client.request(
      'GET /repos/{owner}/{repo}/branches/{branch}/protection',
      {
        owner: repo.owner,
        repo: repo.name,
        branch,
      },
    );

    return available({
      protected: true,
      source: 'legacy',
      description: describeLegacyProtection(response.data as unknown as Record<string, unknown>),
    });
  } catch (error) {
    const status = httpStatus(error);

    // The legacy endpoint answers 404 with "Branch not protected", which is an
    // answer, not a failure — but only trust it once rulesets have been ruled out.
    if (isMissingEndpoint(status) && rulesetsReadable) {
      return available({
        protected: false,
        source: 'legacy',
        description: 'no ruleset or branch protection rule covers the branch',
      });
    }

    if (status === 401 || status === 403) {
      return unavailable(rateLimitHint(error) ?? PERMISSION_HINT);
    }

    if (isMissingEndpoint(status)) {
      return unavailable(
        `Neither branch rulesets nor branch protection could be read for '${branch}'. ` +
          `${PERMISSION_HINT} On GitHub Enterprise Server, this version may not expose either endpoint.`,
      );
    }

    return unavailable(
      `Could not read branch protection for '${branch}': ${message(error)}. ${PERMISSION_HINT}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Pull requests                                                              */
/* -------------------------------------------------------------------------- */

function toSummary(node: PullRequestNode): PullRequestSummary {
  const lastCommit = node.commits?.nodes?.find((entry) => entry?.commit?.committedDate);

  return {
    number: node.number,
    createdAt: node.createdAt,
    lastCommitAt: lastCommit?.commit.committedDate ?? null,
    isDraft: node.isDraft,
  };
}

function describeGraphqlFailure(repo: RepoRef, error: unknown): ProbeUnavailable {
  const status = httpStatus(error);

  const rateLimited = rateLimitHint(error);
  if (rateLimited !== undefined) {
    return unavailable(rateLimited);
  }

  if (status === 401 || status === 403) {
    return unavailable(
      `Not authorised to read pull requests for ${formatRepoRef(repo)}. ` +
        `Grant the token pull_requests:read to unlock the pull request checks.`,
    );
  }

  if (isMissingEndpoint(status)) {
    return unavailable(
      `The GraphQL API is not available at this endpoint, so pull request data could not be read. ` +
        `On GitHub Enterprise Server, check that GraphQL is enabled for this instance.`,
    );
  }

  return unavailable(`Could not read pull requests for ${formatRepoRef(repo)}: ${message(error)}.`);
}

/** Fetches open pull requests, drafts included; the rules decide what to ignore. */
async function fetchPullRequests(
  client: GitHubClient,
  repo: RepoRef,
): Promise<Probe<PullRequestData>> {
  const items: PullRequestSummary[] = [];
  let cursor: string | null = null;
  let truncated = false;

  try {
    for (let page = 0; page < MAX_PULL_REQUEST_PAGES; page += 1) {
      const data: PullRequestsPage = await client.graphql(PULL_REQUESTS_QUERY, {
        owner: repo.owner,
        name: repo.name,
        pageSize: PULL_REQUEST_PAGE_SIZE,
        cursor,
      });

      const connection = data.repository?.pullRequests;
      if (connection === undefined) {
        return unavailable(
          `The GraphQL API returned no repository for ${formatRepoRef(repo)}, so pull request ` +
            `data could not be read.`,
        );
      }

      for (const node of connection.nodes ?? []) {
        if (node !== null) items.push(toSummary(node));
      }

      if (!connection.pageInfo.hasNextPage) break;
      truncated = page === MAX_PULL_REQUEST_PAGES - 1;
      cursor = connection.pageInfo.endCursor;
    }

    return available({ items, truncated });
  } catch (error) {
    return describeGraphqlFailure(repo, error);
  }
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

export interface FetchContextOptions {
  /** Evaluation instant, threaded through so a fleet scan grades against one clock. */
  now?: Date;
}

/**
 * Gathers everything the rules need for one repository.
 *
 * @throws {RepoAccessError} when the repository itself cannot be read.
 */
export async function fetchRepoContext(
  client: GitHubClient,
  repo: RepoRef,
  options: FetchContextOptions = {},
): Promise<RepoContext> {
  const { defaultBranch } = await fetchMetadata(client, repo);

  const [existingPaths, branchProtection, pullRequests] = await Promise.all([
    fetchExistingPaths(client, repo, defaultBranch),
    fetchBranchProtection(client, repo, defaultBranch),
    fetchPullRequests(client, repo),
  ]);

  return {
    owner: repo.owner,
    repo: repo.name,
    defaultBranch,
    now: options.now ?? new Date(),
    existingPaths,
    branchProtection,
    pullRequests,
  };
}

/**
 * A `ConfigReader` backed by a repository, for reading `.fettle.yml` from the
 * branch being scanned.
 *
 * Returns `null` for anything that is not a readable file, so a missing config
 * means "use the defaults" rather than an error.
 */
export function createRepoFileReader(client: GitHubClient, repo: RepoRef, ref: string) {
  return async (path: string): Promise<string | null> => {
    try {
      const response = await client.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: repo.owner,
        repo: repo.name,
        path,
        ref,
      });

      const file = response.data;
      if (Array.isArray(file) || file.type !== 'file') return null;
      // Files above 1 MB come back with no inline content; a config that large is
      // not something we should try to interpret.
      if (typeof file.content !== 'string' || file.encoding !== 'base64') return null;

      return Buffer.from(file.content, 'base64').toString('utf8');
    } catch (error) {
      if (isMissingEndpoint(httpStatus(error))) return null;
      throw error;
    }
  };
}
