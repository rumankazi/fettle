# Contributing to Fettle

Contributions are welcome — bug reports, rules, docs, all of it. This file covers
how to get set up, the invariants that shape review, and the walkthrough for the
change we expect most often: adding a rule.

## Getting set up

Node 22 or newer, and pnpm (the version in `packageManager` is authoritative).
pnpm 11 itself requires Node 22.13.

```bash
pnpm install
pnpm build       # build all packages and the Action bundle
pnpm test        # vitest across the workspace
pnpm typecheck   # tsc over sources and tests
pnpm lint        # eslint + prettier
pnpm format      # apply prettier
pnpm cli -- --repos octocat/Hello-World --format markdown
```

`pnpm test` runs against source, not build output, so it needs no prior build.

Set `GITHUB_TOKEN` before running the CLI against a real repository. Without one,
GraphQL is unavailable and the two pull request rules report `na`.

## Invariants

These are not style preferences. A change that breaks one needs a conversation
before it needs a review.

1. **The report JSON is the public API.** Changes to `HealthReport` after v1 must be
   additive. Anything else needs a `schemaVersion` bump.
2. **Minimal runtime dependencies.** `@octokit/core` and `js-yaml`. Two. That is the whole list, and CI enforces it. Anything else needs a
   written justification explaining why it cannot be about thirty lines of our own
   code — `@actions/core` was removed on exactly that test, since it brought three
   quarters of the Action bundle and three advisories for six functions we now
   implement in `packages/action/src/runtime.ts`. Dev dependencies are unrestricted
   within reason.
3. **No runtime installs.** The Action ships a bundled `dist/index.js` committed to
   the repository. CI rebuilds it and fails if the committed copy differs.
4. **github.com and GitHub Enterprise Server.** Never hardcode `api.github.com`.
5. **Rules degrade to `na`, never crash.** A check that cannot be run returns `na`
   with evidence saying how to unlock it. It is never a `fail`.
6. **Every result carries evidence.** A reader must understand their score without
   reading our source.
7. **No telemetry, no network calls** except the GitHub API and the user's own
   `report-url`.

`SCORING.md` is normative. If your implementation disagrees with it, your
implementation is wrong. Deviations and resolved ambiguities are recorded in
[DECISIONS.md](DECISIONS.md); add an entry rather than leaving a reviewer to guess.

## Architecture in one paragraph

`packages/core` holds everything: config, the GitHub fetch layer, the rules, the
scorer, the report. `packages/cli` and `packages/action` are thin wrappers over it
and depend on it, never on each other. The fetch layer performs all I/O and produces
a `RepoContext` of plain data; **rules are pure synchronous functions** of
`(context, settings)`. That is why rule tests need no mocking. See
[ARCHITECTURE.md](ARCHITECTURE.md) and DECISIONS D1–D3.

## Adding a rule

The rule set is deliberately small — five rules, chosen in `SPEC.md`, with an
explicit list of things we decided not to measure. **Open an issue before building
a new one**, because whether a rule belongs is a product question, not a technical
one. The mechanics, once that is settled:

**1. Write the rule** in `packages/core/src/rules/<name>.ts`:

```ts
import { fail, notApplicable, pass } from './result.js';
import type { BooleanRuleSettings, RepoContext, Rule, RuleResult } from '../types.js';

/** One sentence: the question this answers. */
export const myRule: Rule<'my_rule'> = {
  id: 'my_rule',
  kind: 'boolean',

  evaluate(ctx: RepoContext, settings: BooleanRuleSettings): RuleResult {
    const probe = ctx.existingPaths;
    if (!probe.available) return notApplicable('my_rule', settings, probe);

    return probe.value.includes('THING')
      ? pass('my_rule', settings, 'Found THING at the root.', { path: 'THING' })
      : fail('my_rule', settings, 'No THING found. Add one so that …', {});
  },
};
```

Use the constructors in `rules/result.ts` rather than building a `RuleResult` by
hand — they keep "score is `null` exactly when the rule was not scored" true by
construction. Threshold rules call `threshold()`, which routes through the one
implementation of the curve in `scoring.ts`.

**2. Declare the id** in `RuleId` and its settings in `ResolvedRuleSettings`
(`types.ts`).

**3. Give it defaults** in `defaultConfig.rules` (`config.ts`). This also teaches the
config validator about its settings: the validator derives its schema from the
defaults, so a setting becomes valid the moment it has one (DECISIONS D10).

**4. Register it** in `rules/rule.ts`. Registry order is report order. A
compile-time check fails until every `RuleId` is registered, so you cannot forget.

**5. If it needs data we do not fetch yet**, add a `Probe<T>` field to `RepoContext`
and populate it in `github/context.ts`. Stay inside the request budget of about ten
per repository, and make sure the probe degrades rather than throwing.

**6. Test it.** Minimum: pass, fail, `na`, and both threshold boundaries if it has
any. Rule tests build a context with `test/helpers/context.ts` and stay pure. Fetch
layer tests mock the transport, never our own functions, using recorded fixtures in
`test/fixtures/`.

