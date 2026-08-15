/**
 * Badge rendering.
 *
 * Two forms, because they solve different problems:
 *
 * - The shields.io **endpoint payload** is small and lets shields draw the badge.
 *   It only works if shields.io can fetch the file over the public internet, which
 *   rules out private repositories and GitHub Enterprise Server entirely.
 * - The **SVG** is the whole badge. Commit it and reference it by relative path and
 *   it works on a private repository, on GHES, behind a corporate proxy, and with
 *   no third party involved — which is the environment this tool is aimed at.
 */

import { BADGE_LABEL } from './branding.js';
import type { BadgePayload, Grade, RepoReport } from './types.js';

/** Badge colours per SCORING.md §6, and the hex shields.io uses for each. */
const GRADE_COLORS: Record<Grade, string> = {
  A: 'brightgreen',
  B: 'green',
  C: 'yellow',
  D: 'orange',
  F: 'red',
  'N/A': 'lightgrey',
};

const COLOR_HEX: Record<string, string> = {
  brightgreen: '#4c1',
  green: '#97ca00',
  yellow: '#dfb317',
  orange: '#fe7d37',
  red: '#e05d44',
  lightgrey: '#9f9f9f',
};

export function badgeColor(grade: Grade): string {
  return GRADE_COLORS[grade];
}

export function buildBadgePayload(repo: RepoReport): BadgePayload {
  return {
    schemaVersion: 1,
    label: BADGE_LABEL,
    message: repo.score === null ? repo.grade : `${repo.grade} (${repo.score.toFixed(1)})`,
    color: badgeColor(repo.grade),
  };
}

/**
 * Approximate rendered width of a string in 11px Verdana.
 *
 * Shields.io measures against real font metrics. We do not ship a metrics table for
 * eleven characters of output — the widest string this ever renders is something
 * like "repo health" / "N/A", and being a pixel or two out moves the text within
 * its box rather than breaking anything.
 */
function textWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    if (/[A-Z]/.test(character)) width += 8;
    else if (/[a-z]/.test(character)) width += 6.5;
    else if (/[0-9]/.test(character)) width += 7;
    else if (/[ .()/]/.test(character)) width += 3.8;
    else width += 6.5;
  }
  return Math.ceil(width);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Renders the badge as a self-contained SVG in shields.io's "flat" style.
 *
 * No external references, no fonts to load, no network call when it is displayed.
 */
export function renderBadgeSvg(payload: BadgePayload): string {
  const label = escapeXml(payload.label);
  const message = escapeXml(payload.message);

  const padding = 10;
  const labelWidth = textWidth(payload.label) + padding * 2;
  const messageWidth = textWidth(payload.message) + padding * 2;
  const width = labelWidth + messageWidth;
  const fill = COLOR_HEX[payload.color] ?? payload.color;

  // Text is positioned and sized ×10, then scaled down, which is how shields gets
  // sub-pixel placement out of integer coordinates.
  const labelMid = (labelWidth / 2) * 10;
  const messageMid = (labelWidth + messageWidth / 2) * 10;
  const accessibleName = `${label}: ${message}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="20" role="img" aria-label="${accessibleName}">
  <title>${accessibleName}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${fill}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelMid}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - padding * 2) * 10}">${label}</text>
    <text x="${labelMid}" y="140" transform="scale(.1)" textLength="${(labelWidth - padding * 2) * 10}">${label}</text>
    <text aria-hidden="true" x="${messageMid}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - padding * 2) * 10}">${message}</text>
    <text x="${messageMid}" y="140" transform="scale(.1)" textLength="${(messageWidth - padding * 2) * 10}">${message}</text>
  </g>
</svg>
`;
}

/** Filename-safe badge basename for `org/name`, e.g. `org__name`. */
export function badgeBasename(repo: string): string {
  return repo.replace(/[^A-Za-z0-9._-]+/g, '__');
}

/** Shields endpoint filename, e.g. `org__name.json`. */
export function badgeFilename(repo: string): string {
  return `${badgeBasename(repo)}.json`;
}

/** SVG filename, e.g. `org__name.svg`. */
export function badgeSvgFilename(repo: string): string {
  return `${badgeBasename(repo)}.svg`;
}
