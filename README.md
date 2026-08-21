# Fettle

[![repo health](https://raw.githubusercontent.com/rumankazi/fettle/badges/rumankazi__fettle.svg)](https://github.com/rumankazi/fettle/actions/workflows/health.yml)
[![CI](https://github.com/rumankazi/fettle/actions/workflows/ci.yml/badge.svg)](https://github.com/rumankazi/fettle/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40fettle%2Fcli?logo=npm)](https://www.npmjs.com/package/@fettle/cli)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![marketplace](https://img.shields.io/badge/marketplace-fettle-2ea44f?logo=github)](https://github.com/marketplace/actions/fettle-repository-health-grade)
[![socket: core](https://badge.socket.dev/npm/package/@fettle/core)](https://socket.dev/npm/package/@fettle/core)
[![socket: cli](https://badge.socket.dev/npm/package/@fettle/cli)](https://socket.dev/npm/package/@fettle/cli)

Grade the maintenance health of your GitHub repositories — five explainable rules,
weighted scoring, a letter grade, and evidence for every result.

That first badge is this repository's own grade, produced by this tool on every push
to `main`. It is a real five-rule score, not an average with the awkward checks
excluded — the report says exactly how each one was reached.

## What it measures

| Rule                 | Type      | Question                                                                      | Default weight |
| -------------------- | --------- | ----------------------------------------------------------------------------- | -------------- |
| `branch_protection`  | boolean   | Does the default branch have a protection rule or ruleset?                    | 3              |
| `codeowners`         | boolean   | Does a CODEOWNERS file exist in a standard location?                          | 1              |
| `dependency_updates` | boolean   | Is Dependabot or Renovate configured, by file or by Renovate's dashboard?     | 2              |
| `open_pr_count`      | threshold | Are open PRs piling up?                                                       | 1              |
| `stale_prs`          | threshold | How many PRs are open past `open_days` with no commit inside `inactive_days`? | 2              |

`dependency_updates` looks for a config file first, and falls back to Renovate's
dependency dashboard issue. That fallback matters in organisations running a single
Renovate operator from a shared config: member repositories hold no `renovate.json`
of their own, and the open dashboard is the only thing that shows they are covered.

Scoring is a weighted average, and a check we could not run scores nothing at all —
it leaves both sides of the average, so a narrow token never costs you points. If
fewer than half the weights could be scored, no grade is reported at all: an average
over one rule of five is arithmetically correct and tells you about your token
rather than your repository. Every report carries a `coverage` object so you can see
exactly what the number is based on. The full math is in [SCORING.md](SCORING.md),
which is normative.

## Fettle vs OSSF Scorecard

They answer different questions, and using both is reasonable.

|                        | Fettle                                         | [OSSF Scorecard](https://github.com/ossf/scorecard) |
| ---------------------- | ---------------------------------------------- | --------------------------------------------------- |
| Question               | Is this repository being looked after?         | Is this project's supply chain trustworthy?         |
| Checks                 | 5, maintenance-focused                         | ~19, security-focused                               |
| Aimed at               | internal repositories you own                  | open-source dependencies you consume                |
| Configuration          | weights and thresholds per repository          | fixed checks                                        |
| Output                 | letter grade, weighted, with evidence per rule | 0–10 per check                                      |
| Unrunnable checks      | dropped from the score entirely                | generally scored as a failure                       |
| Runs on                | github.com and GitHub Enterprise Server        | github.com (GitLab partially)                       |
| Noise on private repos | low — the rules were picked for it             | high — many checks assume a public project          |

If you want to know whether a dependency is safe to adopt, use Scorecard. If you
want to know which of your forty internal repositories nobody has touched in a year,
that is this.

## Quick start: the Action

```yaml
name: Repository health
on:
  schedule: [{ cron: '0 9 * * 1' }] # Mondays at 09:00
  workflow_dispatch:

jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: rumankazi/fettle@v4
        id: health
        with:
          fail-below: C # optional gate

      - run: echo "Graded ${{ steps.health.outputs.grade }} (${{ steps.health.outputs.score }})"

      - uses: actions/upload-artifact@v4
        with:
          name: repo-health
          path: ${{ steps.health.outputs.report-path }}
```

That writes `report.json` and a shields.io badge payload per repository, and posts
the table above to the job summary.

### Inputs

| Input         | Default               | Description                                                          |
| ------------- | --------------------- | -------------------------------------------------------------------- |
| `repos`       | the current repo      | `org/name`, comma- or newline-separated.                             |
| `token`       | `${{ github.token }}` | See [Token permissions](#token-permissions).                         |
| `config-path` | `.fettle.yml`         | Config file read from each scanned repository.                       |
| `fail-below`  | —                     | Fail the step below this grade: `A`–`F`. `N/A` never trips it.       |
| `report-url`  | —                     | POST the JSON report here. A failure is a warning, not a failed run. |
| `output-dir`  | `fettle-report`       | Where `report.json` and `badge/<repo>.json` are written.             |

### Outputs

`grade`, `score`, and `report-path`. For several repositories `grade` and `score`
describe the fleet average; per-repository detail is in `report.json`.

The Action does not upload artifacts itself — pair it with `actions/upload-artifact`
so retention stays your choice.

### Badges

The Action writes two badges per repository into `<output-dir>/badge/`:

| File               | What it is                                                                |
| ------------------ | ------------------------------------------------------------------------- |
| `OWNER__REPO.svg`  | the finished badge, self-contained — nothing is fetched to display it     |
| `OWNER__REPO.json` | a [shields.io endpoint](https://shields.io/badges/endpoint-badge) payload |

**Prefer the SVG.** It renders on a private repository, on GitHub Enterprise Server
and behind a corporate proxy, because displaying it involves no third party. The
shields.io payload only works where shields.io itself can reach the file over the
public internet — so not private repositories, and not GHES.

Either way the file has to live somewhere your README can point at, and where that
is depends on whether a workflow can write to your default branch.

**If it can** — no ruleset requiring pull requests — commit the SVG into the tree
and use a relative path, which is the tidiest result:

```markdown
![repo health](.github/badges/OWNER__REPO.svg)
```

**If it cannot** — which is the common case for a protected `main`, including this
repository — publish to a separate branch instead and point at the raw URL. GitHub
serves `.svg` as `image/svg+xml`, so it renders in a README:

```markdown
![repo health](https://raw.githubusercontent.com/OWNER/REPO/badges/OWNER__REPO.svg)
```

[`.github/workflows/health.yml`](.github/workflows/health.yml) is a working copy of
the second approach: it pushes both files to an orphan `badges` branch after each
scan, using `GITHUB_TOKEN` precisely because that token starts no workflow runs. The
badge at the top of this README is that file.

For the shields.io route on a public repository, point it at the JSON instead:

```
https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OWNER/REPO/badges/OWNER__REPO.json
```

## Quick start: the CLI

```bash
export GITHUB_TOKEN=...            # a PAT, or ${{ github.token }} in Actions
npx @fettle/cli --repos vitest-dev/vitest
```

```
fettle - 1 repository

vitest-dev/vitest                                                                        F 55.6
  ok   branch_protection   100 x3   Default branch 'main' is protected: ruleset 'Protect releases' …
  FAIL codeowners            0 x1   No CODEOWNERS file at any of .github/CODEOWNERS, CODEOWNERS, do…
  ok   dependency_updates  100 x2   Dependency update config found at .github/renovate.json5.
  FAIL open_pr_count         0 x1   40 open non-draft pull request(s); 10 or fewer scores 100, 30 o…
  FAIL stale_prs             0 x2   27 pull request(s) open more than 21 day(s) with no commit in t…
```

That format is for reading, and it is the default in a terminal only — piped or
redirected output defaults to `json`, so `fettle --repos ... > report.json` needs no
flag. Colour follows `NO_COLOR` and `FORCE_COLOR`. For a pull request comment or a
job summary, ask for markdown:

```bash
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
fettle --repos acme/api,acme/web > report.json         # json, because it is piped
fettle --repos acme/api --fail-below C                 # exit 1 if it grades below C
fettle --repos acme/api --gh-host ghe.acme.com         # or --api-url, see below
fettle --repos acme/api,acme/web --config policy.yml   # one policy for the fleet
fettle --repos acme/api --debug                        # every request, on stderr
```

`--debug` prints the resolved API host and every request with its status and
timing to stderr, leaving stdout machine-readable. It never prints the token.
`FETTLE_DEBUG=1` does the same where adding a flag is awkward.

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

Drop a `.fettle.yml` on the default branch of any repository you scan. Every
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

| Check                                               | Needs                                                    |
| --------------------------------------------------- | -------------------------------------------------------- |
| CODEOWNERS, dependency configs, PRs                 | the default `GITHUB_TOKEN`                               |
| `dependency_updates`, centrally-configured Renovate | **issues: read**, to see the dependency dashboard        |
| `branch_protection`                                 | repository **administration: read** (a PAT or App token) |

Every blocked check names the permission that would unlock it, and the report groups
them by that permission rather than repeating it per rule:

```
Checks that could not run

  acme/api
    Only 1 of 9 weight could be scored, so no grade is reported: too little of this
    repository could be read to stand behind one.
    grant administration:read to unlock branch_protection (weight 3)
    grant pull_requests:read to unlock open_pr_count, stale_prs (weight 3)
    grant issues:read to unlock dependency_updates (weight 2)
```

With a default token, `branch_protection` reports `na` and the report tells you what
granting `administration:read` would unlock. It is never a `fail` — a permission
error is not evidence of poor health.

Running with no token at all works for public repositories, but GraphQL requires
authentication, so the two pull request rules will report `na`.

## Cost and limits

A scan costs about eight requests per repository: one for metadata, up to three to
walk the file tree, one or two for branch protection, one for `.fettle.yml`, and
two GraphQL queries: one for pull requests, one for open issues.

One cap is worth knowing about: pull request pagination stops after 500 open PRs and
reports the counts as a lower bound, saying so in the evidence.

Rate limits are reported rather than slept through. A rate-limited response ends that
check as `na` carrying the reset time, rather than pausing the scan until the limit
clears — a scan that finishes with a gap and an explanation is more use than one that
hangs. Transport failures and server errors are retried with a quadratic backoff.

## GitHub Enterprise Server

Nothing hardcodes `api.github.com`. The base URL is resolved from the first of
these that is set, most explicit first:

| Source            | Example                                              |
| ----------------- | ---------------------------------------------------- |
| `--api-url`       | `https://ghe.acme.com/api/v3`                        |
| `--gh-host`       | `ghe.acme.com`                                       |
| `$GITHUB_API_URL` | set by Actions runners, on github.com and GHES alike |
| `$GH_HOST`        | the variable the `gh` CLI already uses               |
| otherwise         | github.com                                           |

A host is turned into an API URL for you: `ghe.acme.com` becomes
`https://ghe.acme.com/api/v3`, and github.com becomes `https://api.github.com`. If
none of these is set and the request cannot reach github.com, the error says so and
names the flags — a connection timeout to `api.github.com` from inside an enterprise
network is almost always a missing host, not a broken one.

Endpoints missing on older GHES versions degrade the affected rule to `na`.

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

Shipped, published and listed. What is left is product, not plumbing — the post-v1
backlog in [SPEC.md](SPEC.md): a key-CI-freshness rule, a deployment-recency rule,
org-wide repository discovery, trend diffing, GitLab support, plus/minus grades.

Adding a rule that is enabled by default changes the grade of repositories that did
not change, so it costs a major release. See
[CONTRIBUTING.md](CONTRIBUTING.md#adding-a-rule).

Design deviations and resolved ambiguities are recorded in
[DECISIONS.md](DECISIONS.md).
