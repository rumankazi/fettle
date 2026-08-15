export type RuleStatus = 'pass' | 'fail' | 'na' | 'disabled';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';

export type RuleId =
  'branch_protection' | 'codeowners' | 'dependency_updates' | 'open_pr_count' | 'stale_prs';

export interface RuleResult {
  id: RuleId;
  status: RuleStatus;
  score: number | null;
  weight: number;
  evidence: string;
  details?: Record<string, unknown>;
}

export interface PullRequestInfo {
  id?: string;
  createdAt?: string;
  lastCommitAt?: string;
  draft?: boolean;
}

export interface PrFlowContext {
  openPrCount: number;
  stalePrCount: number;
  prs: PullRequestInfo[];
}

export interface BranchProtectionInfo {
  enabled?: boolean;
  permissionDenied?: boolean;
  source?: 'ruleset' | 'legacy' | 'unknown';
}

export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  octokit: unknown;
  files?: string[];
  branchProtection?: BranchProtectionInfo;
  prFlow?: PrFlowContext;
}

export interface RuleThresholdConfig {
  enabled?: boolean;
  weight?: number;
  good_at?: number;
  bad_at?: number;
  open_days?: number;
  inactive_days?: number;
}

export interface BooleanRuleConfig {
  enabled?: boolean;
  weight?: number;
}

export type RuleConfigMap = {
  branch_protection: BooleanRuleConfig;
  codeowners: BooleanRuleConfig;
  dependency_updates: BooleanRuleConfig;
  open_pr_count: RuleThresholdConfig;
  stale_prs: RuleThresholdConfig;
};

export interface RepoHealthConfig {
  version?: number;
  rules: RuleConfigMap;
}

export interface Rule<TConfig = unknown> {
  id: RuleId;
  kind: 'boolean' | 'threshold';
  evaluate: (ctx: RepoContext, cfg: TConfig) => RuleResult | Promise<RuleResult>;
}

export interface RepoReport {
  repo: string;
  defaultBranch: string;
  score: number | null;
  grade: Grade;
  rules: RuleResult[];
}

export interface FleetSummary {
  repoCount: number;
  averageScore: number | null;
  grades: Record<string, number>;
}

export interface HealthReport {
  schemaVersion: 1;
  tool: {
    name: string;
    version: string;
  };
  generatedAt: string;
  repos: RepoReport[];
  fleet: FleetSummary;
}
