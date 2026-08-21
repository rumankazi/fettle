/**
 * The public data contract.
 *
 * `HealthReport` and everything reachable from it is the published API (SCORING.md
 * §6): after v1, changes must be additive, and anything else requires bumping
 * `schemaVersion`.
 */

export type RuleStatus = 'pass' | 'fail' | 'na' | 'disabled';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';
export type RuleKind = 'boolean' | 'threshold';

export type RuleId =
  'branch_protection' | 'codeowners' | 'dependency_updates' | 'open_pr_count' | 'stale_prs';

export interface RuleResult {
  id: RuleId;
  status: RuleStatus;
  /** 0-100 rounded to 1 decimal; `null` if and only if status is `na` or `disabled`. */
  score: number | null;
  weight: number;
  /** A human sentence explaining this result without reference to our source code. */
  evidence: string;
  details?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Settings are modelled in two shapes: `*Input` is what a user may write in
 * `.fettle.yml` (every field optional), and `Resolved*` is what rules receive
 * (every field present). Rules therefore never carry their own default fallbacks —
 * defaults live in exactly one place, `config.ts`.
 */

export interface BooleanRuleSettings {
  enabled: boolean;
  weight: number;
}

export interface ThresholdRuleSettings extends BooleanRuleSettings {
  good_at: number;
  bad_at: number;
}

export interface StalePrsRuleSettings extends ThresholdRuleSettings {
  open_days: number;
  inactive_days: number;
}

export interface ResolvedRuleSettings {
  branch_protection: BooleanRuleSettings;
  codeowners: BooleanRuleSettings;
  dependency_updates: BooleanRuleSettings;
  open_pr_count: ThresholdRuleSettings;
  stale_prs: StalePrsRuleSettings;
}

export interface ResolvedConfig {
  version: number;
  rules: ResolvedRuleSettings;
}

export type RuleSettingsInput = {
  [Id in RuleId]?: Partial<ResolvedRuleSettings[Id]>;
};

export interface ConfigInput {
  version?: number;
  rules?: RuleSettingsInput;
}

/* -------------------------------------------------------------------------- */
/* Repository context                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of one piece of data-gathering.
 *
 * This is how the "rules degrade to `na`, never crash" invariant is enforced
 * structurally rather than by convention: a rule cannot read a value without first
 * handling the unavailable case, and the `reason` it must surface is the evidence
 * string the user reads.
 */
export type Probe<T> = { readonly available: true; readonly value: T } | ProbeUnavailable;

export interface ProbeUnavailable {
  readonly available: false;
  /** Why the data is missing, phrased as user-facing evidence with a fix where one exists. */
  readonly reason: string;
  /**
   * The token permission that would unlock this, e.g. `issues:read`.
   *
   * Structured rather than left to be read back out of `reason`, so the report can
   * group blocked checks by the one grant that fixes them. Absent when no
   * permission would help — an exhausted rate limit, or an endpoint a GHES version
   * does not have.
   */
  readonly needs?: string;
}

export interface BranchProtection {
  /** Whether the default branch is covered by a ruleset or a legacy protection rule. */
  protected: boolean;
  /** Which API answered, so evidence can name it. */
  source: 'ruleset' | 'legacy';
  /** Identifying detail for the evidence string, e.g. a ruleset name. */
  description: string;
}

export interface PullRequestData {
  /** Open pull requests, drafts included; rules filter per SCORING.md §2. */
  items: readonly PullRequestSummary[];
  /**
   * True when the repository has more open pull requests than the fetcher was
   * willing to page through. Counts are then a lower bound, and rules say so.
   */
  truncated: boolean;
}

export interface PullRequestSummary {
  number: number;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the last commit, or `null` when the PR has no commits. */
  lastCommitAt: string | null;
  isDraft: boolean;
}

/**
 * Everything the rules are allowed to see.
 *
 * Deliberately pure data with no Octokit handle: all I/O happens in the fetch layer,
 * so every rule is a pure function of (context, settings) and needs no mocking to
 * test. See DECISIONS.md.
 */
/**
 * Renovate's dependency dashboard issue, when one is open.
 *
 * Its presence is the only signal a repository gives off when Renovate is driven
 * by a central, org-level configuration and so has no config file of its own.
 */
export interface DependencyDashboard {
  number: number;
  title: string;
  url: string;
  /** The account that opened it; `null` if that account has since been deleted. */
  author: string | null;
  /** Whether the author is an App rather than a person. */
  authorIsBot: boolean;
}

/**
 * The outcome of looking for a dependency dashboard.
 *
 * `truncated` sits here rather than on the dashboard because it matters most when
 * nothing was found: it is the difference between "this repository has no
 * dashboard" and "no dashboard was among the issues we looked at".
 */
export interface DependencyDashboardSearch {
  dashboard: DependencyDashboard | null;
  truncated: boolean;
}

export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** Evaluation instant, injected so date-sensitive rules are deterministic. */
  now: Date;
  /** Paths confirmed to exist in the repo, among the locations the fetcher probed. */
  existingPaths: Probe<readonly string[]>;
  branchProtection: Probe<BranchProtection>;
  pullRequests: Probe<PullRequestData>;
  dependencyDashboard: Probe<DependencyDashboardSearch>;
}

/**
 * The extensibility seam. Rules are synchronous and pure — the context is
 * pre-fetched, so there is no I/O left for a rule to await.
 */
export interface Rule<Id extends RuleId = RuleId> {
  readonly id: Id;
  readonly kind: RuleKind;
  evaluate(ctx: RepoContext, settings: ResolvedRuleSettings[Id]): RuleResult;
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How much of the repository could actually be graded.
 *
 * Without this, a token that can read almost nothing produces a confident-looking
 * `F` — the weighted average is honest about the checks it ran and silent about
 * the ones it could not (SCORING.md §3).
 */
export interface Coverage {
  /** Rules that produced a score. */
  scoredRules: number;
  /** Rules that could have produced one, so excluding `disabled`. */
  totalRules: number;
  scoredWeight: number;
  totalWeight: number;
  /** `scoredWeight / totalWeight`, or `0` when nothing was applicable. */
  ratio: number;
}

export interface RepoReport {
  repo: string;
  defaultBranch: string;
  /**
   * Weighted aggregate rounded to 1 decimal. `null` when too little of the
   * repository could be read to stand behind a number (SCORING.md §3).
   */
  score: number | null;
  grade: Grade;
  /** What the score is based on. Always present, even when `score` is `null`. */
  coverage: Coverage;
  /** One entry per rule, always all of them, in registry order. */
  rules: RuleResult[];
}

export interface FleetSummary {
  repoCount: number;
  averageScore: number | null;
  grades: Partial<Record<Grade, number>>;
}

export interface HealthReport {
  schemaVersion: 1;
  tool: { name: string; version: string };
  /** ISO-8601 timestamp. */
  generatedAt: string;
  repos: RepoReport[];
  fleet: FleetSummary;
}

/** Shields.io endpoint payload (SCORING.md §6). */
export interface BadgePayload {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}
