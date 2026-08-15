# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it through GitHub's private vulnerability reporting: go to the **Security**
tab → **Report a vulnerability**. If that is unavailable to you, contact the
maintainers listed in [.github/CODEOWNERS](.github/CODEOWNERS) directly.

Please include what you did, what happened, and what you expected. A proof of
concept helps but is not required to file a report.

You can expect an acknowledgement within a few working days and an assessment of
severity and a fix plan shortly after.

## What is in scope

Fettle reads from the GitHub API and writes a report. The interesting attack
surface is small but real:

- **Token handling.** The token is read from an input or `$GITHUB_TOKEN`, passed to
  Octokit, and never logged, written to the report, or sent anywhere except the
  configured GitHub API host. A path where a token could leak into the report, the
  job summary, a log line, or the `report-url` POST is a vulnerability.
- **Configuration parsing.** `.fettle.yml` is fetched from the repository being
  scanned, which may not be one you control. It is parsed with `js-yaml`'s safe
  `load` — no custom types, no code execution — and validated before use. A path
  where a hostile config file causes anything other than a clean error is a
  vulnerability.
- **Report content.** Evidence strings embed data from the scanned repository, such
  as ruleset names. They are escaped where they land in a markdown table. An
  injection into the job summary or a downstream consumer is a vulnerability.
- **The committed Action bundle.** `packages/action/dist/index.js` is executable
  code shipped to consumers. CI rebuilds it from source and fails if the committed
  copy differs, so a bundle that does not match its source is a vulnerability.

## What is not in scope

- The grades themselves. Fettle measures maintenance health, not security posture,
  and a repository scoring well says nothing about whether it is secure. Use
  [OSSF Scorecard](https://github.com/ossf/scorecard) for supply-chain security.
- Findings that require an attacker to already control the token you hand us, or
  the machine the scan runs on.

## Accepted advisories

`pnpm audit` runs weekly in CI and fails on `high` or above. A small number of
advisories are accepted rather than fixed, listed in `pnpm.auditConfig.ignoreGhsas`
in the root `package.json`. Each one is recorded here with why, and what would make
us revisit it. Nothing is accepted silently.

### GHSA-vrm6-8vpv-qv8q, GHSA-v9p9-hfj2-hcw8, GHSA-vxpw-j846-p89q — `undici` WebSocket client

`undici@5` reaches us four levels down: `@actions/core` → `@actions/http-client` →
`undici`. All three advisories are denial-of-service issues in undici's **WebSocket
client**.

**Why accepted:** we open no WebSocket. `@actions/http-client` is used by
`@actions/core` only for `getIDToken()`, which we never call, and our own HTTP goes
through Octokit and the platform `fetch`. The affected code is bundled but
unreachable.

**What is genuinely true and unresolved:** the code ships anyway.
`packages/action/dist/index.js` carries undici, `@actions/exec`, `@actions/io`,
`@fastify/busboy` and `tunnel` — around 750 kB of the 1 MB bundle — so that we can
use six functions from `@actions/core`: `getInput`, `setOutput`, `info`, `warning`,
`setFailed` and `summary`. Each is a thin wrapper over a documented runner protocol.

**Revisit when:** `@actions/core` ships a release depending on `undici >= 6.27.0`,
or we implement `ActionRuntime` against the runner protocol directly and drop the
dependency. The latter would remove this entry and roughly three quarters of the
bundle.

## Supported versions

Until v1.0.0, only the latest release is supported. After v1.0.0, security fixes
land on the current major.
