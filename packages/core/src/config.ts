import type { RepoHealthConfig, RuleConfigMap } from './types.js';

export const defaultConfig: RepoHealthConfig = {
  version: 1,
  rules: {
    branch_protection: {
      enabled: true,
      weight: 3,
    },
    codeowners: {
      enabled: true,
      weight: 1,
    },
    dependency_updates: {
      enabled: true,
      weight: 2,
    },
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
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override as T;
  }

  const merged = { ...base } as Record<string, unknown>;

  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      merged[key] = deepMerge(baseValue, value);
    } else {
      merged[key] = value;
    }
  }

  return merged as T;
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, deepClone(nestedValue)]),
    ) as T;
  }

  return value;
}

export function resolveConfig(source?: Partial<RepoHealthConfig>): RepoHealthConfig {
  if (!source) {
    return deepClone(defaultConfig);
  }

  return deepMerge(defaultConfig, source) as RepoHealthConfig;
}

export function getRuleConfigMap(config: Partial<RepoHealthConfig> = {}): RuleConfigMap {
  return resolveConfig(config).rules;
}
