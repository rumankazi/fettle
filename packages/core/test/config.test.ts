import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  defaultConfig,
  loadConfig,
  parseConfig,
  resolveConfig,
} from '../src/config.js';

describe('defaultConfig', () => {
  it('matches the defaults published in SCORING.md §5', () => {
    expect(defaultConfig).toEqual({
      version: 1,
      rules: {
        branch_protection: { enabled: true, weight: 3 },
        codeowners: { enabled: true, weight: 1 },
        dependency_updates: { enabled: true, weight: 2 },
        open_pr_count: { enabled: true, weight: 1, good_at: 10, bad_at: 30 },
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

  it('is frozen, so one caller cannot mutate the defaults out from under another', () => {
    expect(Object.isFrozen(defaultConfig)).toBe(true);
    expect(Object.isFrozen(defaultConfig.rules.stale_prs)).toBe(true);
  });
});

describe('resolveConfig', () => {
  it('returns the defaults when given nothing', () => {
    expect(resolveConfig().config).toEqual(defaultConfig);
    expect(resolveConfig(null).config).toEqual(defaultConfig);
  });

  it('returns a copy, never the shared defaults object', () => {
    const { config } = resolveConfig();
    config.rules.codeowners.weight = 42;
    expect(defaultConfig.rules.codeowners.weight).toBe(1);
  });

  it('deep-merges a partial override, leaving untouched settings at their defaults', () => {
    const { config, warnings } = resolveConfig({
      rules: { open_pr_count: { good_at: 5 }, codeowners: { weight: 4 } },
    });

    expect(config.rules.open_pr_count).toEqual({
      enabled: true,
      weight: 1,
      good_at: 5,
      bad_at: 30,
    });
    expect(config.rules.codeowners).toEqual({ enabled: true, weight: 4 });
    expect(warnings).toEqual([]);
  });

  it('warns but continues on an unknown top-level key', () => {
    const { config, warnings } = resolveConfig({ nonsense: true } as never);
    expect(warnings).toEqual(['nonsense is not a recognised top-level key and was ignored']);
    expect(config).toEqual(defaultConfig);
  });

  it('warns but continues on an unknown rule id, so newer configs stay readable', () => {
    const { warnings } = resolveConfig({ rules: { deployment_recency: { weight: 2 } } } as never);
    expect(warnings).toEqual([
      'rules.deployment_recency is not a rule this version knows about and was ignored',
    ]);
  });

  it('warns but continues on an unknown setting within a known rule', () => {
    const { config, warnings } = resolveConfig({
      rules: { codeowners: { good_at: 3 } },
    } as never);

    expect(warnings).toEqual([
      "rules.codeowners.good_at is not a recognised setting for 'codeowners' and was ignored",
    ]);
    expect(config.rules.codeowners).toEqual({ enabled: true, weight: 1 });
  });

  it('warns on an unrecognised version rather than refusing to run', () => {
    const { warnings } = resolveConfig({ version: 2 });
    expect(warnings[0]).toContain('version 2 is not recognised');
  });

  it.each([
    [
      'a wrong scalar type',
      { rules: { codeowners: { weight: 'heavy' } } },
      'rules.codeowners.weight',
    ],
    [
      'a wrong boolean type',
      { rules: { codeowners: { enabled: 'yes' } } },
      'rules.codeowners.enabled',
    ],
    ['a non-mapping rule body', { rules: { codeowners: [1, 2] } }, 'rules.codeowners'],
    ['a non-mapping rules block', { rules: 'all' }, 'rules'],
    ['a non-numeric version', { version: 'one' }, 'version'],
  ])('hard-fails on %s, quoting the offending path', (_label, input, path) => {
    expect(() => resolveConfig(input as never)).toThrow(ConfigError);
    try {
      resolveConfig(input as never);
    } catch (error) {
      expect((error as ConfigError).path).toBe(path);
      expect((error as ConfigError).message).toContain(path);
    }
  });

  it('hard-fails when good_at is not below bad_at', () => {
    expect(() => resolveConfig({ rules: { open_pr_count: { good_at: 30 } } })).toThrow(
      /good_at \(30\) must be less than rules.open_pr_count.bad_at \(30\)/,
    );
  });

  it('hard-fails on a negative weight', () => {
    expect(() => resolveConfig({ rules: { codeowners: { weight: -1 } } })).toThrow(ConfigError);
  });

  it('hard-fails on a non-finite number', () => {
    expect(() => resolveConfig({ rules: { codeowners: { weight: Number.NaN } } })).toThrow(
      ConfigError,
    );
  });

  it('accepts a zero weight, which mutes a rule without hiding it', () => {
    expect(
      resolveConfig({ rules: { codeowners: { weight: 0 } } }).config.rules.codeowners.weight,
    ).toBe(0);
  });
});

describe('parseConfig', () => {
  it('parses the documented example file', () => {
    const { config, warnings } = parseConfig(`
version: 1
rules:
  branch_protection:
    enabled: false
  stale_prs:
    good_at: 0
    bad_at: 3
    inactive_days: 14
`);

    expect(warnings).toEqual([]);
    expect(config.rules.branch_protection.enabled).toBe(false);
    expect(config.rules.stale_prs).toEqual({
      enabled: true,
      weight: 2,
      good_at: 0,
      bad_at: 3,
      open_days: 21,
      inactive_days: 14,
    });
  });

  it('treats an empty or comment-only file as "use the defaults"', () => {
    expect(parseConfig('').config).toEqual(defaultConfig);
    expect(parseConfig('# nothing to see here\n').config).toEqual(defaultConfig);
  });

  it('hard-fails on malformed YAML, naming the file', () => {
    expect(() => parseConfig('rules: [unclosed', '.repohealth.yml')).toThrow(
      /\.repohealth\.yml is not valid YAML/,
    );
  });
});

describe('loadConfig', () => {
  it('falls back to the defaults when the file does not exist', async () => {
    const { config, warnings } = await loadConfig(async () => null);
    expect(config).toEqual(defaultConfig);
    expect(warnings).toEqual([]);
  });

  it('reads the configured path', async () => {
    const seen: string[] = [];
    const { config } = await loadConfig(async (path) => {
      seen.push(path);
      return 'rules:\n  codeowners:\n    weight: 5\n';
    }, 'custom/path.yml');

    expect(seen).toEqual(['custom/path.yml']);
    expect(config.rules.codeowners.weight).toBe(5);
  });
});
