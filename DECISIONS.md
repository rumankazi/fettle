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

> **Superseded by D32.** Octokit's throttling plugin was removed; nothing paces
> requests now.

Octokit's throttling plugin routes every GraphQL request — including read-only
queries like ours — through a one-per-second limiter shared across the process.

**Why not work around it:** the pacing is the plugin doing its job, and a
maintenance-health scan is not latency-sensitive. The consequence is documented on
`GitHubClientOptions.throttle` because it is the real ceiling on fleet throughput:
one repository per second, whatever `maxConcurrency` says. Tests disable throttling
rather than serialise on it.

## D17 — The Action bundle carries a `createRequire` banner

> **Superseded by D35.** `@actions/core` was the only CommonJS dependency (D30) and
> is gone, so the banner was removed along with it.

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

> **Amended by D34.** The first implementation escaped pipes but not backslashes,
> which left the hole it was written to close.

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

## D30 — `@actions/core` was removed rather than upgraded

`packages/action/src/runtime.ts` implements the runner protocol directly. The
Action has no runtime dependency on `@actions/core`.

**Why:** it brought `@actions/exec`, `@actions/io`, `@actions/http-client`,
`tunnel`, `@fastify/busboy` and `undici` with it — roughly three quarters of the
bundle shipped to consumers, and three high-severity advisories in WebSocket code
this project never calls — in exchange for six functions. Upgrading to v3 would have
cleared the advisories, but not the surface: every one of those packages is
executable code we hand to anyone who uses the Action, and none of it is reachable.

The six replacements are documented file and stdout conventions, about eighty lines
in total, which is the test the dependency budget already sets. The bundle went from
1.0 MB to 236 kB and `SECURITY.md` no longer has an accepted-advisories section —
`pnpm audit` passes with nothing on an ignore list.

Replacing a well-tested library with our own code earns its own tests, so
`runtime.test.ts` covers the parts that fail silently rather than loudly: the
`$GITHUB_OUTPUT` heredoc and its delimiter, input name mapping, and command
escaping — a newline in evidence from a scanned repository must not be able to
forge a workflow command.

## D31 — Badges are published to a branch, not committed to the default branch

`health.yml` pushes both badge files to an orphan `badges` branch, and the README
points at the raw URL rather than a relative path.

**Why:** a relative path is tidier and is what the README recommends first — but it
requires the badge to be committed to the default branch, and a ruleset requiring
pull requests stops a workflow doing that. This repository has exactly such a
ruleset, so it is also the worked example for the fallback. Both approaches are
documented, with the constraint that decides between them stated rather than left
to be discovered.

GitHub serves `.svg` from `raw.githubusercontent.com` as `image/svg+xml`, so the
absolute form renders in a README without shields.io in the path.

## D32 — Both Octokit plugins were removed, leaving two runtime dependencies

`@octokit/plugin-throttling` and `@octokit/plugin-retry` are gone. Retrying is a
`hook.wrap` in `client.ts`; nothing paces requests. `@fettle/core` depends on
`@octokit/core` and `js-yaml`, and nothing else.

**What prompted it:** Socket flagged the published packages for using `eval` and for
a dependency unmaintained for more than five years. Both were `bottleneck@2.19.5`,
published in 2019. My first trace blamed `plugin-throttling`; it was wrong —
`plugin-retry` pulls `bottleneck` too, and removing only the first changed nothing.

**Why removing them was right anyway.** `plugin-retry` is eighty-seven lines, of
which the retry decision is about fifteen: try again on anything that is not a 4xx,
with quadratic backoff. It uses `bottleneck` purely as a scheduler. The dependency
budget in `CONTRIBUTING.md` asks whether a dependency can be replaced by thirty lines
of our own code, and here the honest answer was yes — the same test that removed
`@actions/core`.

`plugin-throttling` had its own cost. It paced every request through the same
`bottleneck`, GraphQL included, so a fleet scan could not exceed roughly one
repository per second — for a workload making eight requests per repository at a
concurrency of four, nowhere near a secondary rate limit. D14 had already capped its
waiting at sixty seconds because sleeping through a primary rate limit hangs a job
for an hour; removing it finishes the thought.

**What changed behaviourally:** a rate-limited 403 is no longer waited out. It ends
that check as `na` carrying the reset time, which is what the fetch layer already
did once the wait cap was hit. Transport failures and 5xx are retried, three times,
backing off 1s, 4s, 8s.

