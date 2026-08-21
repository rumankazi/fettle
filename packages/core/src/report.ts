/**
 * Report assembly and the renderers that present it: markdown for humans, shields
 * JSON for badges. The `HealthReport` shape itself is the public contract
 * (SCORING.md §6).
 */

import { blockedGroups, coverageNote } from './blocked.js';
import { TOOL_NAME, TOOL_VERSION } from './branding.js';
import {
  aggregateRepoScore,
  coverageOf,
  gradeFromScore,
  isScoreRepresentative,
} from './scoring.js';
import type { FleetSummary, Grade, HealthReport, RepoReport, RuleResult } from './types.js';

// Badge rendering lives in badge.ts; re-exported here because this is where callers
// have always looked for it.
export {
  badgeBasename,
  badgeColor,
  badgeFilename,
  badgeSvgFilename,
  buildBadgePayload,
  renderBadgeSvg,
} from './badge.js';

export interface RepoAssessment {
  repo: string;
  defaultBranch: string;
  rules: RuleResult[];
}

/**
 * Scores one repository's rule results and grades them.
 *
 * Withholds the aggregate when too little of the repository could be read
 * (SCORING.md §3). The individual rule scores are still all there — it is only the
 * single number, the one that ends up on a badge and in a build gate, that needs
 * enough behind it to be worth stating.
 */
export function buildRepoReport({ repo, defaultBranch, rules }: RepoAssessment): RepoReport {
  const coverage = coverageOf(rules);
  const score = isScoreRepresentative(coverage) ? aggregateRepoScore(rules) : null;

  return { repo, defaultBranch, score, grade: gradeFromScore(score), coverage, rules };
}

export function buildFleetSummary(repos: readonly RepoReport[]): FleetSummary {
  const scores = repos.map((repo) => repo.score).filter((score): score is number => score !== null);

  const grades: Partial<Record<Grade, number>> = {};
  for (const repo of repos) {
    grades[repo.grade] = (grades[repo.grade] ?? 0) + 1;
  }

  return {
    repoCount: repos.length,
    averageScore:
      scores.length === 0
        ? null
        : Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10,
    grades,
  };
}

export function buildHealthReport(
  assessments: readonly RepoAssessment[],
  generatedAt: Date = new Date(),
): HealthReport {
  const repos = assessments.map(buildRepoReport);

  return {
    schemaVersion: 1,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    generatedAt: generatedAt.toISOString(),
    repos,
    fleet: buildFleetSummary(repos),
  };
}

/**
 * Makes evidence safe to drop into markdown.
 *
 * Evidence embeds data from the repository being scanned — ruleset names, file
 * paths — which is not necessarily a repository the reader controls. A pipe would
 * break out of a table cell and a newline would break out of the row, so neither
 * survives. The text stays readable; it just cannot restructure the document.
 *
 * Backslashes are escaped **first**, and that order is the whole point. Escaping
 * only pipes left a hole: `a\|b` became `a\\|b`, where `\\` renders as one
 * literal backslash and frees the pipe after it to end the cell. A repository
 * could name a ruleset and restructure the table.
 */
function escapeMarkdown(value: string): string {
  return value
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');
}

function renderRepoSection(repo: RepoReport): string {
  const lines = [
    `## ${repo.repo}`,
    '',
    `**Grade ${repo.grade}**${repo.score === null ? '' : ` — score ${repo.score.toFixed(1)}`} ` +
      `(default branch \`${repo.defaultBranch}\`)`,
    '',
    '| Rule | Status | Score | Weight | Evidence |',
    '| --- | --- | ---: | ---: | --- |',
    ...repo.rules.map(
      (rule) =>
        `| \`${rule.id}\` | ${rule.status} | ${rule.score ?? '—'} | ${rule.weight} | ` +
        `${escapeMarkdown(rule.evidence)} |`,
    ),
  ];

  // SCORING.md §7: actionability is part of the spec, so surface what a change of
  // token or permission would unlock, grouped by the grant that fixes it and
  // ordered by how much score is at stake.
  const blocked = blockedGroups(repo);

  if (blocked.length > 0) {
    const note = coverageNote(repo);

    lines.push('', '### Checks we could not run', '');
    if (note !== undefined) lines.push(escapeMarkdown(note), '');

    lines.push(
      ...blocked.map((group) => {
        const rules = group.rules.map((id) => `\`${id}\``).join(', ');

        return group.needs === null
          ? `- ${rules} (weight ${group.weight}) — ${escapeMarkdown(group.reason)}`
          : `- Grant **\`${group.needs}\`** to unlock ${rules} (weight ${group.weight}).`;
      }),
    );
  }

  return lines.join('\n');
}

/** Human-readable summary, used for `--format markdown` and `GITHUB_STEP_SUMMARY`. */
export function renderMarkdown(report: HealthReport): string {
  const heading = [`# ${TOOL_NAME} report`, '', `Generated ${report.generatedAt}.`];

  if (report.fleet.repoCount > 1) {
    const average = report.fleet.averageScore;
    heading.push(
      '',
      `${report.fleet.repoCount} repositories` +
        (average === null ? '' : `, average score ${average.toFixed(1)}`) +
        `: ${
          Object.entries(report.fleet.grades)
            .map(([grade, count]) => `${count}×${grade}`)
            .join(', ') || 'no grades'
        }`,
    );
  }

  return [heading.join('\n'), ...report.repos.map(renderRepoSection)].join('\n\n');
}
