/**
 * Octokit factory.
 *
 * Nothing here may assume github.com: the same code must work against GitHub
 * Enterprise Server, where both the REST and GraphQL endpoints hang off the
 * instance's own host (ARCHITECTURE.md §GHES).
 */

import { Octokit } from '@octokit/core';
import { TOOL_NAME, TOOL_VERSION } from '../branding.js';

export const GITHUB_COM_API_URL = 'https://api.github.com';

/** Attempts after the first, for errors worth trying again. */
const MAX_RETRIES = 3;

/** Longest a single backoff will wait. */
const MAX_BACKOFF_MS = 8_000;

/**
 * Typed as the base `Octokit`: the retry hook adds behaviour, not API surface.
 */
export type GitHubClient = Octokit;

/**
 * Whether an error is worth trying again.
 *
 * A missing status is a transport failure — DNS, a dropped connection — and a 5xx
 * is the server saying it went wrong at its end. Everything else is an answer, and
 * repeating the question will not change it. In particular a rate-limited 403 is
 * *not* retried: the fetch layer turns it into an `na` carrying the reset time,
 * which is more use than a job that sleeps for an hour.
 */
function isWorthRetrying(status: number | undefined): boolean {
  return status === undefined || status >= 500;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const { status } = error as { status: unknown };
  return typeof status === 'number' ? status : undefined;
}

/** Quadratic backoff, matching what Octokit's retry plugin used to do. */
export function backoffMs(attempt: number): number {
  return Math.min((attempt + 1) ** 2 * 1000, MAX_BACKOFF_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries transient failures.
 *
 * This replaces `@octokit/plugin-retry`, whose substance is about fifteen lines but
 * which pulls in `bottleneck` — last published in 2019, and using `eval` — as a
 * scheduler, into a bundle every Action consumer downloads. The dependency budget
 * in CONTRIBUTING.md asks exactly this question, and the answer here is the loop
 * below.
 */
function withRetries(
  octokit: Octokit,
  retries: number,
  backoff: (attempt: number) => number,
): void {
  octokit.hook.wrap('request', async (request, options) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request(options);
      } catch (error) {
        if (attempt >= retries || !isWorthRetrying(statusOf(error))) throw error;
        await sleep(backoff(attempt));
      }
    }
  });
}

/**
 * Resolves the API base URL.
 *
 * Precedence: explicit override (CLI `--api-url` / Action input), then
 * `GITHUB_API_URL` which Actions runners set on github.com and GHES alike, then
 * github.com.
 */
export function resolveApiBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
  override?: string,
): string {
  const candidate = override?.trim() || env.GITHUB_API_URL?.trim() || GITHUB_COM_API_URL;

  // Trimmed by scanning rather than with `/\/+$/`, which backtracks polynomially
  // on a value that is mostly slashes.
  let end = candidate.length;
  while (end > 0 && candidate[end - 1] === '/') end -= 1;
  return candidate.slice(0, end);
}

export interface GitHubClientOptions {
  token?: string;
  /** Overrides `GITHUB_API_URL`; point this at `https://ghes.example.com/api/v3` for GHES. */
  apiUrl?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Passed through to Octokit's request layer. The `fetch` hook is the seam tests
   * use to answer requests without a network.
   */
  request?: {
    fetch?: typeof globalThis.fetch;
    retries?: number;
    /** Backoff before attempt N, in milliseconds. Defaults to quadratic. */
    retryBackoffMs?: (attempt: number) => number;
  };
}

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const octokit = new Octokit({
    auth: options.token,
    baseUrl: resolveApiBaseUrl(options.env ?? process.env, options.apiUrl),
    userAgent: `${TOOL_NAME}/${TOOL_VERSION}`,
    request: options.request,
  });

  withRetries(
    octokit,
    options.request?.retries ?? MAX_RETRIES,
    options.request?.retryBackoffMs ?? backoffMs,
  );
  return octokit;
}