The Action bundle went from 236 kB to 176 kB.

## D33 — Node 20 stays the floor, and CI tests both ends of the range

> **Superseded by D35.** The floor moved to Node 22.

`engines` remains `>=20` and the Action's `runs.using` remains `node20`. CI's
`verify` job runs on Node 20 and 24.

**Why not raise it,** given Node 20 reached end of life on 30 April 2026: the Action
does not ship a Node runtime. The runner supplies it, so an unpatched Node 20 is
GitHub's problem to fix in the runner image, not something we hand to a user. What we
would be buying by moving to `node24` is nothing, and what we would be risking is
GitHub Enterprise Server — GHES bundles its own runner versions and lags github.com,
and `SPEC.md` commits to supporting it. GitHub's own documentation lists `node20` and
`node24` side by side with no deprecation notice.

The same reasoning holds `engines` at `>=20`: raising it while `runs.using` is
`node20` would claim not to support the runtime we actually execute on.

**What was wrong and is now fixed:** CI tested only Node 20 while the release job
publishes from Node 24 and contributors run whatever they have. Testing one version
and shipping across a range is how a version-specific break reaches a user. The
matrix covers the floor and the current active LTS.

**Revisit when** GHES ships a runner that supports `node24` in a release we are happy
to make the minimum. That is a single-line change to `action.yml`, plus the matrix.

**Amended:** the matrix also runs Node 26, the newest release. Nothing pins us to it,
but it is the version people will upgrade to next, and a break found there costs a
rebase rather than a hotfix. It is also what this project is developed on, so leaving
it out of CI meant the version most exercised by hand was the one never exercised
automatically.

## D34 — Escape backslashes before pipes, and the order is the point

