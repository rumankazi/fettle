import { describe, expect, it } from 'vitest';
import {
  badgeBasename,
  badgeFilename,
  badgeSvgFilename,
  buildBadgePayload,
  renderBadgeSvg,
} from '../src/badge.js';
import type { Grade, RepoReport } from '../src/types.js';

function repo(grade: Grade, score: number | null): RepoReport {
  return { repo: 'acme/demo', defaultBranch: 'main', score, grade, rules: [] };
}

describe('badge filenames', () => {
  it('makes a repository name safe for a filesystem', () => {
    expect(badgeBasename('acme/demo')).toBe('acme__demo');
    expect(badgeFilename('acme/demo')).toBe('acme__demo.json');
    expect(badgeSvgFilename('acme/demo')).toBe('acme__demo.svg');
  });
});

describe('renderBadgeSvg', () => {
  const svg = renderBadgeSvg(buildBadgePayload(repo('F', 55.6)));

  it('renders a self-contained SVG, with nothing to fetch', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('</svg>');
    // The whole point: it must work on a private repo, on GHES, behind a proxy.
    const urls = [...(svg ?? '').matchAll(/https?:\/\/[^"'\s>]+/g)].map((m) => m[0]);
    expect(urls.every((url) => new URL(url).host === 'www.w3.org')).toBe(true);
  });

  it('shows the label and the grade', () => {
    expect(svg).toContain('repo health');
    expect(svg).toContain('F (55.6)');
  });

  it('is accessible to a screen reader', () => {
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="repo health: F (55.6)"');
    expect(svg).toContain('<title>repo health: F (55.6)</title>');
  });

  it.each([
    ['A', '#4c1'],
    ['B', '#97ca00'],
    ['C', '#dfb317'],
    ['D', '#fe7d37'],
    ['F', '#e05d44'],
  ])('colours a %s badge %s', (grade, hex) => {
    expect(renderBadgeSvg(buildBadgePayload(repo(grade as Grade, 75)))).toContain(hex);
  });

  it('renders an ungradeable repository in grey, with no score', () => {
    const na = renderBadgeSvg(buildBadgePayload(repo('N/A', null)));
    expect(na).toContain('#9f9f9f');
    expect(na).toContain('repo health: N/A');
  });

  it('grows the badge to fit a longer message', () => {
    const short = renderBadgeSvg(buildBadgePayload(repo('N/A', null)));
    const long = renderBadgeSvg(buildBadgePayload(repo('A', 100)));
    const widthOf = (s: string) => Number(/width="(\d+)"/.exec(s)![1]);
    expect(widthOf(long)).toBeGreaterThan(widthOf(short));
  });

  it('escapes text rather than letting it break the document', () => {
    const svg = renderBadgeSvg({
      schemaVersion: 1,
      label: 'a & b',
      message: '<script>',
      color: 'red',
    });
    expect(svg).toContain('a &amp; b');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });
});
