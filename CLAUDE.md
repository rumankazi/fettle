# CLAUDE.md — Agent Operating Instructions

**Fettle** is a public GitHub Action, CLI, and library that grades the maintenance
health of one or more GitHub repositories and emits a versioned JSON report plus a
letter grade. It is released and published; v1.0.0 onward the report schema is a
contract.

Read these documents in order before writing any code:

1. `SPEC.md` — what we are building and, just as important, what we are NOT building.
2. `ARCHITECTURE.md` — package layout, data flow, API strategy, GHES support.
3. `SCORING.md` — the exact scoring math, config schema, and report schema. This file
   is normative: implement it exactly, do not improvise.
4. `DECISIONS.md` — every deviation from the above, and why. Read it before
   concluding that something contradicts the spec; it probably does, deliberately.
5. `CONTRIBUTING.md` — how to add a rule, the release process, and the repository
   settings the workflows depend on.

The product shipped v1.0.0. The phased build plan that got it there is gone; what
remains is documented behaviour, and `SPEC.md` holds the post-v1 backlog.

## Project invariants (never violate these)

- **The report JSON schema is the public API.** Any change to `HealthReport` after
  v1 must be additive. Breaking changes require bumping `schemaVersion`. Never
  rename or remove a field casually.
- **Minimal runtime dependencies.** Allowed runtime deps: `@octokit/core` (+ official
  octokit plugins) and `js-yaml`. That is the whole list and CI enforces it.
  Anything else requires a written justification explaining why it cannot be ~30
  lines of our own code — `@actions/core` was removed on exactly that test (see
  DECISIONS D30). Dev dependencies are unrestricted within reason.
- **No runtime installs.** The Action ships a bundled `dist/index.js` committed to
  the repo (esbuild). Consumers never run `npm install`.
- **Works on github.com AND GitHub Enterprise Server.** Never hardcode
  `api.github.com`. Resolve the base URL per `ARCHITECTURE.md` §GHES.
- **Rules degrade to `na`, never crash.** A rule that cannot be evaluated (missing
  token permission, API not available on an older GHES) returns `na` with an
  `evidence` message telling the user how to unlock it. `na` rules drop out of the
  scoring denominator (see `SCORING.md`).
- **Every rule result carries evidence.** A user must be able to read the report and
  understand exactly why they got their score without reading our source code.
- **No hosted service, no telemetry, no network calls except the GitHub API** and
  the optional user-configured `report_url` POST.

## Tech stack

- TypeScript, strict mode, Node 20+ (current Actions runner LTS).
- pnpm workspaces monorepo: `packages/core`, `packages/cli`, `packages/action`.
- Bundler: esbuild. Test runner: vitest. Lint: eslint + prettier, default configs,
  do not bikeshed style.
- REST via Octokit for config checks; GraphQL for PR flow data and open issues
  (see `ARCHITECTURE.md` §API strategy).

## Commands (set these up in Phase 0 and keep them working)

```
pnpm install          # bootstrap workspace
pnpm build            # build all packages, bundle action dist/
pnpm test             # vitest across workspace
pnpm lint             # eslint + prettier check
pnpm cli -- <args>    # run the CLI from source against a real repo
```

## Testing policy

- Every rule gets unit tests against fixture JSON (recorded API response shapes) —
  minimum: pass case, fail case, `na` case, threshold boundary cases.
- The scorer gets exhaustive unit tests including `na` renormalization and the
  worked example in `SCORING.md` §Worked example (the numbers in that example are
  the source of truth; if your implementation disagrees, your implementation is
  wrong).
- Mock Octokit at the transport level (e.g. `fetchMock`), not by stubbing our own
  functions.
- No live API calls in CI tests.

## Working style

- **Never push to `main`.** Branch, push the branch, open a pull request. `main` is
  protected by a ruleset requiring pull requests, and the release automation reads
  squashed PR titles.
- Pull requests are squash-merged, so **the PR title is the commit subject and the
  only input to versioning**. It must be a Conventional Commit — `feat:` minor,
  `fix:` patch, `!` or `BREAKING CHANGE:` major. CI checks it.
- Small, reviewable commits within a branch.
- When SPEC/SCORING is ambiguous, choose the simplest interpretation, implement it,
  and record the decision in `DECISIONS.md` (create it) rather than blocking.
- Update `README.md` as functionality lands; the Quick Start must always reflect
  reality.

## Naming

Keep the product name isolated in one constant (`packages/core/src/branding.ts`) and
in package names so a rename remains a small mechanical change. Do not spread the
literal string through code or docs headers unnecessarily.
