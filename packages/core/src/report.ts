/**
 * Report assembly and the renderers that present it: markdown for humans, shields
 * JSON for badges. The `HealthReport` shape itself is the public contract
 * (SCORING.md §6).
 */

import { BADGE_LABEL, TOOL_NAME, TOOL_VERSION } from './branding.js';
import { aggregateRepoScore, gradeFromScore } from './scoring.js';
import type {
  BadgePayload,
  FleetSummary,
  Grade,
  HealthReport,
  RepoReport,
  RuleResult,
} from './types.js';

/** Badge colours per SCORING.md §6. */
const GRADE_COLORS: Record<Grade, string> = {
  A: 'brightgreen',
  B: 'green',
  C: 'yellow',
  D: 'orange',
  F: 'red',
  'N/A': 'lightgrey',
};

export interface RepoAssessment {
  repo: string;
  defaultBranch: string;
  rules: RuleResult[];
}

/** Scores one repository's rule results and grades them. */
export function buildRepoReport({ repo, defaultBranch, rules }: RepoAssessment): RepoReport {
  const score = aggregateRepoScore(rules);
  return { repo, defaultBranch, score, grade: gradeFromScore(score), rules };
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

export function buildBadgePayload(repo: RepoReport): BadgePayload {
  return {
    schemaVersion: 1,
    label: BADGE_LABEL,
    message: repo.score === null ? repo.grade : `${repo.grade} (${repo.score.toFixed(1)})`,
    color: GRADE_COLORS[repo.grade],
  };
}

/** Filename-safe badge path for `org/name`, e.g. `badge/org__name.json`. */
export function badgeFilename(repo: string): string {
  return `${repo.replace(/[^A-Za-z0-9._-]+/g, '__')}.json`;
}

/**
 * Makes evidence safe to drop into markdown.
 *
 * Evidence embeds data from the repository being scanned — ruleset names, file
 * paths — which is not necessarily a repository the reader controls. A pipe would
 * break out of a table cell and a newline would break out of the row, so neither
 * survives. The text stays readable; it just cannot restructure the document.
 */
function escapeMarkdown(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\|/g, '\\|');
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
  // token or permission would unlock, ordered by how much score is at stake.
  const blocked = repo.rules
    .filter((rule) => rule.status === 'na')
    .sort((a, b) => b.weight - a.weight);

  if (blocked.length > 0) {
    lines.push(
      '',
      '### Checks we could not run',
      '',
      ...blocked.map(
        (rule) => `- \`${rule.id}\` (weight ${rule.weight}) — ${escapeMarkdown(rule.evidence)}`,
      ),
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
