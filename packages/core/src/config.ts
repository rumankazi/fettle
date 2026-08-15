/**
 * Configuration: the shipped defaults, and the parse/validate/merge pipeline that
 * turns a user's `.repohealth.yml` into settings the rules can consume.
 *
 * Defaults live here and only here — rules receive fully resolved settings and so
 * carry no fallbacks of their own.
 */

import { load as parseYaml, YAMLException } from 'js-yaml';
import { CONFIG_FILENAME } from './branding.js';
import type { ConfigInput, ResolvedConfig, RuleId } from './types.js';

/** The defaults from SCORING.md §5, applied when no `.repohealth.yml` is found. */
export const defaultConfig: ResolvedConfig = Object.freeze({
  version: 1,
  rules: Object.freeze({
    branch_protection: Object.freeze({ enabled: true, weight: 3 }),
    codeowners: Object.freeze({ enabled: true, weight: 1 }),
    dependency_updates: Object.freeze({ enabled: true, weight: 2 }),
    open_pr_count: Object.freeze({ enabled: true, weight: 1, good_at: 10, bad_at: 30 }),
    stale_prs: Object.freeze({
      enabled: true,
      weight: 2,
      good_at: 1,
      bad_at: 5,
      open_days: 21,
      inactive_days: 7,
    }),
  }),
}) as ResolvedConfig;

export const SUPPORTED_CONFIG_VERSION = 1;

/**
 * A configuration problem the user must fix before we can score anything.
 *
 * Per SCORING.md §5 these are hard failures; anything recoverable is a warning
 * instead, so a typo never silently changes someone's grade.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    /** Dotted path to the offending value, e.g. `rules.open_pr_count.bad_at`. */
    readonly path: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface ConfigResolution {
  config: ResolvedConfig;
  /** Non-fatal problems: unknown keys, unknown rule ids, unrecognised versions. */
  warnings: string[];
}

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const RULE_IDS = Object.keys(defaultConfig.rules) as RuleId[];

function isRuleId(key: string): key is RuleId {
  return (RULE_IDS as string[]).includes(key);
}

/**
 * Validates one rule's settings against the shape of its defaults.
 *
 * Using the defaults as the schema keeps the validator honest: a new setting is
 * recognised the moment it is given a default, and can never drift out of sync.
 */
function validateRuleSettings(ruleId: RuleId, input: unknown, warnings: string[]): Json {
  const path = `rules.${ruleId}`;

  if (!isPlainObject(input)) {
    throw new ConfigError(
      `${path} must be a mapping of settings, received ${describe(input)}`,
      path,
    );
  }

  const defaults = defaultConfig.rules[ruleId] as unknown as Json;
  const validated: Json = {};

  for (const [key, value] of Object.entries(input)) {
    const fieldPath = `${path}.${key}`;

    if (!(key in defaults)) {
      warnings.push(`${fieldPath} is not a recognised setting for '${ruleId}' and was ignored`);
      continue;
    }

    const expected = typeof defaults[key];
    if (typeof value !== expected) {
      throw new ConfigError(
        `${fieldPath} must be a ${expected}, received ${describe(value)}`,
        fieldPath,
      );
    }

    if (expected === 'number' && !Number.isFinite(value)) {
      throw new ConfigError(
        `${fieldPath} must be a finite number, received ${describe(value)}`,
        fieldPath,
      );
    }

    validated[key] = value;
  }

  return validated;
}

