/**
 * CLI argument parsing, rendering and exit codes.
 *
 * Kept separate from `index.ts` (the bin shim) so the whole command is testable as
 * a function: nothing here reads `process` directly or calls `process.exit`.
 */

import { parseArgs } from 'node:util';
import {
  badgeFilename,
  buildBadgePayload,
  buildHealthReport,
  CONFIG_FILENAME,
  meetsGradeFloor,
  renderMarkdown,
  TOOL_NAME,
  TOOL_VERSION,
  type BadgePayload,
  type Grade,
  type HealthReport,
  type RepoAssessment,
} from '@fettle/core';

export const EXIT_OK = 0;
export const EXIT_BELOW_FLOOR = 1;
export const EXIT_USAGE = 2;

const FORMATS = ['json', 'markdown', 'badge'] as const;
export type Format = (typeof FORMATS)[number];

/** `N/A` is excluded: a floor of "no checks succeeded" is not a meaningful gate. */
const FLOOR_GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export type FloorGrade = (typeof FLOOR_GRADES)[number];

export interface CliOptions {
  repos: string[];
  format: Format;
  failBelow?: FloorGrade;
  apiUrl?: string;
  configPath: string;
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
  ${EXIT_USAGE}  invalid usage`;

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
    configPath: values.config ?? CONFIG_FILENAME,
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
 * Gathers the rule results for one repository.
 *
 * Injected so the command can be tested without a network, and so Phase 2 can drop
 * the real GitHub-backed implementation in without touching this file.
 */
export type Assessor = (repo: string, options: CliOptions) => Promise<RepoAssessment>;

const notImplemented: Assessor = async (repo) => {
  throw new Error(
    `cannot assess ${repo}: the GitHub fetch layer is not implemented yet (Phase 2). ` +
      `The scoring engine is usable today via the @fettle/core library.`,
  );
};

export interface RunOptions {
  argv: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  assess?: Assessor;
  now?: Date;
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

  const assess = options.assess ?? notImplemented;

  let assessments;
  try {
    assessments = await Promise.all(cli.repos.map((repo) => assess(repo, cli)));
  } catch (error) {
    stderr(`${TOOL_NAME}: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_USAGE;
  }

  const report = buildHealthReport(assessments, options.now);
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
