import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  buildHealthReport,
  CONFIG_FILENAME,
  DEFAULT_OUTPUT_DIR,
  type RepoAssessment,
  type RuleResult,
} from '@fettle/core';
import { readInputs, runAction, type ActionRuntime, type Scanner } from '../src/action.js';

const NOW = new Date('2026-08-15T09:30:00.000Z');

/** Captures everything the Action does to the outside world. */
interface FakeRuntime extends ActionRuntime {
  outputs: Record<string, string>;
  files: Record<string, string>;
  summaries: string[];
  warnings: string[];
  infos: string[];
  failures: string[];
  posts: { url: string; body: string }[];
}

function fakeRuntime(
  inputs: Record<string, string> = {},
  options: { env?: Record<string, string>; postFails?: string } = {},
): FakeRuntime {
  const runtime: FakeRuntime = {
    outputs: {},
    files: {},
    summaries: [],
    warnings: [],
    infos: [],
    failures: [],
    posts: [],

    getInput: (name) => inputs[name] ?? '',
    getEnv: (name) => options.env?.[name],
    setOutput: (name, value) => {
      runtime.outputs[name] = value;
    },
    info: (message) => runtime.infos.push(message),
    warning: (message) => runtime.warnings.push(message),
    setFailed: (message) => runtime.failures.push(message),
    writeSummary: async (markdown) => {
      runtime.summaries.push(markdown);
    },
    writeFile: async (path, contents) => {
      runtime.files[path] = contents;
    },
    postJson: async (url, body) => {
      runtime.posts.push({ url, body });
      if (options.postFails !== undefined) throw new Error(options.postFails);
    },
  };

  return runtime;
}

function rules(score: number): RuleResult[] {
  return [{ id: 'codeowners', status: 'pass', score, weight: 1, evidence: 'CODEOWNERS found.' }];
}

function scannerFor(scores: Record<string, number>): Scanner {
  return async (repos) =>
    buildHealthReport(
      repos.map((repo): RepoAssessment => ({
        repo,
        defaultBranch: 'main',
        rules: rules(scores[repo] ?? 95),
      })),
      NOW,
    );
}

async function run(
  inputs: Record<string, string>,
  options: {
    env?: Record<string, string>;
    scan?: Scanner;
    postFails?: string;
  } = {},
) {
  const runtime = fakeRuntime(inputs, { env: options.env, postFails: options.postFails });
  await runAction({ runtime, scan: options.scan ?? scannerFor({}), now: NOW });
  return runtime;
}

describe('readInputs', () => {
  it('defaults to the repository running the workflow', () => {
    const inputs = readInputs(fakeRuntime({}, { env: { GITHUB_REPOSITORY: 'acme/demo' } }));
    expect(inputs.repos).toEqual(['acme/demo']);
  });

  it('accepts a comma- or newline-separated list, as workflow YAML supplies', () => {
    expect(readInputs(fakeRuntime({ repos: 'acme/a, acme/b' })).repos).toEqual([
      'acme/a',
      'acme/b',
    ]);
    expect(readInputs(fakeRuntime({ repos: 'acme/a\nacme/b\n' })).repos).toEqual([
      'acme/a',
      'acme/b',
    ]);
  });

  it('applies the documented defaults', () => {
    const inputs = readInputs(fakeRuntime({ repos: 'acme/demo' }));
    expect(inputs.configPath).toBe('.fettle.yml');
    expect(inputs.outputDir).toBe('fettle-report');
    expect(inputs.failBelow).toBeUndefined();
    expect(inputs.reportUrl).toBeUndefined();
  });

  it('treats an empty input as unset, since action.yml defaults them to empty strings', () => {
    const inputs = readInputs(
      fakeRuntime({ repos: 'acme/demo', 'fail-below': '  ', 'report-url': '', token: '' }),
    );
    expect(inputs.failBelow).toBeUndefined();
    expect(inputs.reportUrl).toBeUndefined();
    expect(inputs.token).toBeUndefined();
  });

  it('rejects a repository that is not org/name', () => {
    expect(() => readInputs(fakeRuntime({ repos: 'justaname' }))).toThrow(/org\/name/);
  });

  it('rejects a grade floor that would gate on nothing', () => {
    expect(() => readInputs(fakeRuntime({ repos: 'acme/demo', 'fail-below': 'N/A' }))).toThrow(
      /gate on nothing/,
    );
    expect(() => readInputs(fakeRuntime({ repos: 'acme/demo', 'fail-below': 'Z' }))).toThrow(
      /must be one of A, B, C, D, F/,
    );
  });

  it('explains itself when there is nothing to scan', () => {
    expect(() => readInputs(fakeRuntime({}))).toThrow(/no repositories to scan/);
  });
});

