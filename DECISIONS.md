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

## D8 — Nothing reports a grade it did not measure

An earlier revision shipped an `assess()` that returned hardcoded results
resembling the `SCORING.md` §7 worked example without making a single API call. The
CLI, the Action and their tests all depended on it, so the suite was green while the
tool measured nothing.

It was deleted rather than patched, and until the fetch layer existed core exported
only `assessContext` — scoring over an already-fetched context — while the CLI
exited with an explicit "not implemented yet". `assess()` now exists and is real.

**Why it is recorded:** a function that fails loudly is strictly better than one
that fabricates a grade, and `assessContext` remains exported because that seam is
what keeps the scoring pipeline testable without a network.

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

## D11 — File discovery walks git trees instead of probing each location

The fetcher reads the root tree, then the `.github` and `docs` subtrees by sha,
rather than asking whether each of the eleven candidate files exists.

**Why:** the request budget is about ten per repository (`ARCHITECTURE.md` §API
strategy) and the rules between them check eleven paths. Three tree reads answer
all of them, cost nothing extra as rules are added, and avoid escaping paths into
URLs. A subtree we cannot read contributes no paths, which lands the affected rule
on `fail` — the same conclusion a person browsing the repository would reach.

## D12 — A legacy "branch not protected" 404 is only believed once rulesets have been read

`fetchBranchProtection` treats the legacy endpoint's 404 as a genuine negative only
when the rulesets endpoint answered first and returned nothing. Otherwise it is
`na`.

**Why:** 404 from that endpoint means "no legacy protection", not "no protection".
If rulesets were unreadable, a ruleset we never saw may well be protecting the
branch, and reporting `fail` would invent a finding. This is the one place where
the two endpoints' answers have to be combined rather than taken in isolation.

## D13 — Pull request pagination stops after five pages and says so

At most 500 open pull requests are read. Beyond that the counts are reported as a
lower bound, with `truncated: true` in the details and "At least N" in the
evidence.

**Why:** repositories like `octocat/Hello-World` have thousands of open PRs. An
uncapped crawl took thirty seconds and twenty requests for a single repository,
against a ten-request budget. Any repository past 500 open PRs scores zero under
any sane threshold, so the cap costs no accuracy that matters — but the report says
plainly that it stopped counting rather than implying an exact figure.

## D14 — Rate limits are waited out only if the wait is short

`shouldRetryRateLimit` accepts a retry only when GitHub asks for 60 seconds or
less.

**Why:** Octokit's throttling plugin will sleep for whatever `retry-after` says, and
an exhausted _primary_ rate limit resets on the hour. Accepting every retry parked a
scan for up to an hour with no output — the first live run of the CLI hung exactly
this way. A secondary limit clears in seconds and is worth waiting for; anything
longer should fail fast. The resulting error carries the reset time and tells the
user to authenticate.

## D15 — A rate-limited 403 is reported as such, not as a missing permission

`rateLimitHint` inspects `x-ratelimit-remaining` before any 403 is attributed to
permissions.

**Why:** GitHub answers both "you may not do this" and "you have asked too often"
with a 403. Without the check, every rate-limited scan told the user to grant
`administration:read` they already had — actively misleading, and the opposite of
the evidence guarantee.

## D16 — GraphQL is paced at one request per second, and we live with it

Octokit's throttling plugin routes every GraphQL request — including read-only
queries like ours — through a one-per-second limiter shared across the process.

**Why not work around it:** the pacing is the plugin doing its job, and a
maintenance-health scan is not latency-sensitive. The consequence is documented on
`GitHubClientOptions.throttle` because it is the real ceiling on fleet throughput:
one repository per second, whatever `maxConcurrency` says. Tests disable throttling
rather than serialise on it.

## D17 — The Action bundle carries a `createRequire` banner

`packages/action/build.mjs` prepends a real `require` to the ESM bundle.

**Why:** `@actions/core` is CommonJS, and esbuild's ESM output replaces `require`
with a shim that throws unless one is already in scope. Without the banner the
committed bundle died on load with `Dynamic require of "os" is not supported` —
which no unit test caught, because the tests import the Action's source rather than
its bundle. CI now runs the built artefact and checks it reaches our own input
validation, so this class of failure cannot ship again.

