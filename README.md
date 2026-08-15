# Fettle

Grade the maintenance health of your GitHub repositories — five explainable rules,
weighted scoring, a letter grade, and evidence for every result.

> **Status: pre-release (v0.1.0).** The scoring engine is complete and tested. The
> GitHub fetch layer is not built yet, so the CLI and the Action cannot scan a live
> repository — both exit with an explicit message rather than reporting a grade they
> did not measure. See [Roadmap](#roadmap).

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

## Usage today: the library

```bash
pnpm add @fettle/core
```

```ts
import { assessContext, defaultConfig, renderMarkdown, buildHealthReport } from '@fettle/core';

const report = assessContext(
  {
    owner: 'acme',
    repo: 'demo',
    defaultBranch: 'main',
    now: new Date(),
    existingPaths: { available: true, value: ['.github/CODEOWNERS'] },
    branchProtection: { available: false, reason: 'token lacks administration:read' },
    pullRequests: { available: true, value: [] },
  },
  defaultConfig,
);

console.log(report.grade, report.score); // 'D' 66.7
```

Building the `RepoContext` from the GitHub API is the piece still to come. Every
field is a `Probe`: either `{ available: true, value }` or `{ available: false,
reason }`, where `reason` becomes the evidence the user reads. A rule cannot look at
a value without deciding what to do when it is missing.

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
| 2     | GitHub fetch layer (`RepoContext`) and live rules | not started |
| 3     | Scoring and report assembly                       | done        |
| 4     | CLI wired to the fetch layer                      | not started |
| 5     | GitHub Action (`action.yml`, summary, outputs)    | not started |
| 6     | Docs, badge setup, release                        | not started |

Design deviations and resolved ambiguities are recorded in
[DECISIONS.md](DECISIONS.md).