/** Checks the settings make sense together, once defaults have filled the gaps. */
function validateResolvedRule(ruleId: RuleId, settings: Json): void {
  const weight = settings.weight as number;
  if (weight < 0) {
    throw new ConfigError(
      `rules.${ruleId}.weight must not be negative, received ${weight}`,
      `rules.${ruleId}.weight`,
    );
  }

  if (!('good_at' in settings)) return;

  const goodAt = settings.good_at as number;
  const badAt = settings.bad_at as number;
  if (goodAt >= badAt) {
    throw new ConfigError(
      `rules.${ruleId}.good_at (${goodAt}) must be less than rules.${ruleId}.bad_at (${badAt})`,
      `rules.${ruleId}.bad_at`,
    );
  }

  for (const key of ['open_days', 'inactive_days'] as const) {
    if (key in settings && (settings[key] as number) < 0) {
      throw new ConfigError(
        `rules.${ruleId}.${key} must not be negative, received ${settings[key]}`,
        `rules.${ruleId}.${key}`,
      );
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (isPlainObject(value)) return 'a mapping';
  return `${typeof value} (${JSON.stringify(value)})`;
}

/**
 * Validates user input and merges it over the defaults.
 *
 * @throws {ConfigError} on any type or range error, quoting the offending path.
 */
export function resolveConfig(input?: ConfigInput | null): ConfigResolution {
  const warnings: string[] = [];

  if (input === undefined || input === null) {
    return { config: structuredClone(defaultConfig), warnings };
  }

  if (!isPlainObject(input)) {
    throw new ConfigError(`configuration must be a mapping, received ${describe(input)}`, '');
  }

  for (const key of Object.keys(input)) {
    if (key !== 'version' && key !== 'rules') {
      warnings.push(`${key} is not a recognised top-level key and was ignored`);
    }
  }

  if (input.version !== undefined) {
    if (typeof input.version !== 'number') {
      throw new ConfigError(
        `version must be a number, received ${describe(input.version)}`,
        'version',
      );
    }
    if (input.version !== SUPPORTED_CONFIG_VERSION) {
      warnings.push(
        `version ${input.version} is not recognised; interpreting this file as version ${SUPPORTED_CONFIG_VERSION}`,
      );
    }
  }

  const resolved = structuredClone(defaultConfig) as unknown as { version: number; rules: Json };

  if (input.rules !== undefined) {
    if (!isPlainObject(input.rules)) {
      throw new ConfigError(
        `rules must be a mapping of rule ids, received ${describe(input.rules)}`,
        'rules',
      );
    }

    for (const [key, value] of Object.entries(input.rules)) {
      if (!isRuleId(key)) {
        // Forward compatibility: a newer Fettle may know this rule, we do not.
        warnings.push(`rules.${key} is not a rule this version knows about and was ignored`);
        continue;
      }

      const overrides = validateRuleSettings(key, value, warnings);
      const merged = { ...(resolved.rules[key] as Json), ...overrides };
      validateResolvedRule(key, merged);
      resolved.rules[key] = merged;
    }
  }

  return { config: resolved as unknown as ResolvedConfig, warnings };
}

/**
 * Parses `.repohealth.yml` text and resolves it against the defaults.
 *
 * @throws {ConfigError} on malformed YAML or invalid settings.
 */
export function parseConfig(yamlText: string, source = CONFIG_FILENAME): ConfigResolution {
  let parsed: unknown;

  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    const detail = error instanceof YAMLException ? error.reason : String(error);
    throw new ConfigError(`${source} is not valid YAML: ${detail}`, '');
  }

  // An empty or comment-only file is a valid way to say "use the defaults".
  if (parsed === null || parsed === undefined) {
    return { config: structuredClone(defaultConfig), warnings: [] };
  }

  return resolveConfig(parsed as ConfigInput);
}

/**
 * Reads a config file by path, returning `null` when it does not exist.
 *
 * Inverting this dependency keeps `config.ts` free of both Octokit and `fs`: the
 * CLI supplies a filesystem reader, the Action supplies a repository reader, and
 * tests supply neither.
 */
export type ConfigReader = (path: string) => Promise<string | null>;

/** Loads config from `path`, falling back to the defaults when it is absent. */
export async function loadConfig(
  read: ConfigReader,
  path: string = CONFIG_FILENAME,
): Promise<ConfigResolution> {
  const contents = await read(path);

  if (contents === null) {
    return { config: structuredClone(defaultConfig), warnings: [] };
  }

  return parseConfig(contents, path);
}
