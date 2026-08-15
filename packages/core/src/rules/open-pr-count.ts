import type { RepoContext, RuleResult, RuleThresholdConfig } from '../types.js';
import { evaluateThresholdRule } from './branch-protection.js';

export function evaluateOpenPrCountRule(
  ctx: RepoContext,
  config: RuleThresholdConfig = {},
): RuleResult {
  const value = ctx.prFlow?.openPrCount ?? 0;
  return evaluateThresholdRule('open_pr_count', value, config, 'Open PR count');
}
