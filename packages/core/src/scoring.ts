import type { Grade, RuleResult } from './types.js';

export function thresholdScore(value: number, goodAt: number, badAt: number): number {
  if (value <= goodAt) {
    return 100;
  }

  if (value >= badAt) {
    return 0;
  }

  return Number(((100 * (badAt - value)) / (badAt - goodAt)).toFixed(1));
}

export function aggregateRepoScore(rules: RuleResult[]): number | null {
  const eligible = rules.filter((rule) => rule.status !== 'na' && rule.status !== 'disabled');

  if (eligible.length === 0) {
    return null;
  }

  const denominator = eligible.reduce((sum, rule) => sum + rule.weight, 0);
  const numerator = eligible.reduce((sum, rule) => sum + (rule.score ?? 0) * rule.weight, 0);

  if (denominator === 0) {
    return null;
  }

  return Number((numerator / denominator).toFixed(1));
}

export function gradeFromScore(score: number | null): Grade {
  if (score === null) {
    return 'N/A';
  }

  if (score >= 90) {
    return 'A';
  }

  if (score >= 80) {
    return 'B';
  }

  if (score >= 70) {
    return 'C';
  }

  if (score >= 60) {
    return 'D';
  }

  return 'F';
}
