# DECISIONS.md

Deviations from `SPEC.md` / `ARCHITECTURE.md` / `SCORING.md`, and the ambiguities
resolved along the way. Each entry records what was chosen and why, so a reviewer
never has to guess whether something was deliberate.

## D1 — `RepoContext` carries data, not an Octokit handle

`ARCHITECTURE.md` §Rule interface says `RepoContext` carries the Octokit instance.
It does not. All I/O belongs to the fetch layer, and the context it produces is
plain data.

**Why:** the same document requires that rules "never duplicate API calls", which
only holds if rules cannot make calls at all. Removing the handle turns every rule
into a pure function of `(context, settings)`, so rule tests need no transport mock
and cannot accidentally become integration tests. Transport-level mocking still
applies where it belongs — to the fetcher.

## D2 — Rules are synchronous

`ARCHITECTURE.md` types `evaluate` as returning `Promise<RuleResult>`. It returns
`RuleResult`.

**Why:** it follows from D1. With the context pre-fetched there is no I/O left to
await, and "run rules in parallel" buys nothing for pure synchronous functions.
Making a future async rule possible is a one-line change to the interface if a rule
ever genuinely needs it.

## D3 — Data availability is modelled as a `Probe`

Each piece of gathered data is a `Probe<T>`: either a value, or a reason it is
missing.

**Why:** the invariant "rules degrade to `na`, never crash" is otherwise a
convention every rule author must remember. With `Probe`, a rule cannot reach the
value without handling the unavailable branch, and the `reason` it must surface is
exactly the evidence string the user reads. The invariant is enforced by the type
checker rather than by review.

## D4 — Threshold rules report `pass` only at full marks

`SCORING.md` gives threshold rules a continuous score but the report schema offers
only `pass | fail | na | disabled`. A partial score is reported as `fail` with the
score carrying the nuance.

**Why:** the alternatives are worse. A cutoff anywhere in the middle would be an
invented threshold the spec does not define, and adding a fifth status would break
the schema contract. "Full marks or a shortfall" is the simplest reading, and the
evidence string always states the raw value and both thresholds.

## D5 — A pull request with no commits ages from its creation time

`SCORING.md` §2 defines staleness partly by the last commit's `committedDate`. A PR
with no commits has none.

**Why:** such a PR has had no commit activity ever, so its creation time is the
most recent activity we can point at. Treating "no commits" as "never inactive"
would let an empty, abandoned PR score as healthy.

## D6 — Staleness thresholds are strict comparisons

A PR open exactly `open_days` days, or whose last commit is exactly
`inactive_days` old, is **not** stale.

**Why:** `SCORING.md` says "older than", which excludes the boundary. Matching the
same "at the boundary, take the kinder result" convention as the grade bands.

## D7 — `--fail-below` never trips on `N/A`

A repository where every check was inconclusive grades `N/A`, and `N/A` satisfies
any floor.

**Why:** `ARCHITECTURE.md` is explicit that a permission error is not evidence of
poor health. Failing a build because a token was too narrow would punish exactly the
case the `na` design exists to protect. The markdown report calls out what could not
be run, so the situation is visible rather than silent.

## D8 — No `assess(repo)` until the fetch layer exists

`ARCHITECTURE.md` lists `assess()` among core's public exports. Core currently
exports `assessContext` / `assessContexts`, which score an already-fetched context,
and the CLI and Action exit with an explicit "not implemented yet" message.

**Why:** an earlier revision shipped an `assess()` that returned hardcoded results
resembling the `SCORING.md` §7 worked example without making a single API call. The
CLI, the Action and their tests all depended on it, so the suite was green while the
tool measured nothing. A function that fails loudly is strictly better than one that
fabricates a grade. `assess()` arrives with the fetcher in Phase 2.

## D9 — Recorded API fixtures arrive with the fetcher

`ARCHITECTURE.md` places `test/fixtures/` (recorded API response shapes) under
core. Rule tests currently build `RepoContext` values through
`test/helpers/context.ts` instead.

**Why:** it follows from D1 — rules no longer see API responses, so an API fixture
would be testing the wrong layer. Recorded response fixtures belong to the fetcher
and land with it in Phase 2, tested at the transport level as the testing policy
requires.

## D10 — The config validator derives its schema from the defaults

`resolveConfig` validates a user's file by comparing it against the shape and types
of `defaultConfig`, rather than against a separately written schema.

**Why:** it keeps the dependency budget at zero (no schema library) in about a
hundred lines, and it cannot drift: a new setting becomes valid the moment it is
given a default. Semantic constraints that shape alone cannot express — `good_at <
bad_at`, non-negative weights — are checked explicitly afterwards.
