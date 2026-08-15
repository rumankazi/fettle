/**
 * CLI argument parsing, rendering and exit codes.
 *
 * Kept separate from `index.ts` (the bin shim) so the whole command is testable as
 * a function: nothing here reads `process` directly or calls `process.exit`.
 */

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  assess,
  badgeFilename,
  buildBadgePayload,
  CONFIG_FILENAME,
  FLOOR_GRADES,
  meetsGradeFloor,
  parseConfig,
  renderMarkdown,
  TOOL_NAME,
  TOOL_VERSION,
  type AssessOptions,
  type BadgePayload,
  type ConfigInput,
  type FloorGrade,
  type Grade,
  type HealthReport,
} from '@fettle/core';

export const EXIT_OK = 0;
export const EXIT_BELOW_FLOOR = 1;
export const EXIT_USAGE = 2;
/** A repository or its configuration could not be read; nothing was graded. */
export const EXIT_SCAN_FAILED = 3;

const FORMATS = ['json', 'markdown', 'badge'] as const;
export type Format = (typeof FORMATS)[number];

export interface CliOptions {
  repos: string[];
  format: Format;
  failBelow?: FloorGrade;
  apiUrl?: string;
  /** A local config file; absent means each repository supplies its own. */
  configPath?: string;
  help: boolean;
  version: boolean;
}

/** A problem with how the command was invoked. Reported to stderr, exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `${TOOL_NAME} — grade the maintenance health of GitHub repositories

Usage:
  ${TOOL_NAME} --repos <org/name[,org/other]> [options]

Options:
  --repos <list>       Comma- or newline-separated repositories. Defaults to
                       $GITHUB_REPOSITORY when set.
  --format <format>    Output format: ${FORMATS.join(' | ')} (default: json).
  --fail-below <grade> Exit ${EXIT_BELOW_FLOOR} if any repository grades below this
                       floor: ${FLOOR_GRADES.join(' | ')}.
  --api-url <url>      GitHub API base URL for GitHub Enterprise Server.
                       Defaults to $GITHUB_API_URL, then https://api.github.com.
  --config <path>      Local config file to apply to every repository, instead of
                       reading ${CONFIG_FILENAME} from each one.
  --version            Print the version and exit.
  --help               Print this message and exit.

Authentication:
  Reads the token from $GITHUB_TOKEN.

Exit codes:
  ${EXIT_OK}  success
  ${EXIT_BELOW_FLOOR}  a repository graded below --fail-below
  ${EXIT_USAGE}  invalid usage
  ${EXIT_SCAN_FAILED}  a repository or its configuration could not be read`;

function splitRepoList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((repo) => repo.trim())
    .filter((repo) => repo.length > 0);
}

function assertRepoName(repo: string): void {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new UsageError(`'${repo}' is not a valid repository; expected the form org/name`);
  }
}

function oneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new UsageError(`--${flag} must be one of ${allowed.join(', ')}; received '${value}'`);
  }
  return value as T;
}

/**
 * Parses argv strictly: an unknown or misspelled flag is an error, never a silently
 * ignored one, because a swallowed `--fail-below` turns a gate into a no-op.
 */
export function parseCliOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): CliOptions {
  let parsed;
  // `npm run cli -- --repos …` and `pnpm cli -- --repos …` forward the separator
  // itself, and we take no positionals, so drop one leading `--`.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];

  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        repos: { type: 'string' },
        format: { type: 'string' },
        'fail-below': { type: 'string' },
        'api-url': { type: 'string' },
        config: { type: 'string' },
        version: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const { values } = parsed;
  const help = values.help === true;
  const version = values.version === true;

  const reposInput = values.repos ?? env.GITHUB_REPOSITORY;
  const repos = reposInput === undefined ? [] : splitRepoList(reposInput);

  if (!help && !version) {
    if (repos.length === 0) {
      throw new UsageError(
        'no repositories given; pass --repos org/name or set $GITHUB_REPOSITORY',
      );
    }
    repos.forEach(assertRepoName);
  }

  return {
    repos,
    format: values.format === undefined ? 'json' : oneOf(values.format, FORMATS, 'format'),
    failBelow:
      values['fail-below'] === undefined
        ? undefined
        : oneOf(values['fail-below'], FLOOR_GRADES, 'fail-below'),
    apiUrl: values['api-url'] ?? env.GITHUB_API_URL,
    configPath: values.config,
    help,
    version,
  };
}

