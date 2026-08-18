/**
 * The GraphQL queries in the product.
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

/**
 * How many open issues to look at when hunting for Renovate's dependency
 * dashboard.
 *
 * Deliberately a single page with no pagination. Renovate rewrites the dashboard
 * body on every run, so on any repository where it is actually working the issue
 * sits at or near the top of `UPDATED_AT DESC`. Walking further would cost a
 * request per page on every repository to change the answer on approximately
 * none.
 *
 * REST's issue list would have been simpler, but it returns pull requests as
 * issues, so a repository with 100 busy pull requests could bury the dashboard.
 * The GraphQL connection returns issues only.
 */
export const OPEN_ISSUE_PAGE_SIZE = 100;

export const OPEN_ISSUES_QUERY = `
  query FettleOpenIssues($owner: String!, $name: String!, $pageSize: Int!) {
    repository(owner: $owner, name: $name) {
      issues(states: OPEN, first: $pageSize, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        nodes {
          number
          title
          url
          author {
            __typename
            login
          }
        }
      }
    }
  }
`;

export interface IssueNode {
  number: number;
  title: string;
  url: string;
  /** Null when the author's account has since been deleted. */
  author: { __typename: string; login: string } | null;
}

export interface OpenIssuesPage {
  repository: {
    issues: {
      totalCount: number;
      nodes: (IssueNode | null)[] | null;
    };
  } | null;
}