`escapeMarkdown` escapes `\` first, then `|`, then flattens newlines.

**Why:** D20 claimed a scanned repository could not restructure a report about
itself. It could. Escaping only pipes turned `a\|b` into `a\\|b`, where `\\`
renders as one literal backslash and frees the pipe after it to end the cell. A
repository that can name a ruleset could add a column. CodeQL's
`js/incomplete-sanitization` found it — "this does not escape backslash characters
in the input" — on code written specifically to prevent that class of problem.

The test counts cell boundaries in every rendered row and compares them to the
header, rather than asserting on the escaped string. It fails against the old
implementation, which is the only reason to trust it.

**The wider lesson:** the bundled Action is scanned by CodeQL as if it were our own
source, because it is committed. That is noisy — dependency code we cannot fix shows
up as our alerts — but it caught a real bug in `report.ts` and a supply-chain
regression in `@octokit/core` v7 that `pnpm audit`, Socket and Snyk all passed. Worth
the noise; `dist/` stays in scope.

## D35 — Node 22 is the floor, and the Action runs on node24

`engines` is `>=22`, `runs.using` is `node24`, the bundle targets `node24`, and CI
runs 22, 24 and 26.

**What forced the question:** pnpm 11 requires Node `>=22.13`, so a Node 20 test leg
and pnpm 11 cannot coexist. That is a development-tool constraint and does not by
itself justify dropping a supported runtime — but Node 20 reached end of life on
30 April 2026, so the honest answer was to stop claiming it rather than to work
around the symptom.

D33 argued for keeping `node20` because the runner supplies that Node, making its
end of life GitHub's problem rather than ours. That still holds in isolation. What it
did not weigh is the cost of a floor that every tool in the chain is walking away
from: keeping it means holding pnpm back, and then the next thing, indefinitely.

**What it costs:** GitHub Enterprise Server bundles its own runner versions and lags
github.com, so an instance whose runner predates `node24` support can no longer run
the Action. `SPEC.md` commits to GHES, so this is the real price and it is worth
being plain about. Instances that old are already outside GitHub's own support
window, which is why it is acceptable rather than free.

**Kept coherent deliberately.** `engines`, `runs.using` and the esbuild target now
say the same thing, and a test asserts the last two agree — the previous version
pinned `runs.using` to a literal, which is what made it possible for them to drift
apart in the first place.

The `createRequire` banner went too. `@actions/core` was the only CommonJS
dependency, and the bundle loads without it; CI runs the built artefact on every
pull request, which is what would catch a regression.

## D36 — A terminal format that is CLI-only, and default only in a terminal

`json`, `markdown` and `badge` are contracts: something downstream parses, renders or
polls them. A person reading their own scan in a terminal is not a contract, and
serving them JSON by default made the common interactive case the worst-looking one.

So `pretty` exists, and lives in `packages/cli`, not `packages/core`. Core builds the
report; how a terminal draws it is not report-building, and putting it there would
have implied the Action and library should render it too. They should not — the
Action writes to a job summary, and a library consumer has the report object.

**Default by destination, not by flag.** `--format` is now optional: a TTY gets
`pretty`, a pipe or redirect gets `json`. `fettle --repos ... > report.json` keeps
working with no flag, and `fettle --repos ...` typed by hand is readable. An explicit
`--format` always wins. The seam is an `isTty` field on the run options rather than a
read of `process.stdout` inside the renderer, so the default is testable.

**Colour is written by hand.** A dozen escape codes did not justify a dependency in
a tool that ships its own bundle, and `NO_COLOR`/`FORCE_COLOR` are twenty lines.
Status is a word — `ok`, `FAIL`, `n/a`, `off` — not a hue, so the output survives
being piped, pasted into an issue, or read by someone who cannot distinguish red from
green.

**Free to change.** Because nothing parses it, `pretty` is explicitly outside the
schema stability promise in `SPEC.md`. That is the point of keeping it out of core.

## D37 — `--gh-host`, and an error that names the flag

Reported from a real enterprise VDI: `npx fettle --repos org/repo` timed out
connecting to `api.github.com`, and the message said only that. Everything about the
resolution order was working as designed — nothing was configured, so it used
github.com — and the design was still wrong, because the user had no way to learn
that from what they were shown.

Two changes. `--gh-host`/`$GH_HOST` accepts a bare hostname, matching what the `gh`
CLI already takes, so the common case is `--gh-host ghe.acme.com` rather than
remembering that the API hangs off `/api/v3`. And `resolveApiUrl` now returns _where_
the URL came from, so a connection failure against an unconfigured github.com can say
"no API URL was configured, so this used github.com" and name the flags.

**The discriminator is the absence of `error.response`, not of `error.status`.**
Octokit gives transport failures a synthetic `status: 500`, so keying on the status
would have attached the enterprise hint to genuine server errors. A test covers that
case specifically, because it is the kind of thing that reads as correct.

**Debug is stderr, always.** `--debug`/`$FETTLE_DEBUG` logs the resolved host and
every request with status and timing. It goes to stderr so `--format json` stays
pipeable with debug on, and it logs the request URL rather than its headers — the
headers are where the token is. A test asserts the token does not appear.

## D38 — `dependency_updates` accepts Renovate's dependency dashboard

The rule's own comment used to admit the hole: "a Renovate app driving this repo from
a central config reads as a `fail`". That is not an edge case. Organisations commonly
run one Renovate operator against a shared preset, and their repositories hold no
`renovate.json` at all — so a scan told them their dependency updates were unmanaged
when Renovate had been raising PRs against them for a year.

The signal such a repository does give off is Renovate's dependency dashboard issue.
So the rule now takes either: a config file, or an open issue whose title contains
"dependency dashboard".

**The file wins.** It is the direct evidence, it is already fetched, and it decides
the result even when the issues could not be read at all. Only when there is no file
do the issues matter.

**Not found is not the same as could not look.** With no file and no readable issue
list, the rule is `na`, not `fail` — we cannot distinguish a repository with no
dependency updates from one configured centrally, and a check we could not run is
never evidence of poor health (SCORING.md §3). The `na` evidence names
`issues:read`.

**Title match, not author match.** `dependencyDashboardTitle` is configurable and
organisations do customise it, so the match is a case-insensitive substring rather
than the exact default. Author is _reported_, not required: Renovate self-hosted runs
under an App on one instance and a machine user on the next, so demanding a `Bot`
author would reintroduce the same false negative one layer down. A human-authored
issue called "Dependency Dashboard" therefore passes — the evidence says who opened
it and marks a non-app author, which is the invariant that every result explains
itself doing the work instead.

**One page of issues, by GraphQL.** REST's issue list returns pull requests as
issues, so a repository with 100 busy PRs could bury the dashboard; the GraphQL
connection returns issues only. It is not paginated: Renovate rewrites the dashboard
body on every run, so on a working setup it sits at the top of `UPDATED_AT DESC`, and
walking further would cost a request per page on every repository to change the
answer on almost none. When more issues exist than were examined, the fail evidence
says so rather than claiming certainty the request did not buy.

**Costs one request per repository**, taking a typical scan from 7 to 8. The budget
in ARCHITECTURE.md is about ten, and the request-budget test asserts the new number
rather than the bound alone.

**This changes grades.** Repositories covered by a central Renovate go from `fail` to
`pass` on a weight-2 rule. That is the point, and it is why this is a `feat`. No
report field was renamed or removed, so `schemaVersion` is unchanged, but
`details.path` is now absent on a pass detected from the dashboard — a new
`details.source` of `config` or `dashboard` says which signal fired, and SCORING.md
§6 documents both.

**Verified in the wild, and it changed the design.** Searching for repositories with
an open dashboard and no config file found real ones, and the dashboards were opened
by `alex-ocmbot` and `glencoe-renovate` — neither is `renovate[bot]`. Matching on the
bot login, which was the first instinct, would have missed both. Checking
`vitest-dev/vitest` also confirmed the ordering assumption: its dashboard is issue
#957 and still came back inside one page of `UPDATED_AT DESC`.

**Found a latent test-harness bug.** Every GraphQL request goes to `POST /graphql`,
and the test transport keyed handlers by route alone — so the second query silently
consumed the first query's stubs, and a pagination test that asserted PRs `[1, 2, 3]`
started returning `[1, 3]` while still looking like it passed for the right reason.
Handlers may now name the operation (`POST /graphql FettleOpenIssues`), with the bare
route as a fallback.

## D39 — A grade is withheld when too little of the repository could be read

Asked whether the tool tells a user what permission they are missing, the answer was
"yes, in every message" — and then the same check showed a token with only
`contents:read` producing `score: 0.0`, `grade: F`, and a badge reading `F (0.0)` in
red. One rule of five was scoreable. The arithmetic was correct and the output was a
lie: it described the token, not the repository.

**The floor is coverage, not rule count.** `coverage = scored weight / applicable
weight`, and below `0.5` the score is `null` and the grade `N/A`. This generalises
the rule that was already there — all-`na` was simply `coverage = 0` — rather than
adding a second concept. `0.5` was chosen so the ordinary case survives:
`branch_protection` is weight 3 of 9 and goes `na` on the default `GITHUB_TOKEN`,
which leaves `0.667`.

Withholding the aggregate fixes three things at once, which is why it beat the
alternative of annotating the `F`. `N/A` never trips `--fail-below`, so a token
problem stops failing builds. Badges go grey instead of red. And a reader who sees
`N/A` goes looking for why, where an `F` looks like an answer.

Nothing is actually lost: every individual rule score is still in `rules[]`, and the
new `coverage` object states exactly what the withheld aggregate would have been
based on. Consumers wanting the old behaviour can compute it.

**`disabled` rules leave the denominator too.** Turning a rule off changes what full
coverage means; it does not cost you coverage. Otherwise disabling three of five
rules would suppress your own grade.

## D40 — The needed permission is data, not prose

The evidence has always named the permission. It was only ever a sentence, so
nothing could group by it, and a narrow token printed `pull_requests:read` twice —
once for `open_pr_count`, once for `stale_prs` — with the fix truncated off the end
of both.

`ProbeUnavailable` now carries an optional `needs`, `unavailable()` takes it as a
second argument, and `notApplicable` copies it onto `details.needs`. The permission
strings live in one `PERMISSION` constant so the prose and the field cannot drift.

`needs` is deliberately absent where no grant would help — an exhausted rate limit,
an endpoint an older GHES does not expose. Those stay one group per rule, because
their reasons genuinely differ and a merged group would carry one reason that was
wrong for the rest.

**The blocked section stopped truncating.** It exists to tell someone how to fix
their token and it was cutting off the half that said what to do
(`administration:read,…`). It now wraps. The rule table still truncates, because it
is a table and alignment is what makes it scannable — a different job, a different
answer. Wrapping needed a hard break for words longer than the line, which a test
caught with a 400-character evidence string that produced a 406-character line.
