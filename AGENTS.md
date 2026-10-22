# AGENTS.md

**Fettle** is a public GitHub Action, CLI (`fettle`) and library (`@fettle/core`) that grades the
maintenance health of GitHub repositories and emits a versioned JSON report (`schemaVersion: 1`)
plus a letter grade. Released (v4.x); the report schema is a public contract.

`CLAUDE.md` holds the owner's invariants and testing policy and is authoritative. Before changing
behaviour, read in order: `SPEC.md` → `ARCHITECTURE.md` → `SCORING.md` (normative) →
`DECISIONS.md` (deliberate deviations) → `CONTRIBUTING.md` (adding rules, release process).

## Commands (run from repo root; verified 2026-10-22, Node 24 / pnpm 11.28.5)

```
pnpm install --frozen-lockfile   # what CI runs; plain `pnpm install` locally is fine
pnpm lint                        # eslint . && prettier --check .   (~5s)
pnpm typecheck                   # tsc per package                   (~7s)
pnpm test                        # vitest run, 353 tests, offline    (~3s)
pnpm build                       # tsc core/cli + esbuild action bundle (~6s)
pnpm format                      # prettier --write . (not run in CI)
pnpm cli -- --help               # builds cli+core, runs packages/cli/dist/index.js
```

CI-only checks (`.github/workflows/`), which you should reproduce locally before pushing:

```
git diff --exit-code -- packages/action/dist                       # committed bundle is fresh
INPUT_REPOS=not-a-repository-name node packages/action/dist/index.js # must print org/name error, exit 1
```

- `security.yml` enforces a runtime-dependency allowlist: `@fettle/core @octokit/core js-yaml`.
- `pr-title.yml` requires a Conventional Commit PR title.
- `ci.yml` `self-scan` is the only e2e test. It runs `uses: ./` against this repo using the live API.
- Requirements: Node `>=22` (CI matrix 22/24/26; pnpm needs ≥22.13), `packageManager: pnpm@11.28.5`.
  The Action itself runs on `node24`.

## Architecture map

```
action.yml                 Action metadata. Must stay at repo ROOT (Marketplace); runs.main → bundle
packages/core/src/         library: assess.ts, scoring.ts, report.ts, badge.ts, config.ts, types.ts
  rules/                   one module per rule; rule.ts = ruleRegistry (registry order = report order)
  github/client.ts         Octokit client + GHES base-URL resolution (resolveApiUrl)
  branding.ts              TOOL_NAME, TOOL_VERSION, CONFIG_FILENAME (.fettle.yml), defaults
packages/cli/src/          cli.ts (arg parsing, injectable env/stdio), pretty.ts, index.ts (bin)
packages/action/src/       action.ts, runtime.ts (own INPUT_*/GITHUB_OUTPUT handling, no @actions/core)
packages/action/build.mjs  esbuild → packages/action/dist/index.js  (COMMITTED, the only tracked dist)
packages/*/test/           vitest suites; core/test/fixtures/*.json = recorded API responses
```

The data flow is config → GitHub context fetch (REST + GraphQL) → rules → scorer → `HealthReport`.
The CLI and the Action wrap `@fettle/core`.
No DB, Docker, Terraform or k8s. Releases go through release-please, then npm publish (OIDC trusted publishing).

## Conventions

- TS strict, NodeNext ESM. Prettier: single quotes, semis, trailing commas, width 100.
- ESLint `no-console: error`. Write through injected runtime/stdio, not `console`.
  Unused vars are allowed with a `_` prefix.
- The product name lives only in `branding.ts` and package names. Don't spread the literal string.
- To add a rule: create a module in `rules/`, add a `RuleId`, add `defaultConfig`, and register it in
  `ruleRegistry` (see `rules/rule.ts` header and `CONTRIBUTING.md`). The compiler proves full coverage.
- PRs are squash-merged, and the PR title is the release input: `feat:` minor, `fix:` patch,
  `!`/`BREAKING CHANGE:` major. A non-additive report change is breaking, and so is a new rule
  enabled by default.
- When the spec is ambiguous, choose the simplest reading and record it in `DECISIONS.md`.

## Testing rules

- Each rule needs tests for the pass case, the fail case, the `na` case and threshold boundaries,
  all against fixture JSON.
- The scorer must reproduce the `SCORING.md` §Worked example exactly. The doc wins over the code.
- Mock Octokit at the transport level (`core/test/helpers/transport.ts`, stubbed `fetch` keyed by
  `"METHOD /path"` or GraphQL operation name). Never stub Fettle's own functions.
- No live GitHub API calls in vitest.
- Use the injectable `runtime`/`env` seams in the Action and CLI tests. Don't mutate `process.env`.
- Consistency tests compare `action.yml` defaults with `branding.ts`, and `TOOL_VERSION` with the
  package version.

## Do

- Work on a branch and open a PR. `main` is protected by a ruleset.
- After touching `packages/action/src` or anything in core it bundles, run `pnpm build` and
  commit `packages/action/dist/index.js`.
- Resolve the API URL through `resolveApiUrl` (`--api-url` > `--gh-host` > `$GITHUB_API_URL` >
  `$GH_HOST` > github.com).
- When a rule can't be evaluated, return `na` with evidence that tells the user how to unlock it.

## Don't

- Don't push to `main`, and don't hand-edit `CHANGELOG.md` (release-please owns it, and prettier ignores it).
- Don't rename or remove `HealthReport` fields without bumping `schemaVersion`.
- Don't add runtime dependencies without a written justification. CI rejects anything outside the allowlist.
- Don't hardcode `api.github.com`, add telemetry or make network calls beyond the GitHub API and
  the user's `report_url`.
- Don't hand-bump versions. They live in 5 places (3× package.json, `.release-please-manifest.json`,
  `branding.ts`), and release-please keeps them in sync.

## Gotchas

- `pnpm test` runs against core **source** through a vitest alias (`@fettle/core` →
  `packages/core/src/index.ts`). Green tests can still ship a stale bundle, so run the two
  CI-only checks above.
- The dist-freshness check is skipped on `release-please--*` and `renovate/*` branches, where
  `release-pr.yml` rebuilds and commits the bundle itself.
- `core/` and `cli/` `dist/` folders exist on disk but are git-ignored. Only the action bundle is tracked.
- Action inputs become `INPUT_<NAME>` uppercased with hyphens kept (e.g. `INPUT_CONFIG-PATH`).
- There's no `.env.example`. Env var names used: `GITHUB_TOKEN`, `GITHUB_API_URL`, `GH_HOST`,
  `GITHUB_REPOSITORY`, `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY`, `FETTLE_DEBUG`. Workflow secrets:
  `FETTLE_APP_CLIENT_ID`, `FETTLE_APP_PRIVATE_KEY`, `NPM_TOKEN`.
- `CONTRIBUTING.md` says `pnpm install`, but CI uses `--frozen-lockfile`. Don't commit lockfile drift.
