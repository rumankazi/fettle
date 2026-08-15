import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';

export type GitHubEnv = Record<string, string | undefined>;

export function resolveApiBaseUrl(env: GitHubEnv = process.env, cliOverride?: string): string {
  const candidate = cliOverride ?? env.GITHUB_API_URL ?? 'https://api.github.com';
  return candidate.trim() || 'https://api.github.com';
}

export function createGitHubClient(
  options: {
    token?: string;
    apiUrl?: string;
    userAgent?: string;
  } = {},
): InstanceType<typeof Octokit> {
  const OctokitWithPlugins = Octokit.plugin(retry, throttling);
  const baseUrl = resolveApiBaseUrl(process.env, options.apiUrl);

  return new OctokitWithPlugins({
    auth: options.token,
    baseUrl,
    userAgent: options.userAgent ?? 'fettle',
    request: {
      retries: 3,
    },
    throttle: {
      onRateLimit: (
        _retryAfter: number,
        options: { request: { retryCount: number } },
        _octokit: unknown,
      ) => {
        return options.request.retryCount < 2;
      },
      onSecondaryRateLimit: (
        _retryAfter: number,
        options: { request: { retryCount: number } },
        _octokit: unknown,
      ) => {
        return options.request.retryCount < 2;
      },
    },
  });
}
