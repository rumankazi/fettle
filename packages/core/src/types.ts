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
 * `.repohealth.yml` (every field optional), and `Resolved*` is what rules receive
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
}

export interface BranchProtection {
  /** Whether the default branch is covered by a ruleset or a legacy protection rule. */
  protected: boolean;
  /** Which API answered, so evidence can name it. */
  source: 'ruleset' | 'legacy';
  /** Identifying detail for the evidence string, e.g. a ruleset name. */
  description: string;
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
export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** Evaluation instant, injected so date-sensitive rules are deterministic. */
  now: Date;
  /** Paths confirmed to exist in the repo, among the locations the fetcher probed. */
  existingPaths: Probe<readonly string[]>;
  branchProtection: Probe<BranchProtection>;
  /** All open pull requests, drafts included; rules filter per SCORING.md §2. */
  pullRequests: Probe<readonly PullRequestSummary[]>;
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

export interface RepoReport {
  repo: string;
  defaultBranch: string;
  /** Weighted aggregate rounded to 1 decimal; `null` when every rule was excluded. */
  score: number | null;
  grade: Grade;
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