**7. Document it**: the rule table in `README.md`, the `.fettle.yml` reference, and
a row in `SPEC.md`.

Note that adding an enabled-by-default rule **changes everyone's score**. Ship it
disabled by default, or hold it for a major release.

## Tests

- Every rule: pass, fail, `na`, threshold boundaries.
- The scorer: including `na` renormalisation and the `SCORING.md` §7 worked example,
  whose numbers are the source of truth.
- Mock Octokit at the transport level, never by stubbing our own functions.
- No live API calls in CI tests.

Two consistency tests exist because some facts cannot be expressed in one place:
`action.yml`'s defaults are checked against the constants in `branding.ts`, and
`TOOL_VERSION` against the package version. If you change one, the test tells you
about the other.

Note that `action.yml` lives at the **repository root**, not in `packages/action`.
The GitHub Marketplace only lists an action whose metadata file is there; a manifest
in a sub-folder still works via `owner/repo/path@ref` but is never listed. The bundle
it points at stays in `packages/action/dist/`.

## Commits and pull requests

Pull requests are **squash-merged**, so the pull request title becomes the commit
subject on `main` — and the release automation reads those subjects to decide the
next version. The title must therefore be a
[Conventional Commit](https://www.conventionalcommits.org/); CI checks it.

| Title                                   | Effect on the next release |
| --------------------------------------- | -------------------------- |
| `feat: add a deployment-recency rule`   | minor bump                 |
| `fix: stop treating a 403 as a failure` | patch bump                 |
| `feat!: drop the v0 report schema`      | **major** bump             |
| `docs: explain the grade floor`         | none                       |

Types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore`
`revert`. A scope is optional: `fix(cli): …`. A breaking change is `!` after the
type, or a `BREAKING CHANGE:` footer in the body.

Two changes are breaking whether or not they look it:

- anything non-additive to `HealthReport`, which is a published contract;
- **a new rule that is enabled by default**, because it changes the grade of
  repositories that did not change. Ship it disabled, or take the major.

Also:

- **Never push to `main`.** Branch, push the branch, open a pull request — `main`
  requires one, and the release automation reads squashed PR titles.
- Small, reviewable commits within a branch. Explain **why** in the body; the diff
  already says what.
- `pnpm build && pnpm test && pnpm lint && pnpm typecheck` must pass. CI runs the
  same, plus a rebuild of the Action bundle, a check that it still loads, and a live
  scan of this repository with the build under review.
- If you touched the Action, commit the rebuilt `packages/action/dist/index.js`.
- Update `README.md` when behaviour changes. The Quick Start must always reflect
  reality.

## Releasing

**Nobody tags anything by hand, and nobody picks a version number.** Releases are
driven by the commit history.

### The loop

1. Merge pull requests to `main` as normal. Their Conventional Commit titles are the
   input.
2. [release-please](https://github.com/googleapis/release-please) opens a pull
   request titled **`chore: release X.Y.Z`** and keeps it up to date as more lands.
   It works out `X.Y.Z` from the commits, writes `CHANGELOG.md`, and bumps the
   version in all four places it lives: the root and three package manifests, plus
   `TOOL_VERSION` in `branding.ts`.
3. `release-pr.yml` rebuilds the committed Action bundle on that pull request — the
   version is baked into it — and re-runs the full check suite afterwards, so what is
   verified is what will merge.
4. **Merging the release pull request is the release.** It tags `vX.Y.Z`, creates the
   GitHub release from the changelog, publishes `@fettle/core` and `@fettle/cli` to
   npm with provenance, and moves the floating `vX` tag that Action consumers pin to.

The only human decision is _when_ to merge the release pull request. Never _what
version_ — that is already decided by what was merged.

### Reviewing a release pull request

Read the changelog diff. If a change is in the wrong section or the version bump
looks wrong, the fix is in the commit history, not the release pull request: the
subject that produced it used the wrong type. Correct it with a follow-up commit
using the right type, and release-please will recompute.

### Forcing a specific version

Add a footer to any commit on `main`:

```
Release-As: 1.0.0
```

That is how the first stable release is cut — see below.

### The first release

The repository starts at `0.1.0` with no tags. The next release is worked out from
there: a `feat:` makes it `0.2.0`, a `fix:` makes it `0.1.1`. Nothing releases at
all until at least one Conventional Commit lands on `main`, so the existing
`phase-N:` history produces nothing.

To go straight to `1.0.0`, land a commit whose body carries `Release-As: 1.0.0`.
Do that when the report schema is one you are willing to keep, because after
`v1.0.0` a change to it costs a major.

### Prerequisites

| Needed for                   | What                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| npm publishing               | an `NPM_TOKEN` secret with publish rights to the `@fettle` scope                          |
| release-please opening PRs   | Settings → Actions → General → _Allow GitHub Actions to create and approve pull requests_ |
| a review gate before publish | an Environment named `release`, optionally with required reviewers                        |

Without `NPM_TOKEN` the release still happens — tag, GitHub release, floating major
tag — and the publish step logs a warning instead. That is deliberate: it means the
whole pipeline can be exercised before the npm scope exists.
