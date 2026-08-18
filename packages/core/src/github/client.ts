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
 * Logs every request: method, path, status and duration.
 *
 * Wrapped outside the retry hook, so a retried request logs once per attempt. The
 * URL is logged, never the headers — that is where the token is.
 */
function withRequestLogging(octokit: Octokit, onDebug: (message: string) => void): void {
  octokit.hook.wrap('request', async (request, options) => {
    const started = Date.now();
    const label = `${options.method} ${options.url}`;
    try {
      const response = await request(options);
      onDebug(`${label} -> ${response.status} in ${Date.now() - started}ms`);
      return response;
    } catch (error) {
      onDebug(`${label} -> ${statusOf(error) ?? 'no response'} in ${Date.now() - started}ms`);
      throw error;
    }
  });
}
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

/** Where the API base URL came from, so errors can explain themselves. */
export type ApiUrlSource = 'api-url' | 'gh-host' | 'GITHUB_API_URL' | 'GH_HOST' | 'default';

export interface ApiUrlResolution {
  url: string;
  source: ApiUrlSource;
}

/** Strips a scheme, a trailing path and trailing slashes from a bare host. */
function normaliseHost(host: string): string {
  const withoutScheme = host.trim().replace(/^https?:\/\//, '');
  const [hostOnly] = withoutScheme.split('/');
  return hostOnly;
}

/**
 * Turns a hostname into an API base URL.
 *
 * github.com is the odd one out: its API lives on a separate host, while every
 * GitHub Enterprise Server instance serves the API from `/api/v3` on its own.
 */
export function apiUrlForHost(host: string): string {
  const hostname = normaliseHost(host);
  if (hostname === 'github.com' || hostname === 'api.github.com') return GITHUB_COM_API_URL;
  return `https://${hostname}/api/v3`;
}

function trimTrailingSlashes(value: string): string {
  // Scanned rather than matched with `/\/+$/`, which backtracks polynomially on a
  // value that is mostly slashes.
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

export interface ApiUrlInputs {
  /** A full API base URL, e.g. `https://ghe.example.com/api/v3`. */
  apiUrl?: string;
  /** A bare hostname, e.g. `ghe.example.com`. Mirrors `gh`'s `GH_HOST`. */
  host?: string;
}

/**
 * Resolves the API base URL, and reports which input decided it.
 *
 * Precedence, most explicit first: `--api-url`, `--gh-host`, `$GITHUB_API_URL`
 * (which Actions runners set on github.com and GHES alike), `$GH_HOST` (which the
 * `gh` CLI sets), then github.com.
 */
export function resolveApiUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
  inputs: ApiUrlInputs = {},
): ApiUrlResolution {
  const candidates: [ApiUrlSource, string | undefined, boolean][] = [
    ['api-url', inputs.apiUrl, false],
    ['gh-host', inputs.host, true],
    ['GITHUB_API_URL', env.GITHUB_API_URL, false],
    ['GH_HOST', env.GH_HOST, true],
  ];

  for (const [source, raw, isHost] of candidates) {
    const value = raw?.trim();
    if (!value) continue;
    return { url: trimTrailingSlashes(isHost ? apiUrlForHost(value) : value), source };
  }

  return { url: GITHUB_COM_API_URL, source: 'default' };
}

/** Convenience wrapper for callers that only want the URL. */
export function resolveApiBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
  override?: string,
): string {
  return resolveApiUrl(env, { apiUrl: override }).url;
}

export interface GitHubClientOptions {
  token?: string;
  /** Overrides `GITHUB_API_URL`; point this at `https://ghes.example.com/api/v3` for GHES. */
  apiUrl?: string;
  /** A bare hostname, as `gh` takes in `GH_HOST`. Lower precedence than `apiUrl`. */
  host?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Called with a line of diagnostic detail. Never receives the token. */
  onDebug?: (message: string) => void;
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
  const resolution = resolveApiUrl(options.env ?? process.env, {
    apiUrl: options.apiUrl,
    host: options.host,
  });

  options.onDebug?.(
    `api base url ${resolution.url} (from ${resolution.source})` +
      `; token ${options.token ? 'provided' : 'absent'}`,
  );

  const octokit = new Octokit({
    auth: options.token,
    baseUrl: resolution.url,
    userAgent: `${TOOL_NAME}/${TOOL_VERSION}`,
    request: options.request,
  });

  withRetries(
    octokit,
    options.request?.retries ?? MAX_RETRIES,
    options.request?.retryBackoffMs ?? backoffMs,
  );

  if (options.onDebug) withRequestLogging(octokit, options.onDebug);
  return octokit;
}
