import { describe, expect, it } from 'vitest';
import { defaultConfig, resolveConfig } from '../src/config.js';

describe('default config', () => {
  it('matches the shipped defaults from the spec', () => {
    expect(defaultConfig).toMatchObject({
      version: 1,
      rules: {
        branch_protection: { enabled: true, weight: 3 },
        codeowners: { enabled: true, weight: 1 },
        dependency_updates: { enabled: true, weight: 2 },
        open_pr_count: {
          enabled: true,
          weight: 1,
          good_at: 10,
          bad_at: 30,
        },
        stale_prs: {
          enabled: true,
          weight: 2,
          good_at: 1,
          bad_at: 5,
          open_days: 21,
          inactive_days: 7,
        },
      },
    });
  });

  it('deep-merges local overrides without mutating defaults', () => {
    const merged = resolveConfig({
      rules: {
        codeowners: { weight: 4 },
        open_pr_count: { good_at: 5 },
      },
    });

    expect(merged.rules.codeowners.weight).toBe(4);
    expect(merged.rules.open_pr_count.good_at).toBe(5);
    expect(defaultConfig.rules.codeowners.weight).toBe(1);
  });
});
