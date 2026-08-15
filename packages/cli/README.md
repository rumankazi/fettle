# @fettle/cli

Command-line interface for [Fettle](https://github.com/rumankazi/fettle) — grade the
maintenance health of GitHub repositories.

```bash
export GITHUB_TOKEN=...
npx @fettle/cli --repos vitest-dev/vitest --format markdown
```

```
fettle --repos acme/api,acme/web --format json > report.json
fettle --repos acme/api --fail-below C            # exit 1 if it grades below C
fettle --repos acme/api --api-url https://ghe.acme.com/api/v3
```

Exit codes: `0` success, `1` graded below `--fail-below`, `2` invalid usage, `3` a
repository or its configuration could not be read.

Run `fettle --help` for all flags. Full documentation:
[github.com/rumankazi/fettle](https://github.com/rumankazi/fettle).
