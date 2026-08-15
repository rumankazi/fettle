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

None. `pnpm audit` runs weekly in CI and fails on `high` or above, with nothing on
an ignore list.

If that ever changes, each accepted advisory belongs here with why it is accepted
and what would make us revisit it, and its id in `pnpm.auditConfig.ignoreGhsas`.
Nothing is accepted silently.

## Supported versions

Until v1.0.0, only the latest release is supported. After v1.0.0, security fixes
land on the current major.
