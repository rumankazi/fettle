# SCORING.md — Normative Scoring Specification

This document is the source of truth for the math. Implement exactly; the worked
example at the bottom doubles as a required unit test.

## 1. Rule scores

**Boolean rules** (`branch_protection`, `codeowners`, `dependency_updates`):

```
pass → 100
fail → 0
na   → excluded (see §3)
```

**Threshold rules** (`open_pr_count`, `stale_prs`) use a piecewise-linear clamp on
the raw value `x` with two configured thresholds, `good_at < bad_at`:

```
score(x) = 100                                    if x ≤ good_at
         = 0                                      if x ≥ bad_at
         = 100 · (bad_at − x) / (bad_at − good_at)  otherwise
```

Round rule scores to 1 decimal. No other curve shapes exist in v1.

## 2. Rule definitions (raw values)

- `open_pr_count`: x = number of open, non-draft PRs at scan time.
- `stale_prs`: x = number of PRs that are open, non-draft, `createdAt` older than
  `open_days` (default 21) AND whose last commit `committedDate` is older than
  `inactive_days` (default 7). Draft PRs are excluded from both counts (a draft is
  declared work-in-progress, not neglect).

## 3. Aggregation and `na` renormalization

```
repoScore = Σ (weightᵢ · scoreᵢ) / Σ weightᵢ     over rules with status ≠ na
```

Rules with status `na` contribute to neither numerator nor denominator — a repo is
never penalized or rewarded for a check we could not run. If ALL rules are `na`,
`repoScore` is `null` and `grade` is `"N/A"`. Round `repoScore` to 1 decimal.

## 4. Grade bands

```
A ≥ 90   B ≥ 80   C ≥ 70   D ≥ 60   F < 60
```

Boundary values take the higher grade (exactly 80.0 → B). No plus/minus in v1.

## 5. Default configuration (shipped in core, used when no .repohealth.yml found)

```yaml
# .repohealth.yml — all fields optional; these are the defaults
version: 1
rules:
  branch_protection:
    enabled: true
    weight: 3
  codeowners:
    enabled: true
    weight: 1
  dependency_updates:
    enabled: true
    weight: 2
  open_pr_count:
    enabled: true
    weight: 1
    good_at: 10 # ≤ 10 open PRs → 100
    bad_at: 30 # ≥ 30 open PRs → 0
  stale_prs:
    enabled: true
    weight: 2
    good_at: 1 # ≤ 1 stale PR tolerated → 100
    bad_at: 5 # ≥ 5 stale PRs → 0
    open_days: 21 # PR older than this is a staleness candidate…
    inactive_days: 7 # …and stale if last commit is older than this
```

Config resolution: fetch `.repohealth.yml` from the scanned repo's default branch;
deep-merge over defaults; validate (unknown keys → warning; type errors → hard fail
with a message quoting the offending path). `enabled: false` behaves exactly like
`na` for scoring (excluded from both sums) but is reported with status `disabled`.

## 6. Report schema (`schemaVersion: 1`) — the public contract

```jsonc
{
  "schemaVersion": 1,
  "tool": { "name": "repohealth", "version": "1.0.0" },
  "generatedAt": "2026-08-15T09:30:00Z",
  "repos": [
    {
      "repo": "org/name",
      "defaultBranch": "main",
      "score": 78.6,
      "grade": "C",
      "rules": [
        {
          "id": "branch_protection",
          "status": "pass", // pass | fail | na | disabled
          "score": 100, // null when na/disabled
          "weight": 3,
          "evidence": "Ruleset 'main-protection' active on default branch",
          "details": { "source": "ruleset" },
        },
        // … one entry per rule, always all five, in registry order
      ],
    },
  ],
  "fleet": { "repoCount": 1, "averageScore": 78.6, "grades": { "C": 1 } },
}
```

Shields endpoint JSON per repo (written alongside):

```json
{ "schemaVersion": 1, "label": "repo health", "message": "C (78.6)", "color": "yellow" }
```

Colors: A `brightgreen`, B `green`, C `yellow`, D `orange`, F `red`, N/A `lightgrey`.

## 7. Worked example (required test case)

Config = defaults. Repo state: branch protection unreadable (default token → `na`),
CODEOWNERS present (`pass`), no Dependabot/Renovate config (`fail`), 14 open
non-draft PRs, 2 stale PRs.

```
branch_protection  na    → excluded
codeowners         pass  → 100        weight 1
dependency_updates fail  → 0          weight 2
open_pr_count      x=14  → 100·(30−14)/(30−10) = 80.0   weight 1
stale_prs          x=2   → 100·(5−2)/(5−1)     = 75.0   weight 2

repoScore = (1·100 + 2·0 + 1·80 + 2·75) / (1+2+1+2) = 330 / 6 = 55.0
grade     = F
```

The report must additionally tell this user that granting administration:read
would unlock the highest-weighted check — actionability is part of the spec.
