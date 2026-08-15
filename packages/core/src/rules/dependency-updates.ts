import type { RepoContext, RuleResult, RuleThresholdConfig } from '../types.js';

const dependencyConfigLocations = [
  '.github/dependabot.yml',
  '.github/dependabot.yaml',
  'renovate.json',
  'renovate.json5',
  '.github/renovate.json',
  '.github/renovate.json5',
];

export function evaluateDependencyUpdatesRule(
  ctx: RepoContext,
  config: RuleThresholdConfig = {},
): RuleResult {
  const weight = config.weight ?? 2;
  const files = ctx.files ?? [];

  if (config.enabled === false) {
    return {
      id: 'dependency_updates',
      status: 'disabled',
      score: null,
      weight,
      evidence: 'dependency updates check disabled by policy',
      details: { enabled: false },
    };
  }

  const found = dependencyConfigLocations.some((location) => files.includes(location));

  if (found) {
    return {
      id: 'dependency_updates',
      status: 'pass',
      score: 100,
      weight,
      evidence: 'Dependabot or Renovate configuration has been detected',
      details: { checkedLocations: dependencyConfigLocations },
    };
  }

  return {
    id: 'dependency_updates',
    status: 'fail',
    score: 0,
    weight,
    evidence: 'No Dependabot or Renovate configuration detected',
    details: { checkedLocations: dependencyConfigLocations },
  };
}
