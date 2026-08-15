import { describe, expect, it } from 'vitest';
import { aggregateRepoScore, gradeFromScore, thresholdScore } from '../src/scoring.js';
import type { RuleResult } from '../src/types.js';

describe('threshold scoring', () => {
  it('matches the spec curves at the worked example values', () => {
    expect(thresholdScore(14, 10, 30)).toBe(80);
    expect(thresholdScore(2, 1, 5)).toBe(75);
  });

  it('gives the exact worked-example aggregate and grade', () => {
    const rules: RuleResult[] = [
      { id: 'branch_protection', status: 'na', score: null, weight: 3, evidence: 'not available' },
      { id: 'codeowners', status: 'pass', score: 100, weight: 1, evidence: 'ok' },
      { id: 'dependency_updates', status: 'fail', score: 0, weight: 2, evidence: 'no config' },
      { id: 'open_pr_count', status: 'pass', score: 80, weight: 1, evidence: 'open pr count okay' },
      { id: 'stale_prs', status: 'pass', score: 75, weight: 2, evidence: 'stale prs okay' },
    ];

    expect(aggregateRepoScore(rules)).toBe(55);
    expect(gradeFromScore(aggregateRepoScore(rules))).toBe('F');
  });

  it('applies grade bands correctly including the 80 boundary', () => {
    expect(gradeFromScore(80)).toBe('B');
    expect(gradeFromScore(79.9)).toBe('C');
    expect(gradeFromScore(null)).toBe('N/A');
  });
});
