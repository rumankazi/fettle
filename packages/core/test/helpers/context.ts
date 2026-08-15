import { available } from '../../src/probe.js';
import type { PullRequestSummary, RepoContext } from '../../src/types.js';

/** Fixed evaluation instant so date-sensitive assertions never drift. */
export const NOW = new Date('2026-08-15T12:00:00.000Z');

export function daysAgo(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Wraps a list of pull requests in the shape the context carries. */
export function pullRequests(items: PullRequestSummary[], truncated = false) {
  return available({ items, truncated });
}

export function pullRequest(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 1,
    createdAt: daysAgo(1),
    lastCommitAt: daysAgo(1),
    isDraft: false,
    ...overrides,
  };
}

/** A context where every probe succeeded and every check would pass. */
export function repoContext(overrides: Partial<RepoContext> = {}): RepoContext {
  return {
    owner: 'acme',
    repo: 'demo',
    defaultBranch: 'main',
    now: NOW,
    existingPaths: available(['.github/CODEOWNERS', '.github/dependabot.yml']),
    branchProtection: available({
      protected: true,
      source: 'ruleset',
      description: "ruleset 'main-protection'",
    }),
    pullRequests: available({ items: [], truncated: false }),
    ...overrides,
  };
}
