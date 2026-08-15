import { describe, expect, it } from 'vitest';
import type { RepoAssessment, RuleResult } from '@fettle/core';
import {
  EXIT_BELOW_FLOOR,
  EXIT_OK,
  EXIT_USAGE,
  parseCliOptions,
  run,
  UsageError,
  type Assessor,
} from '../src/cli.js';

const GENERATED_AT = new Date('2026-08-15T09:30:00.000Z');

function rules(score: number): RuleResult[] {
  return [{ id: 'codeowners', status: 'pass', score, weight: 1, evidence: 'CODEOWNERS found.' }];
}

/** Returns a fixed score per repository, so the command is testable without a network. */
function assessorFor(scores: Record<string, number>): Assessor {
  return async (repo): Promise<RepoAssessment> => ({
    repo,
    defaultBranch: 'main',
    rules: rules(scores[repo] ?? 100),
  });
}

async function invoke(argv: string[], overrides: Partial<Parameters<typeof run>[0]> = {}) {
  let stdout = '';
  let stderr = '';

  const exitCode = await run({
    argv,
    env: {},
    now: GENERATED_AT,
    assess: assessorFor({}),
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
    ...overrides,
  });

  return { exitCode, stdout, stderr };
}

describe('parseCliOptions', () => {
  it('parses a comma-separated repo list', () => {
    expect(parseCliOptions(['--repos', 'org/a,org/b']).repos).toEqual(['org/a', 'org/b']);
  });

  it('parses a newline-separated repo list, as an Action input would supply', () => {
    expect(parseCliOptions(['--repos', 'org/a\norg/b\n']).repos).toEqual(['org/a', 'org/b']);
  });

  it('ignores the leading separator that npm and pnpm forward', () => {
    expect(parseCliOptions(['--', '--repos', 'org/a']).repos).toEqual(['org/a']);
  });

  it('falls back to $GITHUB_REPOSITORY', () => {
    expect(parseCliOptions([], { GITHUB_REPOSITORY: 'org/current' }).repos).toEqual([
      'org/current',
    ]);
  });

  it('defaults format to json and config to .repohealth.yml', () => {
    const options = parseCliOptions(['--repos', 'org/a']);
    expect(options.format).toBe('json');
    expect(options.configPath).toBe('.repohealth.yml');
  });

  it('reads the API URL from the environment for GHES', () => {
    expect(
      parseCliOptions(['--repos', 'org/a'], { GITHUB_API_URL: 'https://ghes/api/v3' }).apiUrl,
    ).toBe('https://ghes/api/v3');
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    expect(() => parseCliOptions(['--repos', 'org/a', '--fail-blow', 'C'])).toThrow(UsageError);
  });

  it('rejects an invalid format instead of silently falling back to json', () => {
    expect(() => parseCliOptions(['--repos', 'org/a', '--format', 'yaml'])).toThrow(
      /--format must be one of json, markdown, badge/,
    );
  });

  it('rejects an invalid grade floor, so a typo cannot disable the gate', () => {
    expect(() => parseCliOptions(['--repos', 'org/a', '--fail-below', 'Z'])).toThrow(UsageError);
    expect(() => parseCliOptions(['--repos', 'org/a', '--fail-below', 'N/A'])).toThrow(UsageError);
  });

  it('rejects a repository that is not org/name', () => {
    expect(() => parseCliOptions(['--repos', 'justaname'])).toThrow(/expected the form org\/name/);
  });

  it('requires repositories unless asking for help', () => {
    expect(() => parseCliOptions([])).toThrow(/no repositories given/);
    expect(parseCliOptions(['--help']).help).toBe(true);
  });
});

describe('run', () => {
  it('prints usage and exits 0 for --help', async () => {
    const { exitCode, stdout } = await invoke(['--help']);
    expect(exitCode).toBe(EXIT_OK);
    expect(stdout).toContain('--fail-below <grade>');
    expect(stdout).toContain('--api-url <url>');
    expect(stdout).toContain('--config <path>');
    expect(stdout).toContain('$GITHUB_TOKEN');
  });

  it('prints the version', async () => {
    const { exitCode, stdout } = await invoke(['--version']);
    expect(exitCode).toBe(EXIT_OK);
    expect(stdout.trim()).toBe('fettle 0.1.0');
  });

  it('reports usage errors on stderr and exits 2', async () => {
    const { exitCode, stdout, stderr } = await invoke(['--nope']);
    expect(exitCode).toBe(EXIT_USAGE);
    expect(stdout).toBe('');
    expect(stderr).toContain('Usage:');
  });

  it('emits the HealthReport envelope for --format json', async () => {
    const { exitCode, stdout } = await invoke(['--repos', 'org/a,org/b']);
    expect(exitCode).toBe(EXIT_OK);

    const report = JSON.parse(stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe('2026-08-15T09:30:00.000Z');
    expect(report.repos.map((repo: { repo: string }) => repo.repo)).toEqual(['org/a', 'org/b']);
    expect(report.fleet.repoCount).toBe(2);
  });

  it('renders markdown with an evidence column', async () => {
    const { stdout } = await invoke(['--repos', 'org/a', '--format', 'markdown']);
    expect(stdout).toContain('## org/a');
    expect(stdout).toContain('| Rule | Status | Score | Weight | Evidence |');
    expect(stdout).toContain('CODEOWNERS found.');
  });

  it('renders badge payloads keyed by repository, so output stays valid JSON', async () => {
    const { stdout } = await invoke(['--repos', 'org/a,org/b', '--format', 'badge']);
    expect(JSON.parse(stdout)).toEqual({
      'org__a.json': {
        schemaVersion: 1,
        label: 'repo health',
        message: 'A (100.0)',
        color: 'brightgreen',
      },
      'org__b.json': {
        schemaVersion: 1,
        label: 'repo health',
        message: 'A (100.0)',
        color: 'brightgreen',
      },
    });
  });

  it('exits 0 when every repository meets the floor', async () => {
    const { exitCode } = await invoke(['--repos', 'org/a', '--fail-below', 'C'], {
      assess: assessorFor({ 'org/a': 85 }),
    });
    expect(exitCode).toBe(EXIT_OK);
  });

  it('exits 1 and names the shortfall when a repository is below the floor', async () => {
    const { exitCode, stdout, stderr } = await invoke(
      ['--repos', 'org/a,org/b', '--fail-below', 'C'],
      {
        assess: assessorFor({ 'org/a': 55, 'org/b': 95 }),
      },
    );

    expect(exitCode).toBe(EXIT_BELOW_FLOOR);
    expect(stderr).toContain('below C');
    // The report is still printed: a failing gate must not withhold the diagnosis.
    expect(JSON.parse(stdout).repos).toHaveLength(2);
  });

  it('exits 0 without a floor, however bad the grade', async () => {
    const { exitCode } = await invoke(['--repos', 'org/a'], {
      assess: assessorFor({ 'org/a': 0 }),
    });
    expect(exitCode).toBe(EXIT_OK);
  });

  it('reports an assessment failure on stderr rather than crashing', async () => {
    const { exitCode, stderr } = await invoke(['--repos', 'org/a'], {
      assess: async () => {
        throw new Error('token rejected');
      },
    });

    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain('token rejected');
  });
});
