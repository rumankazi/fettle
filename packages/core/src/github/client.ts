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
}

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  return new FettleOctokit({
    auth: options.token,
    baseUrl: resolveApiBaseUrl(options.env ?? process.env, options.apiUrl),
    userAgent: `${TOOL_NAME}/${TOOL_VERSION}`,
    throttle: {
      onRateLimit: (_retryAfter, requestOptions) =>
        (requestOptions.request?.retryCount ?? 0) < MAX_RATE_LIMIT_RETRIES,
      onSecondaryRateLimit: (_retryAfter, requestOptions) =>
        (requestOptions.request?.retryCount ?? 0) < MAX_RATE_LIMIT_RETRIES,
    },
  });
}
