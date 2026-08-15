import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from '../src/github/client.js';

describe('GitHub API base URL resolution', () => {
  it('uses the env override when provided', () => {
    expect(resolveApiBaseUrl({ GITHUB_API_URL: 'https://ghe.example.com/api/v3' })).toBe(
      'https://ghe.example.com/api/v3',
    );
  });

  it('falls back to github.com when env is unset', () => {
    expect(resolveApiBaseUrl({})).toBe('https://api.github.com');
  });

  it('prefers the explicit CLI override over the environment', () => {
    expect(
      resolveApiBaseUrl(
        { GITHUB_API_URL: 'https://ghe.example.com/api/v3' },
        'https://cli.example.com/api/v3',
      ),
    ).toBe('https://cli.example.com/api/v3');
  });
});
