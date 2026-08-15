# ARCHITECTURE.md

## Monorepo layout (pnpm workspaces)

```
packages/
  core/                 # all logic lives here; zero Actions-specific code
    src/
      index.ts          # public exports: assess(), types, defaultConfig
      types.ts          # HealthReport, RuleResult, Config — the public contract
      config.ts         # load + merge: repo .fettle.yml → defaults; validation
      github/
        client.ts       # Octokit factory (baseUrl resolution, auth, retries)
        queries.ts      # the one GraphQL query for PR flow data
      rules/
        rule.ts         # Rule interface + registry
        branch-protection.ts
        codeowners.ts
        dependency-updates.ts
        open-pr-count.ts
        stale-prs.ts
      scoring.ts        # normalize → weight → aggregate → grade (SCORING.md)
      report.ts         # HealthReport assembly, markdown renderer, shields JSON
      branding.ts       # tool name/version constants (single rename point)
    test/fixtures/      # recorded API response shapes per rule
  cli/
    src/index.ts        # arg parsing (Node util.parseArgs — no CLI framework dep),
                        # token from env, calls core, prints/exits
  action/
    src/index.ts        # reads action inputs → core assess() → outputs, summary,
                        #   artifact file, optional report_url POST
    action.yml          # inputs/outputs/branding
    dist/index.js       # committed esbuild bundle (CI verifies it is up to date)
```

Dependency direction: `cli` and `action` depend on `core`. `core` depends on
nothing of theirs. Anything used by two packages lives in `core`.

## Rule interface (the extensibility seam)

```ts
type RuleStatus = 'pass' | 'fail' | 'na';

interface RuleResult {
  id: string;
  status: RuleStatus;
  score: number | null; // 0–100; null iff status === "na"
  weight: number; // resolved from config
  evidence: string; // human sentence: why this result
  details?: Record<string, unknown>; // machine-readable specifics
}

interface Rule {
  id: string;
  kind: 'boolean' | 'threshold';
  evaluate(ctx: RepoContext, cfg: ResolvedRuleConfig): Promise<RuleResult>;
}
```

`RepoContext` carries the Octokit instance, `owner/repo`, default branch, and the
pre-fetched PR flow data so rules never duplicate API calls. New rules register in
`rules/rule.ts`; config enables/disables and tunes them. Unknown rule ids in a
user's config are a validation warning, not an error (forward compatibility).

## Data flow

```
input repos[] ──► for each repo:
  1. resolve config   (.fettle.yml from target repo default branch, else defaults)
  2. fetch context    (repo metadata + one GraphQL PR query)
  3. run rules        (parallel; each returns RuleResult)
  4. score            (SCORING.md math)
──► HealthReport { schemaVersion, generatedAt, repos: [...], fleet summary }
──► sinks: stdout | file | GITHUB_STEP_SUMMARY | shields JSON | report_url POST
```

## GitHub API strategy

- **REST (Octokit)** for cheap point lookups: repo metadata, branch protection /
  rulesets, CODEOWNERS existence (check `.github/`, root, `docs/` — in that order),
  Dependabot config (`.github/dependabot.yml`), Renovate config (check the
  documented config file locations; note in evidence that app-installed Renovate
  with central config may be undetectable — report `pass` on file found, else
  `fail` with that caveat in evidence).
- **GraphQL, one query** for PR flow: open PR count + per-PR `createdAt` and last
  commit `committedDate` (`commits(last: 1)`), paginated at 100. REST here would be
  N+1 (one call per PR for its last commit) — that is why GraphQL is mandatory for
  the two threshold rules and forbidden-by-laziness nowhere else.
- Budget: ≤ ~10 requests per repo for typical repos. Use conditional requests /
  handle secondary rate limits with Octokit's retry+throttling plugins.

## GHES support

- Base URL: use `GITHUB_API_URL` env when present (Actions runners set it on both
  github.com and GHES); CLI flag `--api-url` overrides; default
  `https://api.github.com`.
- GraphQL endpoint differs on GHES (`<host>/api/graphql` vs `/api/v3` for REST) —
  Octokit handles this given the right baseUrl; verify in an integration note.
- Feature-detect, don't version-sniff: if an endpoint 404s/410s on older GHES, the
  affected rule returns `na` with evidence "not supported by this GitHub Enterprise
  version".

## Token permissions (encode this in README and in evidence strings)

- Default `GITHUB_TOKEN` covers: CODEOWNERS, dependency configs, PR data.
- Reading branch protection / rulesets requires repo **administration: read**. With
  a default token the `branch_protection` rule must return `na` — evidence: "token
  lacks administration:read; grant it or supply a PAT/App token to unlock this
  check". Attempt the modern rulesets endpoint first, fall back to legacy branch
  protection endpoint, then `na`.
- Never treat a 403 as `fail` — a permission error is not evidence of poor health.

## Action design

- Inputs: `repos` (newline/comma list, default: current repo), `token`
  (default `${{ github.token }}`), `config-path` (default `.fettle.yml`),
  `fail-below` (optional grade floor, e.g. `C`), `report-url` (optional POST),
  `output-dir` (default `fettle-report/`).
- Outputs: `grade`, `score`, `report-path`.
- Writes: `report.json`, `badge/<repo>.json` (shields endpoint schema), markdown to
  `GITHUB_STEP_SUMMARY`.
- The Action never uploads artifacts itself; README shows pairing with
  `actions/upload-artifact` (keeps our dep surface zero and lets users choose
  retention).

## Distribution

- Action: committed `dist/`, tagged releases, `v1` floating major tag, Marketplace
  listing after Phase 4.
- CLI + core: npm packages under one scope. CLI runnable via `npx`.
