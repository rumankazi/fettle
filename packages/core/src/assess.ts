/**
 * The library's front door: fetch, configure, score.
 *
 * Everything below composes pieces that are independently tested — the fetcher,
 * the config pipeline, the rule registry, the report builder — so this file stays
 * thin enough to read in one sitting.
 */

import { ConfigError, loadConfig, resolveConfig } from './config.js';
import { createGitHubClient, type GitHubClient } from './github/client.js';
import {
  createRepoFileReader,
  fetchRepoContext,
  formatRepoRef,
  parseRepoRef,
} from './github/context.js';
import { buildHealthReport, type RepoAssessment } from './report.js';
import { evaluateRules } from './rules/rule.js';
import type { ConfigInput, HealthReport } from './types.js';

/**
 * How many repositories to scan at once.
 *
 * Each repository costs roughly ten requests, so an unbounded fleet scan would
 * queue hundreds of them at once and spend its time being throttled.
 */
const DEFAULT_CONCURRENCY = 4;

export interface AssessOptions {
  /** Defaults to `$GITHUB_TOKEN`. */
  token?: string;
  /** GitHub Enterprise Server API base URL; defaults to `$GITHUB_API_URL`, then github.com. */
  apiUrl?: string;
  /** A bare hostname, as `gh` takes in `GH_HOST`. Lower precedence than `apiUrl`. */
  host?: string;
  /** Called with a line of diagnostic detail. Never receives the token. */
  onDebug?: (message: string) => void;
  /** Supply a pre-built client to control retries, transport or authentication. */
  client?: GitHubClient;
  /**
   * Configuration to apply to every repository, instead of reading
   * `.fettle.yml` from each one. Useful for scanning a fleet under one policy.
   */
  config?: ConfigInput;
  /** Where to look for per-repository configuration. Defaults to `.fettle.yml`. */
  configPath?: string;
  /** Evaluation instant, so a whole fleet is graded against one clock. */
  now?: Date;
  /** Called for each non-fatal configuration problem. */
  onWarning?: (repo: string, warning: string) => void;
  maxConcurrency?: number;
}

/** Runs `worker` over `items`, keeping at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

function resolveClient(options: AssessOptions): GitHubClient {
  return (
    options.client ??
    createGitHubClient({
      token: options.token ?? process.env.GITHUB_TOKEN,
      apiUrl: options.apiUrl,
      host: options.host,
      onDebug: options.onDebug,
    })
  );
}

/**
 * Scans one repository, named `org/name`, and returns its rule results.
 *
 * @throws {RepoAccessError} when the repository cannot be read at all.
 * @throws {ConfigError} when its `.fettle.yml` is invalid.
 */
export async function assessRepo(
  repo: string,
  options: AssessOptions = {},
): Promise<RepoAssessment> {
  const ref = parseRepoRef(repo);
  const name = formatRepoRef(ref);
  const client = resolveClient(options);

  const context = await fetchRepoContext(client, ref, { now: options.now });

  const { config, warnings } = await loadRepoConfig(client, ref, context.defaultBranch, options);
  for (const warning of warnings) {
    options.onWarning?.(name, warning);
  }

  return {
    repo: name,
    defaultBranch: context.defaultBranch,
    rules: evaluateRules(context, config.rules),
  };
}

async function loadRepoConfig(
  client: GitHubClient,
  ref: ReturnType<typeof parseRepoRef>,
  defaultBranch: string,
  options: AssessOptions,
) {
  const name = formatRepoRef(ref);

  try {
    // An explicitly supplied config replaces the per-repository file rather than
    // merging with it, so one policy means one policy.
    return options.config !== undefined
      ? resolveConfig(options.config)
      : await loadConfig(createRepoFileReader(client, ref, defaultBranch), options.configPath);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new ConfigError(`${name}: ${error.message}`, error.path);
    }
    throw error;
  }
}

/**
 * Scans one or more repositories and assembles the report.
 *
 * @throws {RepoAccessError} when a repository cannot be read at all.
 * @throws {ConfigError} when a `.fettle.yml` is invalid.
 */
export async function assess(
  repos: readonly string[],
  options: AssessOptions = {},
): Promise<HealthReport> {
  const now = options.now ?? new Date();
  // Share one client so retry and throttling state is shared across the fleet.
  const client = resolveClient(options);
  const scanOptions: AssessOptions = { ...options, client, now };

  const assessments = await mapWithConcurrency(
    repos,
    options.maxConcurrency ?? DEFAULT_CONCURRENCY,
    (repo) => assessRepo(repo, scanOptions),
  );

  return buildHealthReport(assessments, now);
}
