# Contributing to Fettle

Contributions are welcome — bug reports, rules, docs, all of it. This file covers
how to get set up, the invariants that shape review, and the walkthrough for the
change we expect most often: adding a rule.

## Getting set up

Node 20 or newer, and pnpm (the version in `packageManager` is authoritative).

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
2. **Minimal runtime dependencies.** `@actions/core`, `@octokit/core` and its
   official plugins, and `js-yaml`. Anything else needs a written justification in
   the relevant `package.json` explaining why it cannot be about thirty lines of our
   own code. Dev dependencies are unrestricted within reason.
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

## Commits and pull requests

- Small, reviewable commits. Message format: `phase-N: <what>` while the phased plan
  in `TASKS.md` is running; plain imperative subjects afterwards.
- Explain **why** in the body. The diff already says what.
- `pnpm build && pnpm test && pnpm lint && pnpm typecheck` must pass. CI runs the
  same, plus a rebuild of the Action bundle and a check that it still loads.
- If you touched the Action, commit the rebuilt `packages/action/dist/index.js`.
- Update `README.md` when behaviour changes. The Quick Start must always reflect
  reality.

## Releasing

Maintainers only.

1. Decide the version. The report schema is a public contract: a breaking change to
   `HealthReport` needs a `schemaVersion` bump and a major. A new enabled-by-default
   rule changes existing scores, so it is also a major.
2. Update the version in `packages/*/package.json` and `TOOL_VERSION` in
   `packages/core/src/branding.ts`. A test fails if these disagree.
3. `pnpm build && pnpm test && pnpm lint && pnpm typecheck`, and commit the rebuilt
   Action bundle.
4. Tag `vX.Y.Z` and push it. The release workflow verifies everything again,
   publishes `@fettle/core` and `@fettle/cli` to npm with provenance, moves the
   floating `vX` tag that Action consumers pin to, and drafts a GitHub release.
5. Check the floating tag moved: consumers write `uses: <owner>/fettle/packages/action@v1`.

Publishing needs an `NPM_TOKEN` secret with publish rights to the `@fettle` scope.
Until that exists, the publish step is skipped and the rest of the workflow still
runs.
