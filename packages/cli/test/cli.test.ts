import { describe, expect, it } from 'vitest';
import { parseArgs, renderJson, renderMarkdown, runCli } from '../src/cli.js';

describe('CLI parsing', () => {
  it('parses repo lists and fail-below settings', () => {
    const parsed = parseArgs([
      '--repos',
      'org/a,org/b',
      '--format',
      'markdown',
      '--fail-below',
      'C',
    ]);

    expect(parsed.repos).toEqual(['org/a', 'org/b']);
    expect(parsed.format).toBe('markdown');
    expect(parsed.failBelow).toBe('C');
  });
});

describe('CLI output', () => {
  it('renders a markdown summary with a rule evidence column', () => {
    const markdown = renderMarkdown({
      repo: 'acme/demo',
      defaultBranch: 'main',
      score: 55,
      grade: 'F',
      rules: [
        {
          id: 'codeowners',
          status: 'pass',
          score: 100,
          weight: 1,
          evidence: 'CODEOWNERS file found',
        },
      ],
    });

    expect(markdown).toContain('acme/demo');
    expect(markdown).toContain('Evidence');
    expect(markdown).toContain('CODEOWNERS file found');
  });

  it('returns exit code 1 when fail-below threshold is missed', async () => {
    const result = await runCli({
      repos: ['acme/demo'],
      format: 'json',
      failBelow: 'C',
      stdout: { write: async () => undefined },
      env: { GITHUB_TOKEN: 'secret' },
      assessFn: async () => ({
        repo: 'acme/demo',
        defaultBranch: 'main',
        score: 55,
        grade: 'F',
        rules: [],
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('"grade": "F"');
  });
});

describe('JSON rendering', () => {
  it('emits stable JSON for a repo result', () => {
    const payload = renderJson({
      repo: 'acme/demo',
      defaultBranch: 'main',
      score: 80,
      grade: 'B',
      rules: [],
    });

    expect(payload).toContain('"grade": "B"');
  });
});
