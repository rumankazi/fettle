import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHealthReport, TOOL_NAME, TOOL_VERSION, type RuleResult } from '@fettle/core';
import {
  EXIT_BELOW_FLOOR,
  EXIT_OK,
  EXIT_SCAN_FAILED,
  EXIT_USAGE,
  parseCliOptions,
  run,
  UsageError,
  type Scanner,
} from '../src/cli.js';

const GENERATED_AT = new Date('2026-08-15T09:30:00.000Z');

function rules(score: number): RuleResult[] {
  return [{ id: 'codeowners', status: 'pass', score, weight: 1, evidence: 'CODEOWNERS found.' }];
}

/** Returns a fixed score per repository, so the command is testable without a network. */
function scannerFor(scores: Record<string, number>): Scanner {
  return async (repos) =>
    buildHealthReport(
      repos.map((repo) => ({ repo, defaultBranch: 'main', rules: rules(scores[repo] ?? 100) })),
      GENERATED_AT,
    );
}

async function invoke(argv: string[], overrides: Partial<Parameters<typeof run>[0]> = {}) {
  let stdout = '';
  let stderr = '';

  const exitCode = await run({
    argv,
    env: {},
    now: GENERATED_AT,
    scan: scannerFor({}),
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

  it('leaves format unset when not asked for, since the default depends on the terminal', () => {
    const options = parseCliOptions(['--repos', 'org/a']);
    expect(options.format).toBeUndefined();
    expect(options.configPath).toBeUndefined();
  });

  it('reads the host from --gh-host, then $GH_HOST', () => {
    expect(parseCliOptions(['--repos', 'org/a', '--gh-host', 'ghe.example.com']).host).toBe(
      'ghe.example.com',
    );
    expect(parseCliOptions(['--repos', 'org/a'], { GH_HOST: 'ghe.example.com' }).host).toBe(
      'ghe.example.com',
    );
  });

  it('enables debug from the flag or $FETTLE_DEBUG', () => {
    expect(parseCliOptions(['--repos', 'org/a']).debug).toBe(false);
    expect(parseCliOptions(['--repos', 'org/a', '--debug']).debug).toBe(true);
    expect(parseCliOptions(['--repos', 'org/a'], { FETTLE_DEBUG: '1' }).debug).toBe(true);
    expect(parseCliOptions(['--repos', 'org/a'], { FETTLE_DEBUG: '0' }).debug).toBe(false);
  });

  it('records a local config file when one is given', () => {
    expect(parseCliOptions(['--repos', 'org/a', '--config', 'policy.yml']).configPath).toBe(
      'policy.yml',
    );
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
      /--format must be one of pretty, json, markdown, badge/,
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
    expect(stdout.trim()).toBe(`${TOOL_NAME} ${TOOL_VERSION}`);
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

  it('renders pretty output in a terminal, and json when piped', async () => {
    const terminal = await invoke(['--repos', 'org/a'], { isTty: true });
    expect(terminal.stdout).toContain('org/a');
    expect(() => JSON.parse(terminal.stdout)).toThrow();

    const piped = await invoke(['--repos', 'org/a'], { isTty: false });
    expect(JSON.parse(piped.stdout).schemaVersion).toBe(1);
  });

  it('honours an explicit --format over what the terminal suggests', async () => {
    const { stdout } = await invoke(['--repos', 'org/a', '--format', 'json'], { isTty: true });
    expect(JSON.parse(stdout).schemaVersion).toBe(1);
  });

  it('keeps debug output on stderr, so piped stdout stays machine-readable', async () => {
    const { stdout, stderr } = await invoke(['--repos', 'org/a', '--debug', '--format', 'json']);
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stderr).toContain('debug');
    expect(stderr).toContain('org/a');
  });

  it('turns on debug via $FETTLE_DEBUG, for CI where flags are awkward to add', async () => {
    const { stderr } = await invoke(['--repos', 'org/a', '--format', 'json'], {
      env: { FETTLE_DEBUG: '1' },
    });
    expect(stderr).toContain('debug');
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
      scan: scannerFor({ 'org/a': 85 }),
    });
    expect(exitCode).toBe(EXIT_OK);
  });

  it('exits 1 and names the shortfall when a repository is below the floor', async () => {
    const { exitCode, stdout, stderr } = await invoke(
      ['--repos', 'org/a,org/b', '--fail-below', 'C'],
      {
        scan: scannerFor({ 'org/a': 55, 'org/b': 95 }),
      },
    );

    expect(exitCode).toBe(EXIT_BELOW_FLOOR);
    expect(stderr).toContain('below C');
    // The report is still printed: a failing gate must not withhold the diagnosis.
    expect(JSON.parse(stdout).repos).toHaveLength(2);
  });

  it('exits 0 without a floor, however bad the grade', async () => {
    const { exitCode } = await invoke(['--repos', 'org/a'], {
      scan: scannerFor({ 'org/a': 0 }),
    });
    expect(exitCode).toBe(EXIT_OK);
  });

  it('applies a local --config file to every repository', async () => {
    // mkdtemp, not a predictable name in the shared temp directory: another user
    // could pre-create that path as a symlink and redirect the write.
    const dir = await mkdtemp(join(tmpdir(), 'fettle-'));
    const path = join(dir, 'policy.yml');
    await writeFile(path, 'rules:\n  codeowners:\n    weight: 7\n');

    try {
      let seen: unknown;
      await invoke(['--repos', 'org/a', '--config', path], {
        scan: async (repos, options) => {
          seen = options.config;
          return scannerFor({})(repos, options);
        },
      });

      expect(seen).toMatchObject({ rules: { codeowners: { weight: 7 } } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 when the --config file does not exist', async () => {
    const { exitCode, stderr } = await invoke([
      '--repos',
      'org/a',
      '--config',
      join(tmpdir(), 'fettle-does-not-exist.yml'),
    ]);

    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain('ENOENT');
  });

  it('exits 2 when the --config file is invalid, quoting the offending path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fettle-'));
    const path = join(dir, 'bad.yml');
    await writeFile(path, 'rules:\n  codeowners:\n    weight: heavy\n');

    try {
      const { exitCode, stderr } = await invoke(['--repos', 'org/a', '--config', path]);
      expect(exitCode).toBe(EXIT_USAGE);
      expect(stderr).toContain('rules.codeowners.weight must be a number');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('warns when no token is set, since anonymous scans hide private repositories', async () => {
    const { stderr } = await invoke(['--repos', 'org/a']);
    expect(stderr).toContain('no $GITHUB_TOKEN set');
  });

  it('stays quiet about the token when one is set', async () => {
    const { stderr } = await invoke(['--repos', 'org/a'], { env: { GITHUB_TOKEN: 'secret' } });
    expect(stderr).not.toContain('GITHUB_TOKEN');
  });

  it('passes the token and API URL through to the scan', async () => {
    let seen: { token?: string; apiUrl?: string } = {};
    await invoke(['--repos', 'org/a', '--api-url', 'https://ghes/api/v3'], {
      env: { GITHUB_TOKEN: 'secret' },
      scan: async (repos, options) => {
        seen = { token: options.token, apiUrl: options.apiUrl };
        return scannerFor({})(repos, options);
      },
    });

    expect(seen).toEqual({ token: 'secret', apiUrl: 'https://ghes/api/v3' });
  });

  it('reports an assessment failure on stderr rather than crashing', async () => {
    const { exitCode, stderr } = await invoke(['--repos', 'org/a'], {
      scan: async () => {
        throw new Error('token rejected');
      },
    });

    expect(exitCode).toBe(EXIT_SCAN_FAILED);
    expect(stderr).toContain('token rejected');
  });
});
