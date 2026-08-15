# SPEC.md — Product Specification

## One-liner

Drop one GitHub Action into a workflow (or run one CLI command) and get an
explainable maintenance-health grade for a repo or a list of repos, with zero
required configuration.

## Problem

Teams that own many repositories cannot answer "which of our repos are rotting?"
Existing tools miss this niche: OSSF Scorecard is security-supply-chain focused,
noisy on internal repos, and heavyweight; Reposaur requires writing Rego policies;
repolinter only checks file presence; hosted platforms require sending data out.
Nothing gives a simple, configurable, self-hosted maintenance grade.

## Positioning (drives every design decision)

- **Maintenance health, not security posture.** We do not overlap Scorecard; the
  README will carry an explicit "vs Scorecard" comparison table.
- **Plug and play.** Works with the default `GITHUB_TOKEN` where permissions allow;
  degrades gracefully with instructions where they don't. Sensible defaults; a
  `.fettle.yml` only for teams that want to tune.
- **Runs in the user's own infrastructure.** github.com and GHES. No hosted service,
  no data leaves the user's environment.
- **Explainable.** Five rules, additive weighted scoring, every result carries
  evidence. A team lead must be able to recompute their grade by hand.

## v1 rule set (exactly these five — see SCORING.md for math)

| id                   | type      | question it answers                                                             |
| -------------------- | --------- | ------------------------------------------------------------------------------- |
| `branch_protection`  | boolean   | Does the default branch have a protection rule or ruleset?                      |
| `codeowners`         | boolean   | Does a CODEOWNERS file exist in a standard location?                            |
| `dependency_updates` | boolean   | Is Dependabot or Renovate configured?                                           |
| `open_pr_count`      | threshold | Are open PRs piling up beyond a threshold?                                      |
| `stale_prs`          | threshold | How many PRs are open > `open_days` AND last commit older than `inactive_days`? |

Deliberate exclusions (do not add these in v1): merge cadence / time-to-merge
(repo-dependent, statistically noisy), CI check status (repo-dependent),
issue metrics, commit frequency, contributor counts. The rule engine must make
adding future rules (e.g. key-CI-freshness, deployment recency) easy — but v1
ships exactly five.

## Deliverables

1. **GitHub Action** (`packages/action`) — Marketplace-publishable, bundled dist,
   scheduled or on-demand, single repo or repo list.
2. **CLI** (`packages/cli`) — `npx`-runnable, same rules and config, `--format
json|markdown|badge`, exit code reflects grade floor (configurable) for CI gating.
3. **Library** (`packages/core`) — typed `assess()` for Node dashboards/backends.
4. **Report outputs**: versioned JSON (`HealthReport`), markdown summary (written to
   `GITHUB_STEP_SUMMARY` in Action mode), shields.io endpoint JSON per repo,
   optional POST of the JSON report to a user-supplied `report_url`.

## Users and primary flows

- **Repo owner**: adds the Action on a weekly cron → grade badge in README, summary
  in the workflow run.
- **Platform/DevOps team**: one central workflow scans a repo list → publishes
  `report.json` artifact → internal dashboard pulls it (or receives the webhook
  POST).
- **Dashboard developer**: imports `core` or shells out to the CLI with `--format
json`.

## Success criteria for v1 — met

- Empty repo → working Action run in under 5 minutes following only the README.
- Default-config scan of a typical active repo completes in < 10 s and ≤ ~10 API
  requests per repo. **Measured at 7 requests** (1 metadata, 3 tree, 2 protection,
  1 GraphQL) and pinned by a test. A repository with more than 500 open pull
  requests costs up to four extra GraphQL pages and reports its counts as a lower
  bound.
- All five rules produce correct pass/fail/na with evidence on: a fully configured
  repo, a bare repo, and a repo scanned with a default token lacking admin read.
  **Covered by the rule tests, and by the §7 worked example run end to end through
  the fetch layer.**
- Report JSON validates against the published schema; schema documented in README.
  **Pinned by `schema.test.ts`.**

## Post-v1 backlog

Deliberately not built for v1, and each still a product decision rather than a
scheduled task: a key-CI-freshness rule, a deployment-recency rule, org-wide
repository discovery, a trend-diffing helper, GitLab support, and plus/minus grades.

Note the cost of the first two: a rule that is **enabled by default changes the
grade of repositories that did not change**, so it is a breaking change and needs a
major release. Ship a new rule disabled by default, or batch several into one major.

## Non-goals for v1

Hosted API/SaaS, historical trend storage (consumers can diff their own artifacts),
auto-remediation (complementary tools like stale-branch cleaners exist), GitLab/
Bitbucket support, org-wide auto-discovery of repos (explicit repo list only).
