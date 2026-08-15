import type { RepoContext, RuleResult, RuleThresholdConfig } from '../types.js';

const standardCodeownersLocations = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

export function evaluateCodeownersRule(
  ctx: RepoContext,
  config: RuleThresholdConfig = {},
): RuleResult {
  const weight = config.weight ?? 1;
  const files = ctx.files ?? [];

  if (config.enabled === false) {
    return {
      id: 'codeowners',
      status: 'disabled',
      score: null,
      weight,
      evidence: 'CODEOWNERS check disabled by policy',
      details: { enabled: false },
    };
  }

  const found = standardCodeownersLocations.some((location) => files.includes(location));

  if (found) {
    return {
      id: 'codeowners',
      status: 'pass',
      score: 100,
      weight,
      evidence: 'CODEOWNERS file found in a standard location',
      details: { locations: standardCodeownersLocations },
    };
  }

  return {
    id: 'codeowners',
    status: 'fail',
    score: 0,
    weight,
    evidence: 'No CODEOWNERS file found in a standard location',
    details: { checkedLocations: standardCodeownersLocations },
  };
}
