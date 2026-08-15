/**
 * Octokit factory.
 *
 * Nothing here may assume github.com: the same code must work against GitHub
 * Enterprise Server, where both the REST and GraphQL endpoints hang off the
 * instance's own host (ARCHITECTURE.md §GHES).
 */

import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { TOOL_NAME, TOOL_VERSION } from '../branding.js';

export const GITHUB_COM_API_URL = 'https://api.github.com';

/** How often we retry a request the API asked us to back off from. */
const MAX_RATE_LIMIT_RETRIES = 2;

/**
 * Longest we will sit waiting for a rate limit to clear.
 *
 * Octokit's throttling plugin will happily sleep for whatever `retry-after` says,
 * and an exhausted *primary* rate limit resets on the hour — so accepting every
 * retry turns a scan into an hour-long hang with no output. A secondary limit
 * clears in seconds, which is worth waiting for; anything longer should fail fast
 * and tell the user to authenticate or come back later.
 */
const MAX_RATE_LIMIT_WAIT_SECONDS = 60;

/**
 * Whether to wait out a rate limit and try again.
 *
 * @param retryAfterSeconds how long GitHub asked us to wait
 * @param retryCount        attempts already made for this request
 */
export function shouldRetryRateLimit(retryAfterSeconds: number, retryCount: number): boolean {
  return retryAfterSeconds <= MAX_RATE_LIMIT_WAIT_SECONDS && retryCount < MAX_RATE_LIMIT_RETRIES;
}

const FettleOctokit = Octokit.plugin(retry, throttling);

/**
 * Typed as the base `Octokit`: retry and throttling add behaviour, not API surface,
 * and naming the composed type would leak a transitive package path into our
 * published declarations.
 */
export type GitHubClient = Octokit;

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
  return candidate.replace(/\/+$/, '');
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
  request?: { fetch?: typeof globalThis.fetch; retries?: number };
  /**
   * Secondary-rate-limit pacing, on by default.
   *
   * Worth knowing before turning it off or scanning a large fleet: the throttling
   * plugin paces every GraphQL request — including read-only queries like ours —
   * at one per second, in a limiter shared by every client in the process. Since
   * each repository costs exactly one paginated GraphQL query, a fleet scan
   * settles at roughly one repository per second no matter how many run
   * concurrently. Disable this only if you are pacing requests yourself.
   */
  throttle?: { enabled?: boolean; id?: string };
}

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  return new FettleOctokit({
    auth: options.token,
    baseUrl: resolveApiBaseUrl(options.env ?? process.env, options.apiUrl),
    userAgent: `${TOOL_NAME}/${TOOL_VERSION}`,
    request: options.request,
    throttle: {
      enabled: options.throttle?.enabled ?? true,
      id: options.throttle?.id,
      onRateLimit: (retryAfter, requestOptions) =>
        shouldRetryRateLimit(retryAfter, requestOptions.request?.retryCount ?? 0),
      onSecondaryRateLimit: (retryAfter, requestOptions) =>
        shouldRetryRateLimit(retryAfter, requestOptions.request?.retryCount ?? 0),
    },
  });
}
