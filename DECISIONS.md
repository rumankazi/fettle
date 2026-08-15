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

## D24 — Releases are cut by release-please, not by tagging

Merging to `main` opens or updates a release pull request; merging _that_ is the
release. Nobody chooses a version number, and nobody pushes a tag.

**Why release-please over semantic-release:** semantic-release publishes on every
qualifying merge, which is fine for a library and wrong for a tool whose output is
a grade people gate builds on — a stray `feat:` should not silently change what
`@v1` resolves to. A release pull request makes the changelog and the version
visible before anything ships, and it is a place to put the rebuilt Action bundle.

**Why the release pull request needs its own workflow:** the version is baked into
`packages/action/dist/index.js`, so a version bump makes the committed bundle stale.
Release-please only edits text. `release-pr.yml` rebuilds the bundle on the release
branch, commits it, and then runs the full check suite, so what is verified is what
merges. CI skips its bundle-freshness check on those branches for exactly this
reason, and the publish job re-verifies at the tag.

**Why the pull request title is what matters:** merges are squashes, so the title
becomes the commit subject on `main`, which is release-please's only input. A title
that is not a Conventional Commit is a change that ships in no release, which is why
it is enforced rather than suggested.

## D25 — The release automation runs on a GitHub App token

`release.yml` mints a short-lived App installation token when `FETTLE_APP_ID` is
configured, and falls back to `GITHUB_TOKEN` with a warning when it is not.

**Why it is not optional in practice:** GitHub does not start a workflow run for
events caused by `GITHUB_TOKEN`, to stop workflows triggering themselves. The
release pull request that release-please opens is such an event, so with the default
token it arrives with no checks on it at all — including `release-pr.yml`, the one
that rebuilds the Action bundle for the new version. The release then fails at the
publish step, which re-verifies the bundle. An App-authored pull request is a normal
pull request and triggers everything.

The token is minted from the App's **Client ID**, not its App ID —
`actions/create-github-app-token` deprecated `app-id` in favour of `client-id`.

**Why an App rather than a personal access token:** the token lasts an hour, is
scoped to the repositories the App is installed on, carries only the permissions
granted to it, and is not tied to a person who might leave. A PAT is standing access
on a renewal reminder.

The fallback is kept so that a fresh clone of this repository works without any
setup, degrading to a `na` on `branch_protection` and release pull requests that
need a manual nudge, rather than failing outright.

## D26 — pnpm packs, npm publishes

The release job builds tarballs with `pnpm pack` and uploads them with
`npm publish <tarball>`, rather than using `pnpm publish`.

**Why:** each tool can do exactly one half of the job. pnpm is the only one that
rewrites `"@fettle/core": "workspace:*"` into a real version — publishing the raw
manifest would ship a package nobody can install. npm is the only one that performs
the OIDC exchange for trusted publishing. Packing with one and publishing with the
other gets both, and costs two lines.

Publishing is configured by `NPM_TRUSTED_PUBLISHING` (OIDC, preferred, no secret at
all) or `NPM_TOKEN` (a granular token), and skips with a warning when neither is
set so the rest of a release still completes. Trusted publishing needs npm ≥ 11.5.1
on Node ≥ 22.14.0, so the job switches to Node 24 just before publishing — every
check above that point runs on Node 20, the version the packages support.

## D27 — Renovate, not Dependabot

Dependency updates are Renovate's job, configured in `renovate.json5`. Dependabot's
version updates are switched off; its alerts stay on, because Renovate reads them to
raise security updates.

**Why one and not both:** they do the same job, so running both means two pull
requests per update, two review queues, and a merge race. Both were briefly enabled
here and Dependabot opened five pull requests while Renovate was still asking to be
configured.

**Why Renovate of the two:** three things it does that we wanted and Dependabot
cannot. It auto-merges natively, so the "enable auto-merge" workflow — which needed
an App token, because Dependabot-triggered workflows get a read-only one — is
deleted rather than maintained. It maintains commit-SHA pins for GitHub Actions via
`helpers:pinGitHubActionDigests`, which is the policy in D22 enforced rather than
remembered. And `dependencyDashboardApproval` holds major bumps behind a tick on an
issue, which matters here: the first week produced unannounced major bumps of two
runtime dependencies that ship inside the Action bundle.

The config is `.json5` so it can carry its reasoning inline — and, pleasingly, the
`dependency_updates` rule already looks for that filename.

## D28 — npm publishing is trusted publishing, because token publishing is closing

The release workflow supports a token, but the supported path is OIDC.

**Why:** the first token-based publish failed with `EOTP — This operation requires a
one-time password`, alongside npm's own notice that
[tokens which bypass 2FA are being restricted](https://gh.io/npm-gat-bypass2fa-deprecation)
for direct publishing. An account with two-factor authentication covering writes
cannot publish from CI with a token at all, because nothing in CI can answer the
prompt. The workarounds — weakening the account's 2FA, or a token that bypasses it —
both trade a real protection for convenience, on packages other people install.

Trusted publishing sidesteps it: npm authenticates _the workflow_ rather than an
account, so two-factor authentication is not part of the exchange, and no long-lived
credential exists to leak or rotate.

The token path stays in the workflow for accounts where 2FA does not cover writes,
and as the documented fallback — but `CONTRIBUTING.md` no longer presents it as the
easy option, because it is not.

**The consequence:** the first version of each package has to be published by hand,
since a trusted publisher can only be configured on a package that exists. That one
version lacks provenance. Everything after it is signed by the release workflow.

## D29 — The Action emits an SVG badge, not only a shields.io payload

`<output-dir>/badge/<repo>.svg` is written alongside the shields endpoint JSON, and
the README recommends the SVG.

**Why:** the shields.io route only works for public repositories on github.com.
shields fetches the endpoint file server-side, so a private repository's raw URL
gives it a 404 and a GitHub Enterprise Server host is not reachable from it at all
— which is precisely the environment `SPEC.md` aims this tool at. Documenting a
badge that cannot work for most of our users is worse than documenting none.

It also sat badly beside the invariant that no data leaves the user's environment.
The tool itself never phones home, but recommending a shields endpoint means every
reader of that README hands a third party the repository's name and grade.

The SVG is about sixty lines and one approximation: text width is estimated rather
than measured against real font metrics, because the alternative is shipping a
metrics table to place eleven characters. Being a pixel out moves text within its
box; it does not break the badge.
