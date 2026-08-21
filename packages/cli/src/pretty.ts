/**
 * The human-facing terminal renderer.
 *
 * Deliberately CLI-only: markdown and the JSON report are contracts other things
 * consume, while this exists to be read once by the person who just typed the
 * command. It may change shape whenever that makes it clearer.
 *
 * Colour is written by hand rather than pulled in — a dozen escape codes do not
 * justify a dependency in a tool that ships its own bundle.
 */

import { blockedGroups, coverageNote } from '@fettle/core';
import type { Grade, HealthReport, RepoReport, RuleResult } from '@fettle/core';

const CSI = '\u001b[';

const ANSI = {
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  red: `${CSI}31m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  blue: `${CSI}34m`,
  grey: `${CSI}90m`,
} as const;

type Colour = keyof typeof ANSI;

export interface PrettyOptions {
  /** Off when piped, when NO_COLOR is set, or when the terminal says it is dumb. */
  colour: boolean;
  /** Used to keep evidence on one line. */
  width: number;
}

/**
 * Decides whether to colour.
 *
 * Honours the NO_COLOR and FORCE_COLOR conventions, and otherwise colours only a
 * real terminal — piping into a file should not fill it with escape codes.
 */
export function prettyOptions(
  env: Readonly<Record<string, string | undefined>>,
  isTty: boolean,
  columns?: number,
): PrettyOptions {
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0';
  const disabled = env.NO_COLOR !== undefined || env.TERM === 'dumb';

  return {
    colour: forced || (isTty && !disabled),
    width: Math.max(60, Math.min(columns ?? 100, 120)),
  };
}

function paint(options: PrettyOptions, colour: Colour, text: string): string {
  return options.colour ? `${ANSI[colour]}${text}${ANSI.reset}` : text;
}

const GRADE_COLOUR: Record<Grade, Colour> = {
  A: 'green',
  B: 'green',
  C: 'yellow',
  D: 'yellow',
  F: 'red',
  'N/A': 'grey',
};

/** A glyph per status, chosen to stay legible without colour. */
const STATUS_MARK: Record<RuleResult['status'], { mark: string; colour: Colour }> = {
  pass: { mark: 'ok  ', colour: 'green' },
  fail: { mark: 'FAIL', colour: 'red' },
  na: { mark: 'n/a ', colour: 'grey' },
  disabled: { mark: 'off ', colour: 'grey' },
};

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** Truncates *and* pads, so a column is exactly its width whatever it holds. */
function column(text: string, width: number): string {
  return truncate(text, width).padEnd(width);
}

/**
 * Wraps text to a width, indenting every line.
 *
 * The rule table truncates because it is a table and alignment is what makes it
 * readable at a glance. The blocked-checks section does not: it exists to tell
 * someone how to fix their token, and truncating it cut off the half that said
 * what to do.
 */
function wrap(text: string, width: number, indent: string, hanging = indent): string[] {
  const lines: string[] = [];
  let current = '';
  let prefix = indent;

  const flush = () => {
    if (current === '') return;
    lines.push(prefix + current);
    current = '';
    prefix = hanging;
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;

    // A single word can exceed the width - a URL, or a path with no spaces in it.
    // Splitting on whitespace alone would emit it as one over-long line, so the
    // remainder is hard-broken rather than allowed to overflow.
    while (rest.length > Math.max(1, width - prefix.length)) {
      flush();
      const room = Math.max(1, width - prefix.length);
      lines.push(prefix + rest.slice(0, room));
      prefix = hanging;
      rest = rest.slice(room);
    }

    const limit = Math.max(1, width - prefix.length);
    if (current === '') current = rest;
    else if (current.length + 1 + rest.length <= limit) current += ` ${rest}`;
    else {
      flush();
      current = rest;
    }
  }

  flush();
  return lines;
}

/** Columns consumed by everything on a rule line except the evidence. */
const RULE_ID_WIDTH = 19;
const RULE_GUTTER = 2 + 4 + 1 + RULE_ID_WIDTH + 1 + 3 + 1 + 3 + 2;

function renderRule(rule: RuleResult, options: PrettyOptions): string {
  const { mark, colour } = STATUS_MARK[rule.status];
  const score = rule.score === null ? '  -' : String(rule.score).padStart(3);
  const weight = `x${rule.weight}`.padEnd(3);
  const evidence = truncate(rule.evidence, Math.max(20, options.width - RULE_GUTTER));

  return (
    `  ${paint(options, colour, mark)} ${column(rule.id, RULE_ID_WIDTH)} ${score} ` +
    `${paint(options, 'grey', weight)}  ${paint(options, 'grey', evidence)}`
  );
}

function renderRepo(repo: RepoReport, options: PrettyOptions): string[] {
  const gradeText = options.colour ? `${ANSI.bold}${repo.grade}${ANSI.reset}` : repo.grade;
  const grade = paint(options, GRADE_COLOUR[repo.grade], gradeText);
  const score = repo.score === null ? '' : ` ${repo.score.toFixed(1)}`;
  const nameWidth = Math.max(20, options.width - 12);

  return [
    '',
    `${paint(options, 'blue', column(repo.repo, nameWidth))} ${grade}${score}`,
    ...repo.rules.map((rule) => renderRule(rule, options)),
  ];
}

/** Renders a report for a person reading it in a terminal. */
export function renderPretty(report: HealthReport, options: PrettyOptions): string {
  const { repoCount, averageScore } = report.fleet;
  const summary =
    repoCount === 1
      ? '1 repository'
      : `${repoCount} repositories` +
        (averageScore === null ? '' : `, average ${averageScore.toFixed(1)}`);

  const lines = [paint(options, 'dim', `fettle - ${summary}`)];

  for (const repo of report.repos) lines.push(...renderRepo(repo, options));

  const blockedRepos = report.repos
    .map((repo) => ({ repo, groups: blockedGroups(repo) }))
    .filter(({ groups }) => groups.length > 0);

  if (blockedRepos.length > 0) {
    lines.push('', paint(options, 'yellow', 'Checks that could not run'));

    for (const { repo, groups } of blockedRepos) {
      lines.push('', paint(options, 'blue', `  ${truncate(repo.repo, options.width - 2)}`));

      const note = coverageNote(repo);
      if (note !== undefined) {
        lines.push(...wrap(note, options.width, '    ').map((l) => paint(options, 'grey', l)));
      }

      for (const group of groups) {
        const rules = group.rules.join(', ');
        const detail =
          group.needs === null
            ? `${rules} (weight ${group.weight}) - ${group.reason}`
            : `grant ${group.needs} to unlock ${rules} (weight ${group.weight})`;

        const [first, ...rest] = wrap(detail, options.width, '    ', '      ');
        lines.push(paint(options, group.needs === null ? 'grey' : 'yellow', first));
        lines.push(...rest.map((line) => paint(options, 'grey', line)));
      }
    }
  }

  if (repoCount === 0) lines.push('', paint(options, 'grey', '  no repositories scanned'));

  return lines.join('\n');
}
