import { describe, expect, it } from 'vitest';
import {
  aggregateRepoScore,
  gradeFromScore,
  meetsGradeFloor,
  thresholdScore,
} from '../src/scoring.js';
import type { RuleResult } from '../src/types.js';

function result(overrides: Partial<RuleResult> & Pick<RuleResult, 'id'>): RuleResult {
  return { status: 'pass', score: 100, weight: 1, evidence: 'because', ...overrides };
}

describe('thresholdScore', () => {
  it('scores 100 at or below good_at', () => {
    expect(thresholdScore(0, 10, 30)).toBe(100);
    expect(thresholdScore(10, 10, 30)).toBe(100);
  });

  it('scores 0 at or above bad_at', () => {
    expect(thresholdScore(30, 10, 30)).toBe(0);
    expect(thresholdScore(99, 10, 30)).toBe(0);
  });

  it('interpolates linearly between the thresholds', () => {
    expect(thresholdScore(14, 10, 30)).toBe(80);
    expect(thresholdScore(20, 10, 30)).toBe(50);
    expect(thresholdScore(2, 1, 5)).toBe(75);
  });

  it('rounds to one decimal', () => {
    expect(thresholdScore(4, 1, 6)).toBe(40);
    expect(thresholdScore(2, 0, 3)).toBe(33.3);
  });

  it('rejects thresholds that would divide by zero', () => {
    expect(() => thresholdScore(5, 10, 10)).toThrow(RangeError);
    expect(() => thresholdScore(5, 30, 10)).toThrow(RangeError);
  });
});

describe('aggregateRepoScore', () => {
  it('reproduces the SCORING.md §7 worked example exactly', () => {
    const rules: RuleResult[] = [
      result({ id: 'branch_protection', status: 'na', score: null, weight: 3 }),
      result({ id: 'codeowners', status: 'pass', score: 100, weight: 1 }),
      result({ id: 'dependency_updates', status: 'fail', score: 0, weight: 2 }),
      result({ id: 'open_pr_count', status: 'fail', score: 80, weight: 1 }),
      result({ id: 'stale_prs', status: 'fail', score: 75, weight: 2 }),
    ];

    expect(aggregateRepoScore(rules)).toBe(55);
    expect(gradeFromScore(aggregateRepoScore(rules))).toBe('F');
  });

  it('excludes na and disabled rules from both sums', () => {
    const withExclusions = aggregateRepoScore([
      result({ id: 'codeowners', score: 100, weight: 1 }),
      result({ id: 'branch_protection', status: 'na', score: null, weight: 99 }),
      result({ id: 'dependency_updates', status: 'disabled', score: null, weight: 99 }),
    ]);

    expect(withExclusions).toBe(100);
  });

  it('returns null when every rule was excluded', () => {
    expect(
      aggregateRepoScore([
        result({ id: 'codeowners', status: 'na', score: null }),
        result({ id: 'stale_prs', status: 'disabled', score: null }),
      ]),
    ).toBeNull();
  });

  it('returns null for an empty rule list', () => {
    expect(aggregateRepoScore([])).toBeNull();
  });

  it('returns null when every scored rule carries zero weight', () => {
    expect(aggregateRepoScore([result({ id: 'codeowners', weight: 0 })])).toBeNull();
  });

  it('rejects a scored rule with no score rather than silently treating it as zero', () => {
    expect(() =>
      aggregateRepoScore([result({ id: 'codeowners', status: 'pass', score: null })]),
    ).toThrow(TypeError);
  });

  it('rounds the aggregate to one decimal', () => {
    expect(
      aggregateRepoScore([
        result({ id: 'codeowners', score: 100, weight: 1 }),
        result({ id: 'stale_prs', status: 'fail', score: 0, weight: 2 }),
      ]),
    ).toBe(33.3);
  });
});

describe('gradeFromScore', () => {
  it('takes the higher grade at every band boundary', () => {
    expect(gradeFromScore(90)).toBe('A');
    expect(gradeFromScore(80)).toBe('B');
    expect(gradeFromScore(70)).toBe('C');
    expect(gradeFromScore(60)).toBe('D');
  });

  it('drops a grade just below each boundary', () => {
    expect(gradeFromScore(89.9)).toBe('B');
    expect(gradeFromScore(79.9)).toBe('C');
    expect(gradeFromScore(69.9)).toBe('D');
    expect(gradeFromScore(59.9)).toBe('F');
  });

  it('grades an unscoreable repo N/A', () => {
    expect(gradeFromScore(null)).toBe('N/A');
  });
});

describe('meetsGradeFloor', () => {
  it('passes at or above the floor', () => {
    expect(meetsGradeFloor('A', 'C')).toBe(true);
    expect(meetsGradeFloor('C', 'C')).toBe(true);
  });

  it('fails below the floor', () => {
    expect(meetsGradeFloor('D', 'C')).toBe(false);
    expect(meetsGradeFloor('F', 'A')).toBe(false);
  });

  it('never trips the floor on N/A, which is not evidence of poor health', () => {
    expect(meetsGradeFloor('N/A', 'A')).toBe(true);
  });
});
