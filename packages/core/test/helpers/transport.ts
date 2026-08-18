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

/**
 * Handlers keyed by `METHOD /path`, e.g. `GET /repos/acme/demo`.
 *
 * Every GraphQL request goes to the same path, so a GraphQL key may name the
 * operation as well — `POST /graphql FettleOpenIssues`. That key is tried first
 * and a bare `POST /graphql` is the fallback, so a test that does not care which
 * query it is answering need not say.
 */
export type Handlers = Record<string, Handler>;

/**
 * Reads the operation name out of a GraphQL request body.
 *
 * The queries all declare one, and matching on it is what lets two different
 * queries to `/graphql` be stubbed independently.
 */
function graphqlOperation(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;

  const { query } = body as { query?: unknown };
  if (typeof query !== 'string') return undefined;

  return /\bquery\s+(\w+)/.exec(query)?.[1];
}

export interface Transport {
  client: GitHubClient;
  calls: RecordedCall[];
  /**
   * Calls made to one route key, useful for asserting pagination. Accepts the
   * same operation-qualified keys as {@link Handlers}.
   */
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

    const operation = graphqlOperation(body);
    const handler =
      (operation === undefined ? undefined : handlers[`${method} ${url.pathname} ${operation}`]) ??
      handlers[`${method} ${url.pathname}`];

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
  });

  return {
    client,
    calls,
    callsTo: (key) => {
      const [method, path, operation] = key.split(' ');
      return calls.filter(
        (c) =>
          c.method === method &&
          c.path.split('?')[0] === path &&
          (operation === undefined || graphqlOperation(c.body) === operation),
      );
    },
  };
}
