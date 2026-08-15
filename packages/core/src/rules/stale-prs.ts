import type { RepoContext, RuleResult, RuleThresholdConfig } from '../types.js';
import { evaluateThresholdRule } from './branch-protection.js';

export function evaluateStalePrsRule(
  ctx: RepoContext,
  config: RuleThresholdConfig = {},
): RuleResult {
  const value = ctx.prFlow?.stalePrCount ?? 0;
  return evaluateThresholdRule('stale_prs', value, config, 'Stale PR count');
}
