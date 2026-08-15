/**
 * The rule registry.
 *
 * Adding a rule is: write the module, add its id to `RuleId`, add its defaults to
 * `defaultConfig`, and append it here. Registry order is report order — the schema
 * promises all rules, always, in this order.
 */

import { branchProtectionRule } from './branch-protection.js';
import { codeownersRule } from './codeowners.js';
import { dependencyUpdatesRule } from './dependency-updates.js';
import { openPrCountRule } from './open-pr-count.js';
import { disabled } from './result.js';
import { stalePrsRule } from './stale-prs.js';
import type { RepoContext, ResolvedRuleSettings, Rule, RuleId, RuleResult } from '../types.js';

/**
 * A registered rule with its per-id settings type erased.
 *
 * `register` is the single place that erasure happens, so no call site — here or in
 * a future rule — needs a cast to look up its own configuration.
 */
interface RegisteredRule {
  readonly id: RuleId;
  readonly kind: Rule['kind'];
  run(ctx: RepoContext, settings: ResolvedRuleSettings): RuleResult;
}

function register<Id extends RuleId>(rule: Rule<Id>): RegisteredRule {
  return {
    id: rule.id,
    kind: rule.kind,
    run: (ctx, settings) => rule.evaluate(ctx, settings[rule.id]),
  };
}

export const ruleRegistry: readonly RegisteredRule[] = [
  register(branchProtectionRule),
  register(codeownersRule),
  register(dependencyUpdatesRule),
  register(openPrCountRule),
  register(stalePrsRule),
];

/** Compile-time proof that the registry covers every declared rule id. */
type UnregisteredRuleIds = Exclude<
  RuleId,
  | typeof branchProtectionRule.id
  | typeof codeownersRule.id
  | typeof dependencyUpdatesRule.id
  | typeof openPrCountRule.id
  | typeof stalePrsRule.id
>;
const _everyRuleIsRegistered: [UnregisteredRuleIds] extends [never] ? true : false = true;
void _everyRuleIsRegistered;

/** Rule ids in report order. */
export const ruleOrder: readonly RuleId[] = ruleRegistry.map((rule) => rule.id);

/**
 * Runs every rule against one repository.
 *
 * `enabled: false` is handled here rather than inside each rule: it is scoring
 * policy, not rule logic, and a rule should never have to remember to check it.
 */
export function evaluateRules(ctx: RepoContext, settings: ResolvedRuleSettings): RuleResult[] {
  return ruleRegistry.map((rule) => {
    const ruleSettings = settings[rule.id];
    return ruleSettings.enabled ? rule.run(ctx, settings) : disabled(rule.id, ruleSettings);
  });
}
