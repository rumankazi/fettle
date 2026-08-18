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

  const blocked = report.repos.flatMap((repo) =>
    repo.rules.filter((rule) => rule.status === 'na').map((rule) => ({ repo: repo.repo, rule })),
  );

  if (blocked.length > 0) {
    lines.push('', paint(options, 'yellow', 'Checks that could not run'));
    for (const { repo, rule } of blocked) {
      const detail = `${repo} ${rule.id} - ${rule.evidence}`;
      lines.push(paint(options, 'grey', `  ${truncate(detail, options.width - 2)}`));
    }
  }

  if (repoCount === 0) lines.push('', paint(options, 'grey', '  no repositories scanned'));

  return lines.join('\n');
}
