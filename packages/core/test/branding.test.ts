import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOL_NAME, TOOL_VERSION } from '../src/branding.js';

function packageJson(name: string): { name: string; version: string } {
  const path = fileURLToPath(new URL(`../../${name}/package.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * `TOOL_VERSION` is stamped into every report, and the package version is what
 * consumers install. Nothing makes them agree except this test, so a release that
 * bumps one and forgets the other fails here rather than shipping a report that
 * misidentifies the tool that wrote it.
 */
describe('version consistency', () => {
  it.each(['core', 'cli', 'action'])('%s is at TOOL_VERSION', (name) => {
    expect(packageJson(name).version).toBe(TOOL_VERSION);
  });

  it('gives every published package a resolvable entry point', () => {
    // A package with only `bin` has no entry point at all: importing it fails and
    // tooling that inspects packages — bundlephobia among them — cannot read it.
    for (const name of ['core', 'cli']) {
      const pkg = packageJson(name) as unknown as Record<string, unknown>;
      expect(pkg.main, `${name} main`).toBeTruthy();
      expect(pkg.types, `${name} types`).toBeTruthy();
      expect(pkg.exports, `${name} exports`).toBeTruthy();
    }
  });

  it('names the packages after the tool, so a rename stays mechanical', () => {
    for (const name of ['core', 'cli', 'action']) {
      expect(packageJson(name).name).toBe(`@${TOOL_NAME}/${name}`);
    }
  });
});
