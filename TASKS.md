# TASKS.md — Implementation Plan

Work phases strictly in order. A phase is done only when its acceptance criteria
pass and `pnpm build && pnpm test && pnpm lint` is green.

## Phase 0 — Scaffold

- pnpm workspace with `packages/core`, `packages/cli`, `packages/action`; strict
  TypeScript; vitest; eslint+prettier; esbuild bundling script for the action;
  GitHub Actions CI workflow running build/test/lint and verifying `action/dist` is
  up to date with source (rebuild and `git diff --exit-code`).
- **Accept:** fresh clone → `pnpm install && pnpm build && pnpm test` green; CI
  workflow passes on push.

## Phase 1 — Core: types, config, client

- `types.ts` implementing the SCORING.md §6 schema; `config.ts` with defaults,
  remote `.repohealth.yml` fetch, deep-merge, validation (warning vs hard-fail per
  SCORING.md §5); `github/client.ts` with baseUrl resolution per ARCHITECTURE.md
  §GHES and retry/throttle plugins.
- **Accept:** unit tests for config merge (empty file, partial override, unknown
  key warning, type-error hard fail) and baseUrl resolution (env set/unset, flag
  override).

## Phase 2 — Rules + context fetch

- `RepoContext` fetcher: repo metadata (REST) + the single GraphQL PR query
  (pagination at 100, drafts excluded). All five rules per SPEC.md, each returning
  evidence and details; `branch_protection` tries rulesets → legacy endpoint → `na`
  on 403/404 per ARCHITECTURE.md §Token permissions.
- **Accept:** per-rule fixture tests: pass/fail/na + threshold boundaries
  (x = good_at, x = bad_at, x between); 403 on branch protection yields `na` with
  the unlock-instruction evidence string; drafts excluded from both PR counts.

## Phase 3 — Scoring + report

- `scoring.ts` (rule score → weighted aggregate → grade, `na`/`disabled`
  exclusion, all-`na` → null/"N/A"); `report.ts` (HealthReport assembly, markdown
  renderer, shields JSON with SCORING.md §6 color map).
- **Accept:** SCORING.md §7 worked example reproduced exactly by a test; boundary
  grades (80.0 → B); markdown renders one table per repo with evidence column;
  shields JSON validates.

## Phase 4 — CLI

- `repohealth --repos org/a,org/b --format json|markdown|badge [--api-url]
[--config <path>] [--fail-below <grade>]`; token from `GITHUB_TOKEN` env; exit 0
  normally, exit 1 when any repo grades below `--fail-below`; `--config` local file
  overrides remote fetch (useful for scanning many repos with one policy).
- **Accept:** e2e test with mocked transport covering json + markdown output and
  the fail-below exit code; `node packages/cli/dist/index.js --help` documents all
  flags.

## Phase 5 — Action

- `action.yml` inputs/outputs per ARCHITECTURE.md §Action design; wrapper reads
  inputs → core → writes `report.json` + badge JSONs to `output-dir`, step summary,
  sets outputs, optional `report-url` POST (fire-and-warn on failure, never fail
  the run because a dashboard was down); esbuild bundle committed.
- **Accept:** `act`-style local run or workflow-level integration test with mocked
  API produces report file, summary, outputs; missing-permission path shows the
  unlock guidance in the summary.

## Phase 6 — Docs + release readiness

- README: quick start (Action in <5 min), CLI usage, library example, full
  `.repohealth.yml` reference, report schema reference, token permission matrix,
  "vs OSSF Scorecard" comparison table, badge setup (shields endpoint URL to the
  raw badge JSON committed/published by the user's workflow), GHES notes.
- CONTRIBUTING.md: how to add a rule (interface, registry, fixtures, config
  defaults, README row) — prove extensibility by documenation.
- Release: tag `v1.0.0`, floating `v1`, Marketplace metadata in `action.yml`
  (branding icon/color), `DECISIONS.md` capturing any deviations made en route.
- **Accept:** a reviewer following only the README gets a working scheduled scan
  and a badge; npm publish dry-run clean for core + cli.

## Backlog (post-v1, do not build now)

Key-CI-freshness rule, deployment-recency rule, org-wide repo discovery, trend
diffing helper, GitLab support, plus/minus grades.
