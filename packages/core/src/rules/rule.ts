import type { Rule, RuleConfigMap, RuleId, RuleResult } from '../types.js';
import { evaluateBranchProtectionRule } from './branch-protection.js';
import { evaluateCodeownersRule } from './codeowners.js';
import { evaluateDependencyUpdatesRule } from './dependency-updates.js';
import { evaluateOpenPrCountRule } from './open-pr-count.js';
import { evaluateStalePrsRule } from './stale-prs.js';

export const rules: Rule[] = [
  {
    id: 'branch_protection',
    kind: 'boolean',
    evaluate: (ctx, cfg) =>
      evaluateBranchProtectionRule(ctx, cfg as RuleConfigMap['branch_protection']),
  },
  {
    id: 'codeowners',
    kind: 'boolean',
    evaluate: (ctx, cfg) => evaluateCodeownersRule(ctx, cfg as RuleConfigMap['codeowners']),
  },
  {
    id: 'dependency_updates',
    kind: 'boolean',
    evaluate: (ctx, cfg) =>
      evaluateDependencyUpdatesRule(ctx, cfg as RuleConfigMap['dependency_updates']),
  },
  {
    id: 'open_pr_count',
    kind: 'threshold',
    evaluate: (ctx, cfg) => evaluateOpenPrCountRule(ctx, cfg as RuleConfigMap['open_pr_count']),
  },
  {
    id: 'stale_prs',
    kind: 'threshold',
    evaluate: (ctx, cfg) => evaluateStalePrsRule(ctx, cfg as RuleConfigMap['stale_prs']),
  },
];

export const ruleOrder: RuleId[] = rules.map((rule) => rule.id);

export const ruleMap: Record<RuleId, Rule> = Object.fromEntries(
  rules.map((rule) => [rule.id, rule]),
) as Record<RuleId, Rule>;

export async function evaluateAllRules(
  ctx: Parameters<Rule['evaluate']>[0],
  config: RuleConfigMap,
): Promise<RuleResult[]> {
  const results = await Promise.all(
    rules.map(async (rule) => rule.evaluate(ctx, config[rule.id] as never)),
  );

  return results;
}
