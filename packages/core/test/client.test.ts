import { describe, expect, it } from 'vitest';
import {
  GITHUB_COM_API_URL,
  resolveApiBaseUrl,
  shouldRetryRateLimit,
} from '../src/github/client.js';

describe('resolveApiBaseUrl', () => {
  it('defaults to github.com when nothing is configured', () => {
    expect(resolveApiBaseUrl({})).toBe(GITHUB_COM_API_URL);
  });

  it('uses GITHUB_API_URL, which Actions runners set on github.com and GHES alike', () => {
    expect(resolveApiBaseUrl({ GITHUB_API_URL: 'https://ghes.example.com/api/v3' })).toBe(
      'https://ghes.example.com/api/v3',
    );
  });

  it('lets an explicit override win over the environment', () => {
    expect(
      resolveApiBaseUrl(
        { GITHUB_API_URL: 'https://ghes.example.com/api/v3' },
        'https://other/api/v3',
      ),
    ).toBe('https://other/api/v3');
  });

  it('ignores blank values rather than producing an unusable base URL', () => {
    expect(resolveApiBaseUrl({ GITHUB_API_URL: '   ' })).toBe(GITHUB_COM_API_URL);
    expect(resolveApiBaseUrl({ GITHUB_API_URL: 'https://ghes.example.com/api/v3' }, '  ')).toBe(
      'https://ghes.example.com/api/v3',
    );
  });

  it('strips trailing slashes so path joining stays predictable', () => {
    expect(resolveApiBaseUrl({}, 'https://ghes.example.com/api/v3/')).toBe(
      'https://ghes.example.com/api/v3',
    );
  });
});

describe('shouldRetryRateLimit', () => {
  it('waits out a short backoff', () => {
    expect(shouldRetryRateLimit(1, 0)).toBe(true);
    expect(shouldRetryRateLimit(60, 0)).toBe(true);
  });

  it('gives up rather than sleeping through a long one', () => {
    // An exhausted primary rate limit resets on the hour. Accepting Octokit's
    // offer to retry would park a CI job for that whole time with no output.
    expect(shouldRetryRateLimit(61, 0)).toBe(false);
    expect(shouldRetryRateLimit(3600, 0)).toBe(false);
  });

  it('stops after a couple of attempts', () => {
    expect(shouldRetryRateLimit(1, 1)).toBe(true);
    expect(shouldRetryRateLimit(1, 2)).toBe(false);
  });
});