/** Badge payloads keyed by repository, so multi-repo output stays valid JSON. */
export function renderBadges(report: HealthReport): Record<string, BadgePayload> {
  return Object.fromEntries(
    report.repos.map((repo) => [badgeFilename(repo.repo), buildBadgePayload(repo)]),
  );
}

export function render(report: HealthReport, format: Format): string {
  switch (format) {
    case 'json':
      return JSON.stringify(report, null, 2);
    case 'markdown':
      return renderMarkdown(report);
    case 'badge':
      return JSON.stringify(renderBadges(report), null, 2);
  }
}

function belowFloor(report: HealthReport, floor: FloorGrade): Grade[] {
  return report.repos.filter((repo) => !meetsGradeFloor(repo.grade, floor)).map((r) => r.grade);
}

/**
 * Performs the scan.
 *
 * Injected so the command can be tested without a network. The real
 * implementation is core's `assess`, which owns request pacing and concurrency —
 * the CLI's job is arguments, configuration, rendering and exit codes.
 */
export type Scanner = (repos: readonly string[], options: AssessOptions) => Promise<HealthReport>;

export interface RunOptions {
  argv: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  scan?: Scanner;
  now?: Date;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads the `--config` file, if one was given.
 *
 * A local file replaces each repository's own `.repohealth.yml`, which is how one
 * policy gets applied across a fleet.
 */
async function readLocalConfig(
  path: string | undefined,
  warn: (text: string) => void,
): Promise<ConfigInput | undefined> {
  if (path === undefined) return undefined;

  const contents = await readFile(path, 'utf8');
  const { config, warnings } = parseConfig(contents, path);
  for (const warning of warnings) warn(`${path}: ${warning}`);

  return config;
}

/** Runs the command and returns its exit code. Never throws for expected failures. */
export async function run(options: RunOptions): Promise<number> {
  const { stdout, stderr } = options;

  let cli: CliOptions;
  try {
    cli = parseCliOptions(options.argv, options.env ?? {});
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    stderr(`${TOOL_NAME}: ${error.message}\n\n${USAGE}\n`);
    return EXIT_USAGE;
  }

  if (cli.help) {
    stdout(`${USAGE}\n`);
    return EXIT_OK;
  }

  if (cli.version) {
    stdout(`${TOOL_NAME} ${TOOL_VERSION}\n`);
    return EXIT_OK;
  }

  const env = options.env ?? {};
  const warn = (text: string) => stderr(`${TOOL_NAME}: ${text}\n`);

  let config: ConfigInput | undefined;
  try {
    config = await readLocalConfig(cli.configPath, warn);
  } catch (error) {
    warn(describe(error));
    return EXIT_USAGE;
  }

  if (env.GITHUB_TOKEN === undefined) {
    warn(
      'no $GITHUB_TOKEN set; scanning anonymously. Private repositories will look missing and ' +
        'the rate limit is low.',
    );
  }

  let report: HealthReport;
  try {
    report = await (options.scan ?? assess)(cli.repos, {
      token: env.GITHUB_TOKEN,
      apiUrl: cli.apiUrl,
      config,
      now: options.now,
      onWarning: (repo, warning) => warn(`${repo}: ${warning}`),
    });
  } catch (error) {
    warn(describe(error));
    return EXIT_SCAN_FAILED;
  }

  stdout(`${render(report, cli.format)}\n`);

  if (cli.failBelow === undefined) return EXIT_OK;

  const failures = belowFloor(report, cli.failBelow);
  if (failures.length === 0) return EXIT_OK;

  stderr(
    `${TOOL_NAME}: ${failures.length} repository/repositories graded below ${cli.failBelow} ` +
      `(${failures.join(', ')})\n`,
  );
  return EXIT_BELOW_FLOOR;
}
