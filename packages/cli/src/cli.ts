import { assess, buildBadgePayload, type RepoReport } from '@fettle/core';
import { parseArgs as parseNodeArgs } from 'node:util';

export type Format = 'json' | 'markdown' | 'badge';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';

export interface CliArgs {
  repos: string[];
  format: Format;
  failBelow?: Grade;
  apiUrl?: string;
  configPath?: string;
  help?: boolean;
}

export interface RunCliOptions {
  argv?: string[];
  repos?: string[];
  format?: Format;
  failBelow?: Grade;
  apiUrl?: string;
  configPath?: string;
  env?: Record<string, string | undefined>;
  stdout?: { write: (chunk: string) => void | Promise<void> };
  assessFn?: (repo: string, config?: unknown) => Promise<RepoReport>;
}

export function parseArgs(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): CliArgs {
  const parsed = parseNodeArgs({
    strict: false,
    allowPositionals: true,
    options: {
      repos: { type: 'string' },
      format: { type: 'string' },
      'fail-below': { type: 'string' },
      'api-url': { type: 'string' },
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    args: argv,
  });

  const reposInput =
    typeof parsed.values.repos === 'string'
      ? parsed.values.repos
      : typeof env.GITHUB_REPOSITORY === 'string'
        ? env.GITHUB_REPOSITORY
        : 'example/demo';
  const repos = String(reposInput)
    .split(/[\n,]+/)
    .map((repo) => repo.trim())
    .filter(Boolean);

  const formatValue =
    typeof parsed.values.format === 'string' ? parsed.values.format.toLowerCase() : 'json';
  const failBelowValue =
    typeof parsed.values['fail-below'] === 'string' ? parsed.values['fail-below'] : undefined;

  return {
    repos,
    format: ['json', 'markdown', 'badge'].includes(formatValue) ? (formatValue as Format) : 'json',
    failBelow:
      failBelowValue && ['A', 'B', 'C', 'D', 'F', 'N/A'].includes(failBelowValue)
        ? (failBelowValue as Grade)
        : undefined,
    apiUrl:
      typeof parsed.values['api-url'] === 'string' ? parsed.values['api-url'] : env.GITHUB_API_URL,
    configPath: typeof parsed.values.config === 'string' ? parsed.values.config : undefined,
    help: Boolean(parsed.values.help),
  };
}

export function renderJson(report: RepoReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderMarkdown(report: RepoReport): string {
  const header = [
    `# Fettle report`,
    '',
    `## ${report.repo}`,
    '',
    `- **Default branch:** ${report.defaultBranch}`,
    `- **Grade:** ${report.grade}`,
    `- **Score:** ${report.score ?? 'N/A'}`,
    '',
    '| Rule | Status | Score | Weight | Evidence |',
    '| --- | --- | ---: | ---: | --- |',
  ];

  const rows = report.rules.map((rule) => {
    const evidenceText = String(rule.evidence ?? '').replace(/\|/g, '\\|');
    return `| ${rule.id} | ${rule.status} | ${rule.score ?? 'N/A'} | ${rule.weight} | ${evidenceText} |`;
  });

  return [...header, ...rows].join('\n');
}

export function renderBadge(report: RepoReport): string {
  return JSON.stringify(buildBadgePayload(report), null, 2);
}

function gradeOrder(grade: Grade | undefined): number {
  const order: Record<string, number> = {
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    F: 1,
    'N/A': 0,
  };
  return order[grade ?? 'N/A'] ?? 0;
}

export async function runCli(
  options: RunCliOptions = {},
): Promise<{ exitCode: number; output: string }> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const parsed = parseArgs(argv, env);
  const repos = options.repos ?? parsed.repos;
  const format = options.format ?? parsed.format;
  const failBelow = options.failBelow ?? parsed.failBelow;
  const configPath = options.configPath ?? parsed.configPath;
  const stdout = options.stdout ?? process.stdout;
  const assessFn =
    options.assessFn ?? (async (repo: string, config?: unknown) => assess(repo, config as never));

  if (parsed.help) {
    const usage = [
      'Usage: fettle --repos org/a,org/b --format json|markdown|badge [--api-url <url>] [--config <path>] [--fail-below <grade>]',
      '',
      'Options:',
      '  --repos <list>      Comma or newline separated GitHub repositories',
      '  --format <format>   Output format: json, markdown, badge',
      '  --fail-below <grade> Exit 1 when any repo grade is below this threshold',
      '  --api-url <url>     Override the GitHub API base URL',
      '  --config <path>     Local config file path',
      '  --help              Show this help message',
    ].join('\n');

    await stdout.write(`${usage}\n`);
    return { exitCode: 0, output: usage + '\n' };
  }

  const results = await Promise.all(
    repos.map(async (repo) => {
      const config = configPath ? { configPath } : undefined;
      return assessFn(repo, config);
    }),
  );

  let output = '';
  if (format === 'json') {
    output = JSON.stringify(results, null, 2);
  } else if (format === 'markdown') {
    output = results.map((report) => renderMarkdown(report)).join('\n\n');
  } else {
    output = results.map((report) => renderBadge(report)).join('\n\n');
  }

  await stdout.write(`${output}\n`);

  const threshold = failBelow ? gradeOrder(failBelow) : null;
  const exitCode =
    threshold === null || results.every((report) => gradeOrder(report.grade) >= threshold) ? 0 : 1;

  return { exitCode, output };
}

export async function main(): Promise<number> {
  const result = await runCli();
  return result.exitCode;
}
