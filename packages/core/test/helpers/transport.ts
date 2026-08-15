/**
 * A `fetch` stand-in for testing against Octokit's real request pipeline.
 *
 * Mocking at the transport level rather than stubbing our own functions means the
 * tests exercise the URLs we actually build, the status codes Octokit turns into
 * errors, and the retry/throttle plugins as configured.
 */

import { createGitHubClient, type GitHubClient } from '../../src/github/client.js';

export interface RecordedCall {
  method: string;
  /** Path and query relative to the API base URL, e.g. `/repos/acme/demo`. */
  path: string;
  body: unknown;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = StubResponse | ((call: RecordedCall) => StubResponse);

/** Handlers keyed by `METHOD /path`, e.g. `GET /repos/acme/demo`. */
export type Handlers = Record<string, Handler>;

export interface Transport {
  client: GitHubClient;
  calls: RecordedCall[];
  /** Calls made to one route key, useful for asserting pagination. */
  callsTo(key: string): RecordedCall[];
}

const BASE_URL = 'https://api.github.test';

function toResponse({ status = 200, body, headers = {} }: StubResponse): Response {
  if (status === 204 || body === undefined) {
    return new Response(null, { status, headers });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/**
 * Builds a client whose transport answers from `handlers`.
 *
 * An unhandled route answers 404, which is what an unexpected request would look
 * like against a real repository that does not have the thing we asked for.
 */
export function createTransport(handlers: Handlers, options: { token?: string } = {}): Transport {
  const calls: RecordedCall[] = [];

  const fetchStub = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = `${url.pathname}${url.search}`;

    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    const call: RecordedCall = { method, path, body };
    calls.push(call);

    const handler = handlers[`${method} ${url.pathname}`];
    if (handler === undefined) {
      return toResponse({ status: 404, body: { message: 'Not Found' } });
    }

    return toResponse(typeof handler === 'function' ? handler(call) : handler);
  };

  const client = createGitHubClient({
    token: options.token ?? 'test-token',
    apiUrl: BASE_URL,
    env: {},
    // Retries would turn one stubbed 500 into several; each test asserts on a
    // single exchange.
    request: { fetch: fetchStub, retries: 0 },
    // The throttling plugin paces GraphQL at one request per second through a
    // process-wide limiter, which would serialise the whole suite.
    throttle: { enabled: false },
  });

  return {
    client,
    calls,
    callsTo: (key) => {
      const [method, path] = key.split(' ');
      return calls.filter((c) => c.method === method && c.path.split('?')[0] === path);
    },
  };
}
