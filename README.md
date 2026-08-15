# Fettle

Grade the maintenance health of your GitHub repositories — five explainable rules,
weighted scoring, a letter grade, and evidence for every result.

> **Status: pre-release (v0.1.0).** The CLI and the library scan live repositories
> on github.com and GitHub Enterprise Server. The GitHub Action wrapper is not built
> yet. See [Roadmap](#roadmap).

## What it measures

| Rule                 | Type      | Question                                                                      | Default weight |
| -------------------- | --------- | ----------------------------------------------------------------------------- | -------------- |
| `branch_protection`  | boolean   | Does the default branch have a protection rule or ruleset?                    | 3              |
| `codeowners`         | boolean   | Does a CODEOWNERS file exist in a standard location?                          | 1              |
| `dependency_updates` | boolean   | Is Dependabot or Renovate configured?                                         | 2              |
| `open_pr_count`      | threshold | Are open PRs piling up?                                                       | 1              |
| `stale_prs`          | threshold | How many PRs are open past `open_days` with no commit inside `inactive_days`? | 2              |

Scoring is a weighted average, and a check we could not run scores nothing at all —
it leaves both sides of the average, so a narrow token never costs you points. The
full math is in [SCORING.md](SCORING.md), which is normative.

## Quick start: the CLI

```bash
export GITHUB_TOKEN=...            # a PAT, or ${{ github.token }} in Actions
npx @fettle/cli --repos vitest-dev/vitest --format markdown
```

```
## vitest-dev/vitest

**Grade F** — score 55.6 (default branch `main`)

| Rule | Status | Score | Weight | Evidence |
| --- | --- | ---: | ---: | --- |
| `branch_protection` | pass | 100 | 3 | Default branch 'main' is protected: ruleset 'Protect releases' (…). |
| `codeowners` | fail | 0 | 1 | No CODEOWNERS file at any of .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS. … |
| `dependency_updates` | pass | 100 | 2 | Dependency update config found at .github/renovate.json5. |
| `open_pr_count` | fail | 0 | 1 | 44 open non-draft pull request(s); 10 or fewer scores 100, 30 or more scores 0. |
| `stale_prs` | fail | 0 | 2 | 26 pull request(s) open more than 21 day(s) with no commit in the last 7 day(s); … |
```

Scan several at once, gate a build on the result, and point at a GHES instance:

```bash
fettle --repos acme/api,acme/web --format json > report.json
fettle --repos acme/api --fail-below C            # exit 1 if it grades below C
fettle --repos acme/api --api-url https://ghe.acme.com/api/v3
fettle --repos acme/api,acme/web --config policy.yml   # one policy for the fleet
```

Exit codes: `0` success, `1` a repository graded below `--fail-below`, `2` invalid
usage, `3` a repository or its configuration could not be read.

## Usage: the library

```bash
pnpm add @fettle/core
```

```ts
import { assess, renderMarkdown } from '@fettle/core';

const report = await assess(['acme/api', 'acme/web'], { token: process.env.GITHUB_TOKEN });

console.log(report.fleet.averageScore);
console.log(renderMarkdown(report));
```

`assess` fetches, configures and scores. If you already have the data — or want to
score without a network — `assessContext` takes a `RepoContext` directly. Every
field on it is a `Probe`: either `{ available: true, value }` or `{ available:
false, reason }`, where `reason` becomes the evidence the user reads. A rule cannot
look at a value without deciding what to do when it is missing.

## Configuration

Drop a `.repohealth.yml` on the default branch of any repository you scan. Every
field is optional; these are the defaults:

```yaml
version: 1
rules:
  branch_protection:
    enabled: true
    weight: 3
  codeowners:
    enabled: true
    weight: 1
  dependency_updates:
    enabled: true
    weight: 2
  open_pr_count:
    enabled: true
    weight: 1
    good_at: 10 # ≤ 10 open PRs → 100
    bad_at: 30 # ≥ 30 open PRs → 0
  stale_prs:
    enabled: true
    weight: 2
    good_at: 1 # ≤ 1 stale PR tolerated → 100
    bad_at: 5 # ≥ 5 stale PRs → 0
    open_days: 21 # a PR older than this is a staleness candidate…
    inactive_days: 7 # …and stale if its last commit is older than this
```

Unknown keys and unknown rule ids are warnings, so a config written for a newer
version still loads. Type errors and impossible thresholds are hard failures that
name the offending path.

`enabled: false` excludes a rule from the score exactly like an unrunnable one, but
reports as `disabled` so the distinction stays visible.

## Report schema

`schemaVersion: 1` is the public contract — see [SCORING.md §6](SCORING.md). After
v1, changes are additive only.

```jsonc
{
  "schemaVersion": 1,
  "tool": { "name": "fettle", "version": "0.1.0" },
  "generatedAt": "2026-08-15T09:30:00.000Z",
  "repos": [
    {
      "repo": "acme/demo",
      "defaultBranch": "main",
      "score": 55,
      "grade": "F",
      "rules": [
        {
          "id": "branch_protection",
          "status": "na", // pass | fail | na | disabled
          "score": null, // null when na or disabled
          "weight": 3,
          "evidence": "token lacks administration:read; grant it to unlock this check",
          "details": { "source": "ruleset" },
        },
      ],
    },
  ],
  "fleet": { "repoCount": 1, "averageScore": 55, "grades": { "F": 1 } },
}
```

Grades: **A** ≥ 90, **B** ≥ 80, **C** ≥ 70, **D** ≥ 60, **F** below. Boundaries take
the higher grade.

## Token permissions

| Check                               | Needs                                                    |
| ----------------------------------- | -------------------------------------------------------- |
| CODEOWNERS, dependency configs, PRs | the default `GITHUB_TOKEN`                               |
| `branch_protection`                 | repository **administration: read** (a PAT or App token) |

With a default token, `branch_protection` reports `na` and the report tells you what
granting `administration:read` would unlock. It is never a `fail` — a permission
error is not evidence of poor health.

Running with no token at all works for public repositories, but GraphQL requires
authentication, so the two pull request rules will report `na`.

## Cost and limits

A scan costs about eight requests per repository: one for metadata, up to three to
walk the file tree, one or two for branch protection, one for `.repohealth.yml`, and
one GraphQL query for pull requests.

Two caps are worth knowing about. Pull request pagination stops after 500 open PRs
and reports the counts as a lower bound, saying so in the evidence. And Octokit's
throttling plugin paces GraphQL at one request per second, so a fleet scan settles at
roughly one repository per second however many run concurrently.

## GitHub Enterprise Server

Nothing hardcodes `api.github.com`. The base URL comes from `--api-url`, then
`GITHUB_API_URL` (which Actions runners set on github.com and GHES alike), then
github.com. Endpoints missing on older GHES versions degrade the affected rule to
`na`.

## Development

```bash
pnpm install     # bootstrap the workspace
pnpm build       # build all packages and the Action bundle
pnpm test        # vitest across the workspace
pnpm typecheck   # tsc over sources and tests
pnpm lint        # eslint + prettier
pnpm cli -- --help
```

## Roadmap

| Phase | Scope                                             | Status      |
| ----- | ------------------------------------------------- | ----------- |
| 0     | Workspace, tooling, CI                            | done        |
| 1     | Types, config loading and validation, API client  | done        |
| 2     | GitHub fetch layer (`RepoContext`) and live rules | done        |
| 3     | Scoring and report assembly                       | done        |
| 4     | CLI wired to the fetch layer                      | done        |
| 5     | GitHub Action (`action.yml`, summary, outputs)    | not started |
| 6     | Docs, badge setup, release                        | not started |

Design deviations and resolved ambiguities are recorded in
[DECISIONS.md](DECISIONS.md).
