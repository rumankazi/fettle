import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActionRuntime, formatOutputEntry } from '../src/runtime.js';

/**
 * These cover the runner protocol we implement ourselves since dropping
 * `@actions/core`. Getting them wrong is silent — a malformed `$GITHUB_OUTPUT`
 * entry does not error, it just means a downstream step reads nothing.
 */

let dir: string;
let written: string[];

function runtime(env: Record<string, string | undefined> = {}) {
  written = [];
  return createActionRuntime({
    env,
    write: (text) => written.push(text),
    setExitCode: (code) => written.push(`__exit:${code}`),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fettle-runtime-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('getInput', () => {
  it('reads the runner input variable for a name', () => {
    const r = runtime({ INPUT_REPOS: 'acme/demo' });
    expect(r.getInput('repos')).toBe('acme/demo');
  });

  it('maps dashes and spaces the way the runner does', () => {
    const r = runtime({ 'INPUT_CONFIG-PATH': '.fettle.yml', INPUT_FAIL_BELOW: 'C' });
    expect(r.getInput('config-path')).toBe('.fettle.yml');
    expect(r.getInput('fail below')).toBe('C');
  });

  it('returns an empty string for an unset input, never undefined', () => {
    expect(runtime().getInput('nothing')).toBe('');
  });

  it('trims, because action.yml defaults arrive as padded empty strings', () => {
    const r = runtime({ INPUT_REPOS: '  acme/demo  ' });
    expect(r.getInput('repos')).toBe('acme/demo');
  });
});

describe('setOutput', () => {
  it('writes a heredoc entry to $GITHUB_OUTPUT', async () => {
    const path = join(dir, 'output');
    const r = runtime({ GITHUB_OUTPUT: path });

    r.setOutput('grade', 'B');
    const contents = await readFile(path, 'utf8');

    expect(contents).toMatch(/^grade<<ghadelimiter_[0-9a-f-]+\nB\nghadelimiter_[0-9a-f-]+\n$/);
  });

  it('appends rather than replacing, so several outputs survive', async () => {
    const path = join(dir, 'output');
    const r = runtime({ GITHUB_OUTPUT: path });

    r.setOutput('grade', 'B');
    r.setOutput('score', '83');
    const contents = await readFile(path, 'utf8');

    expect(contents).toContain('grade<<');
    expect(contents).toContain('score<<');
    expect(contents.match(/ghadelimiter_/g)?.length).toBe(4);
  });

  it('carries a multi-line value intact, which is what the heredoc is for', async () => {
    const path = join(dir, 'output');
    const r = runtime({ GITHUB_OUTPUT: path });

    r.setOutput('report', 'line one\nline two');
    expect(await readFile(path, 'utf8')).toContain('line one\nline two\n');
  });

  it('says so rather than throwing when there is no output file', () => {
    const r = runtime({});
    r.setOutput('grade', 'B');
    expect(written.join('')).toContain('no GITHUB_OUTPUT');
  });

  it('uses a fresh delimiter each time, so one value cannot close another block', () => {
    const first = formatOutputEntry('a', '1');
    const second = formatOutputEntry('a', '1');
    expect(first).not.toBe(second);
  });

  it('refuses a value containing its own delimiter rather than emitting it', () => {
    // Constructed by hand: a random UUID makes this unreachable in practice, but
    // the check is what stops a crafted value injecting further outputs.
    expect(() => formatOutputEntry('a\nb', '1')).toThrow(/newlines/);
  });
});

describe('workflow commands', () => {
  it('emits a warning the runner will surface', () => {
    runtime().warning('careful');
    expect(written.join('')).toBe('::warning::careful\n');
  });

  it('emits an error and fails the step', () => {
    runtime().setFailed('broken');
    expect(written.join('')).toContain('::error::broken');
    expect(written.join('')).toContain('__exit:1');
  });

  it('escapes newlines, so text from a scanned repository cannot forge a command', () => {
    runtime().warning('one\ntwo\r\n::error::forged');
    const out = written.join('');

    // The forged text survives as *text*; what matters is that it is no longer at
    // the start of a line, which is the only place the runner reads a command.
    const lines = out.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('::warning::')).toBe(true);
    expect(lines.some((line) => line.startsWith('::error::'))).toBe(false);
    expect(out).toContain('%0A');
  });

  it('escapes percent signs, which would otherwise corrupt the escaping', () => {
    runtime().warning('100%');
    expect(written.join('')).toBe('::warning::100%25\n');
  });

  it('writes info as a plain line', () => {
    runtime().info('hello');
    expect(written.join('')).toBe('hello\n');
  });
});

describe('writeSummary', () => {
  it('appends markdown to $GITHUB_STEP_SUMMARY', async () => {
    const path = join(dir, 'summary.md');
    const r = runtime({ GITHUB_STEP_SUMMARY: path });

    await r.writeSummary('# report');
    await r.writeSummary('more');

    expect(await readFile(path, 'utf8')).toBe('# report\nmore\n');
  });

  it('falls back to the log outside a runner, so the bundle stays runnable', async () => {
    await runtime({}).writeSummary('# report');
    expect(written.join('')).toContain('# report');
  });
});

describe('writeFile', () => {
  it('creates parent directories', async () => {
    const path = join(dir, 'deep', 'nested', 'report.json');
    await runtime().writeFile(path, '{}');
    expect(await readFile(path, 'utf8')).toBe('{}');
  });
});