describe('runAction', () => {
  it('writes report.json to the output directory', async () => {
    const runtime = await run({ repos: 'acme/demo' });

    const report = JSON.parse(runtime.files['fettle-report/report.json']);
    expect(report.schemaVersion).toBe(1);
    expect(report.repos[0].repo).toBe('acme/demo');
    expect(runtime.files['fettle-report/report.json'].endsWith('\n')).toBe(true);
  });

  it('writes one shields.io badge payload per repository', async () => {
    const runtime = await run({ repos: 'acme/demo,acme/other' });

    expect(JSON.parse(runtime.files['fettle-report/badge/acme__demo.json'])).toEqual({
      schemaVersion: 1,
      label: 'repo health',
      message: 'A (95.0)',
      color: 'brightgreen',
    });
    expect(runtime.files['fettle-report/badge/acme__other.json']).toBeDefined();
  });

  it('writes a self-contained SVG too, for repositories shields.io cannot reach', async () => {
    const runtime = await run({ repos: 'acme/demo' });
    const svg = runtime.files['fettle-report/badge/acme__demo.svg'];

    expect(svg).toBeDefined();
    expect(svg).toContain('<svg');
    expect(svg).toContain('repo health');
    // Nothing to fetch: this has to render on a private repo and on GHES.
    const urls = [...(svg ?? '').matchAll(/https?:\/\/[^"'\s>]+/g)].map((m) => m[0]);
    expect(urls.every((url) => new URL(url).host === 'www.w3.org')).toBe(true);
  });

  it('honours a custom output directory', async () => {
    const runtime = await run({ repos: 'acme/demo', 'output-dir': 'out/health/' });

    expect(runtime.files['out/health/report.json']).toBeDefined();
    expect(runtime.files['out/health/badge/acme__demo.json']).toBeDefined();
  });

  it('writes the markdown report to the step summary', async () => {
    const runtime = await run({ repos: 'acme/demo' });

    expect(runtime.summaries).toHaveLength(1);
    expect(runtime.summaries[0]).toContain('## acme/demo');
    expect(runtime.summaries[0]).toContain('| Rule | Status | Score | Weight | Evidence |');
  });

  it('sets the documented outputs', async () => {
    const runtime = await run({ repos: 'acme/demo' }, { scan: scannerFor({ 'acme/demo': 83 }) });

    expect(runtime.outputs).toEqual({
      grade: 'B',
      score: '83',
      'report-path': 'fettle-report/report.json',
    });
  });

  it('reports the fleet average across several repositories', async () => {
    const runtime = await run(
      { repos: 'acme/a,acme/b' },
      { scan: scannerFor({ 'acme/a': 100, 'acme/b': 60 }) },
    );

    expect(runtime.outputs.score).toBe('80');
    expect(runtime.outputs.grade).toBe('B');
  });

  it('leaves the score empty, and the grade N/A, when nothing could be graded', async () => {
    const runtime = await run(
      { repos: 'acme/demo' },
      {
        scan: async (repos) =>
          buildHealthReport(
            repos.map((repo) => ({
              repo,
              defaultBranch: 'main',
              rules: [
                { id: 'codeowners', status: 'na', score: null, weight: 1, evidence: 'no access' },
              ],
            })),
            NOW,
          ),
      },
    );

    expect(runtime.outputs.grade).toBe('N/A');
    expect(runtime.outputs.score).toBe('');
    expect(runtime.failures).toEqual([]);
  });

  it('shows the unlock guidance in the summary when a check could not be run', async () => {
    const unlockHint =
      'Reading branch protection needs repository administration:read, which the default ' +
      'GITHUB_TOKEN does not have. Grant it, or supply a PAT or App token, to unlock this check.';

    const runtime = await run(
      { repos: 'acme/demo' },
      {
        scan: async (repos) =>
          buildHealthReport(
            repos.map((repo) => ({
              repo,
              defaultBranch: 'main',
              rules: [
                {
                  id: 'branch_protection',
                  status: 'na',
                  score: null,
                  weight: 3,
                  evidence: unlockHint,
                },
                ...rules(100),
              ],
            })),
            NOW,
          ),
      },
    );

    expect(runtime.summaries[0]).toContain('### Checks we could not run');
    expect(runtime.summaries[0]).toContain('administration:read');
    // A check we could not run must not fail the step.
    expect(runtime.failures).toEqual([]);
  });
});

describe('runAction: the grade floor', () => {
  it('passes when every repository meets it', async () => {
    const runtime = await run(
      { repos: 'acme/demo', 'fail-below': 'C' },
      { scan: scannerFor({ 'acme/demo': 75 }) },
    );

    expect(runtime.failures).toEqual([]);
  });

  it('fails the step and names the repositories that fell short', async () => {
    const runtime = await run(
      { repos: 'acme/a,acme/b', 'fail-below': 'B' },
      { scan: scannerFor({ 'acme/a': 55, 'acme/b': 95 }) },
    );

    expect(runtime.failures).toHaveLength(1);
    expect(runtime.failures[0]).toContain('acme/a (F)');
    expect(runtime.failures[0]).not.toContain('acme/b');
  });

  it('still writes the report and summary when it fails, so the run is diagnosable', async () => {
    const runtime = await run(
      { repos: 'acme/demo', 'fail-below': 'A' },
      { scan: scannerFor({ 'acme/demo': 10 }) },
    );

    expect(runtime.failures).toHaveLength(1);
    expect(runtime.files['fettle-report/report.json']).toBeDefined();
    expect(runtime.summaries).toHaveLength(1);
    expect(runtime.outputs.grade).toBe('F');
  });

  it('never trips on a repository graded N/A', async () => {
    const runtime = await run(
      { repos: 'acme/demo', 'fail-below': 'A' },
      {
        scan: async (repos) =>
          buildHealthReport(
            repos.map((repo) => ({
              repo,
              defaultBranch: 'main',
              rules: [
                { id: 'codeowners', status: 'na', score: null, weight: 1, evidence: 'no access' },
              ],
            })),
            NOW,
          ),
      },
    );

    expect(runtime.failures).toEqual([]);
  });
});

describe('runAction: the optional report POST', () => {
  it('posts the report when a URL is configured', async () => {
    const runtime = await run({ repos: 'acme/demo', 'report-url': 'https://dash.acme/health' });

    expect(runtime.posts).toHaveLength(1);
    expect(runtime.posts[0].url).toBe('https://dash.acme/health');
    expect(JSON.parse(runtime.posts[0].body).repos[0].repo).toBe('acme/demo');
  });

  it('does not post when no URL is configured', async () => {
    expect((await run({ repos: 'acme/demo' })).posts).toEqual([]);
  });

  it('warns rather than failing when the endpoint is down', async () => {
    const runtime = await run(
      { repos: 'acme/demo', 'report-url': 'https://dash.acme/health' },
      { postFails: '503 Service Unavailable' },
    );

    expect(runtime.failures).toEqual([]);
    expect(runtime.warnings[0]).toContain('503 Service Unavailable');
    expect(runtime.warnings[0]).toContain('The scan itself succeeded');
  });

  it('still fails on the grade floor even when the POST failed', async () => {
    const runtime = await run(
      { repos: 'acme/demo', 'report-url': 'https://dash.acme/health', 'fail-below': 'A' },
      { scan: scannerFor({ 'acme/demo': 10 }), postFails: 'connection refused' },
    );

    expect(runtime.warnings.some((w) => w.includes('connection refused'))).toBe(true);
    expect(runtime.failures).toHaveLength(1);
  });
});

describe('runAction: failures', () => {
  it('fails the step when the inputs are unusable, without scanning', async () => {
    const runtime = await run({ repos: 'nonsense' });

    expect(runtime.failures[0]).toContain('org/name');
    expect(runtime.files).toEqual({});
  });

  it('fails the step when a repository cannot be read', async () => {
    const runtime = await run(
      { repos: 'acme/demo' },
      {
        scan: async () => {
          throw new Error('Repository acme/demo was not found.');
        },
      },
    );

    expect(runtime.failures[0]).toContain('was not found');
    expect(runtime.summaries).toEqual([]);
  });

  it('surfaces configuration warnings from the scan', async () => {
    const runtime = await run(
      { repos: 'acme/demo' },
      {
        scan: async (repos, options) => {
          options.onWarning?.('acme/demo', 'rules.nope is not a rule this version knows about');
          return scannerFor({})(repos, options);
        },
      },
    );

    expect(runtime.warnings[0]).toBe(
      'acme/demo: rules.nope is not a rule this version knows about',
    );
    expect(runtime.failures).toEqual([]);
  });

  it('passes the token and config path through to the scan', async () => {
    let seen: { token?: string; configPath?: string } = {};
    await run(
      { repos: 'acme/demo', token: 'secret', 'config-path': '.github/health.yml' },
      {
        scan: async (repos, options) => {
          seen = { token: options.token, configPath: options.configPath };
          return scannerFor({})(repos, options);
        },
      },
    );

    expect(seen).toEqual({ token: 'secret', configPath: '.github/health.yml' });
  });
});

describe('action.yml', () => {
  /**
   * The manifest cannot import a constant, so its defaults are the one place the
   * names are duplicated. This test is what keeps the two in step.
   */
  // At the repository root, because the GitHub Marketplace only lists an action
  // whose metadata file is there — a sub-folder manifest is usable but invisible.
  const manifest = load(
    readFileSync(fileURLToPath(new URL('../../../action.yml', import.meta.url)), 'utf8'),
  ) as {
    inputs: Record<string, { default?: string; description?: string; required?: boolean }>;
    outputs: Record<string, { description?: string }>;
    runs: { using?: string; main?: string };
    branding?: { icon?: string; color?: string };
  };

  it('declares the same defaults the code falls back to', () => {
    expect(manifest.inputs['config-path'].default).toBe(CONFIG_FILENAME);
    expect(manifest.inputs['output-dir'].default).toBe(DEFAULT_OUTPUT_DIR);
  });

  it('declares every input the Action reads', () => {
    expect(Object.keys(manifest.inputs).sort()).toEqual([
      'config-path',
      'fail-below',
      'output-dir',
      'report-url',
      'repos',
      'token',
    ]);
  });

  it('declares the documented outputs', () => {
    expect(Object.keys(manifest.outputs).sort()).toEqual(['grade', 'report-path', 'score']);
  });

  it('points at the committed bundle and carries Marketplace branding', () => {
    expect(manifest.runs.using).toMatch(/^node\d+$/);
    expect(manifest.runs.main).toBe('packages/action/dist/index.js');
    expect(manifest.branding?.icon).toBeTruthy();
    expect(manifest.branding?.color).toBeTruthy();
  });

  it('is bundled for the runtime the runner will provide', () => {
    // A bundle emitted for a newer runtime than `runs.using` would use syntax the
    // runner cannot parse. Asserting the relationship rather than a literal means
    // this keeps holding when the version moves.
    const buildScript = readFileSync(
      fileURLToPath(new URL('../build.mjs', import.meta.url)),
      'utf8',
    );
    const target = /target:\s*'([^']+)'/.exec(buildScript)?.[1];

    expect(target).toBe(manifest.runs.using);
  });

  it('describes every input and output, since these are the Marketplace listing', () => {
    for (const [name, input] of Object.entries(manifest.inputs)) {
      expect(input.description, `input ${name}`).toBeTruthy();
    }
    for (const [name, output] of Object.entries(manifest.outputs)) {
      expect(output.description, `output ${name}`).toBeTruthy();
    }
  });
});