The alternative, emitting CommonJS, would have made this the only package in the
workspace with a different module system and forced a second `moduleResolution`
setting to typecheck it.

## D18 — The Action's `grade` and `score` outputs describe the fleet average

`ARCHITECTURE.md` §Action design specifies three outputs — `grade`, `score`,
`report-path` — without saying what they mean for a multi-repository scan. They
carry `fleet.averageScore` and its grade.

**Why:** for a single repository, which is the common case, the fleet average is
exactly that repository's score, so one rule covers both without a special case.
Per-repository grades are in `report.json` and the job summary. Note that `--fail-below`
deliberately does _not_ use the average: it checks every repository individually, so
one healthy repository cannot mask a rotten one.

## D19 — The product name is `fettle` in user-facing paths too

The config file is `.fettle.yml` and the Action's default output directory is
`fettle-report/`. The specification documents were written under an earlier working
name, `repohealth`, and have been updated to match.

**Why:** `SPEC.md` and friends are normative on behaviour, not on a name the owner
has since settled. Leaving `.repohealth.yml` in place would have left the published
config filename — a contract users write into their repositories — disagreeing with
the product, the package names and the CLI binary.

No compatibility shim reads the old filename: nothing has been released, so there is
no user with a `.repohealth.yml` to support. Adding a fallback for a name that never
shipped would be permanent complexity bought for nobody.

`CONFIG_FILENAME` and `DEFAULT_OUTPUT_DIR` live in `branding.ts` and are imported by
the Action rather than restated. `action.yml` cannot import a constant, so its
defaults are the one remaining duplicate — a test parses the manifest and asserts
they still agree.

**The badge label stays "repo health".** It names the metric, the way shields
badges elsewhere read "coverage" or "build", rather than the product. It is one
constant (`BADGE_LABEL`) if that judgement is ever reversed.

## D20 — Evidence is escaped before it reaches markdown

`renderMarkdown` flattens newlines and escapes pipes in every evidence string,
in the table and in the "checks we could not run" list alike.

**Why:** evidence embeds data from the repository being scanned — ruleset names,
file paths — and that is not always a repository the reader controls. A newline
would end a table row and a `##` at the start of the next line would become a
heading, letting a scanned repository restructure a report about itself. The text
survives intact; it just cannot start a line.

## D21 — PR-gating security checks are the precise ones; the noisy one is scheduled

`dependency-review` runs on pull requests and blocks them. `pnpm audit` runs weekly
and on demand, not on pull requests.

**Why:** the two answer different questions. Dependency review asks "does _this
change_ add something vulnerable", which is the author's problem and worth blocking
on. `pnpm audit` asks "is anything in the tree vulnerable today", which usually has
nothing to do with the change under review — an advisory published this morning
would block unrelated work, and a check that blocks unrelated work is a check people
learn to route around. Weekly runs keep it visible without making it someone else's
problem at the wrong moment.

Accepted advisories are listed in `pnpm.auditConfig.ignoreGhsas` and justified
individually in [SECURITY.md](SECURITY.md#accepted-advisories), including the one
genuinely unresolved item: `@actions/core` ships roughly three quarters of the Action
bundle, `undici` included, for six functions we could write ourselves.

## D22 — Third-party actions are pinned to a commit SHA; first-party ones are not

`pnpm/action-setup` is pinned to a SHA with the version in a trailing comment.
`actions/*` and `github/codeql-action/*` are referenced by major tag.

**Why:** a mutable tag on a third-party action is a supply-chain hole — whoever
controls the repository can move it. Pinning first-party GitHub actions the same way
buys much less, since compromising them means compromising the runner anyway, and it
costs a great deal of churn. Dependabot's `github-actions` ecosystem updates both, so
the SHA does not rot.

## D23 — The repository passes its own checks

The repository has `.github/CODEOWNERS`, `.github/dependabot.yml`, and a workflow
that grades it with its own Action.

**Why:** three of the five rules check for exactly these files. Shipping a tool that
grades repositories on hygiene its own repository lacks is not a good look, and the
self-scan in CI is also the only test that exercises the real GitHub API, the
committed bundle and the runner protocol together — everything else mocks the
transport.
