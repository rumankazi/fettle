/**
 * The single GraphQL query in the product.
 *
 * REST would need one request per pull request to reach its last commit date, so
 * a repository with 60 open PRs would cost 60 requests. GraphQL answers both
 * threshold rules in one round trip per page (ARCHITECTURE.md §API strategy).
 */

/** GitHub caps connection pages at 100 nodes. */
export const PULL_REQUEST_PAGE_SIZE = 100;

export const PULL_REQUESTS_QUERY = `
  query FettlePullRequests($owner: String!, $name: String!, $pageSize: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: $pageSize, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          number
          createdAt
          isDraft
          commits(last: 1) {
            nodes {
              commit {
                committedDate
              }
            }
          }
        }
      }
    }
  }
`;

export interface PullRequestNode {
  number: number;
  createdAt: string;
  isDraft: boolean;
  commits: { nodes: ({ commit: { committedDate: string } } | null)[] | null } | null;
}

export interface PullRequestsPage {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: (PullRequestNode | null)[] | null;
    };
  } | null;
}
