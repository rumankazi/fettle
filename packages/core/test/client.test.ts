import { describe, expect, it } from 'vitest';
import {
  apiUrlForHost,
  backoffMs,
  createGitHubClient,
  GITHUB_COM_API_URL,
  resolveApiBaseUrl,
  resolveApiUrl,
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

describe('createGitHubClient', () => {
  it('builds a client without pacing requests through a limiter', async () => {
    // The throttling plugin used to sit between us and the API, spacing GraphQL a
    // second apart. Two consecutive requests should now cost only their round trip.
    const client = createGitHubClient({
      env: {},
      apiUrl: 'https://api.github.test',
      request: {
        fetch: async () =>
          new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      },
    });

    const started = Date.now();
    await client.request('GET /repos/{owner}/{repo}', { owner: 'a', repo: 'b' });
    await client.request('GET /repos/{owner}/{repo}', { owner: 'a', repo: 'b' });

    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('retrying transient failures', () => {
  function clientThatFails(statuses: (number | 'network')[]) {
    let call = 0;
    const attempts: string[] = [];

    const client = createGitHubClient({
      env: {},
      apiUrl: 'https://api.github.test',
      request: {
        retries: 3,
        // Real backoff is quadratic seconds; these tests are about which errors
        // are retried, not how long we wait for them.
        retryBackoffMs: () => 0,
        fetch: async () => {
          const outcome = statuses[call] ?? 200;
          attempts.push(String(outcome));
          call += 1;
          if (outcome === 'network') throw new Error('socket hang up');
          return new Response(outcome === 200 ? '{"ok":true}' : '{"message":"nope"}', {
            status: outcome as number,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    });

    return { client, attempts };
  }

  it('retries a server error and succeeds', async () => {
    const { client, attempts } = clientThatFails([500, 502, 200]);
    const response = await client.request('GET /repos/{owner}/{repo}', { owner: 'a', repo: 'b' });

    expect(response.status).toBe(200);
    expect(attempts).toEqual(['500', '502', '200']);
  });

  it('retries a transport failure, which has no status at all', async () => {
    const { client, attempts } = clientThatFails(['network', 200]);
    await client.request('GET /repos/{owner}/{repo}', { owner: 'a', repo: 'b' });
    expect(attempts).toEqual(['network', '200']);
  });

  it('does not retry a 404, because asking again will not change the answer', async () => {
    const { client, attempts } = clientThatFails([404, 200]);
    await expect(
      client.request('GET /repos/{owner}/{repo}', { owner: 'a', repo: 'b' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(attempts).toEqual(['404']);
  });

  it('does not retry a rate-limited 403 — the fetch layer reports it instead', async () => {
    const { client, attempts } = clientThatFails([403, 200]);
    await expect(
      client.request('GET /repos/{owner}/{repo}', { owner: 'a', repo: 'b' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(attempts).toEqual(['403']);
  });

  it('gives up rather than retrying forever', async () => {
    const { client, attempts } = clientThatFails([500, 500, 500, 500, 500, 500]);
    await expect(
      client.request('GET /repos/{owner}/{repo}', { owner: 'a', repo: 'b' }),
    ).rejects.toMatchObject({ status: 500 });
    expect(attempts).toHaveLength(4); // the first try plus three retries
  });

  it('backs off further each time, up to a ceiling', () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(4000);
    expect(backoffMs(2)).toBe(8000);
    expect(backoffMs(9)).toBe(8000);
  });
});

describe('apiUrlForHost', () => {
  it('sends github.com to its separate API host', () => {
    expect(apiUrlForHost('github.com')).toBe(GITHUB_COM_API_URL);
    expect(apiUrlForHost('api.github.com')).toBe(GITHUB_COM_API_URL);
  });

  it('serves Enterprise Server its API from /api/v3 on the instance itself', () => {
    expect(apiUrlForHost('ghe.example.com')).toBe('https://ghe.example.com/api/v3');
  });

  it('accepts what a user is likely to paste, not just a bare hostname', () => {
    expect(apiUrlForHost('https://ghe.example.com')).toBe('https://ghe.example.com/api/v3');
    expect(apiUrlForHost('https://ghe.example.com/')).toBe('https://ghe.example.com/api/v3');
    expect(apiUrlForHost('  ghe.example.com  ')).toBe('https://ghe.example.com/api/v3');
  });
});

describe('resolveApiUrl', () => {
  it('reports where the URL came from, so an error can explain itself', () => {
    expect(resolveApiUrl({}, {})).toEqual({ url: GITHUB_COM_API_URL, source: 'default' });
    expect(resolveApiUrl({}, { host: 'ghe.example.com' })).toEqual({
      url: 'https://ghe.example.com/api/v3',
      source: 'gh-host',
    });
    expect(resolveApiUrl({ GH_HOST: 'ghe.example.com' }, {})).toEqual({
      url: 'https://ghe.example.com/api/v3',
      source: 'GH_HOST',
    });
  });

  it('prefers the more explicit input at every step', () => {
    const env = { GITHUB_API_URL: 'https://from-env/api/v3', GH_HOST: 'from-env-host' };

    expect(resolveApiUrl(env, { apiUrl: 'https://flag/api/v3', host: 'flag-host' }).source).toBe(
      'api-url',
    );
    expect(resolveApiUrl(env, { host: 'flag-host' }).source).toBe('gh-host');
    expect(resolveApiUrl(env, {}).source).toBe('GITHUB_API_URL');
    expect(resolveApiUrl({ GH_HOST: 'from-env-host' }, {}).source).toBe('GH_HOST');
  });

  it('skips blank inputs rather than resolving to an unusable URL', () => {
    expect(resolveApiUrl({ GH_HOST: '  ' }, { apiUrl: '', host: '   ' }).source).toBe('default');
  });

  it('trims trailing slashes, which Octokit would otherwise double up', () => {
    expect(resolveApiUrl({}, { apiUrl: 'https://ghe.example.com/api/v3///' }).url).toBe(
      'https://ghe.example.com/api/v3',
    );
  });
});
