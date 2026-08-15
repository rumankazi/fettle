import { TOOL_NAME, TOOL_VERSION } from './branding.js';
import { aggregateRepoScore, gradeFromScore } from './scoring.js';
import type { HealthReport, RepoReport, RuleResult } from './types.js';

export function buildRepoSummary(
  repo: string,
  defaultBranch: string,
  rules: RuleResult[],
): RepoReport {
  const score = aggregateRepoScore(rules);

  return {
    repo,
    defaultBranch,
    score,
    grade: gradeFromScore(score),
    rules,
  };
}

export function buildFleetSummary(repos: RepoReport[]): HealthReport['fleet'] {
  const repoCount = repos.length;
  const scores = repos.map((repo) => repo.score).filter((score): score is number => score !== null);
  const averageScore =
    scores.length === 0
      ? null
      : Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1));
  const grades = repos.reduce<Record<string, number>>((acc, repo) => {
    acc[repo.grade] = (acc[repo.grade] ?? 0) + 1;
    return acc;
  }, {});

  return {
    repoCount,
    averageScore,
    grades,
  };
}

export function buildHealthReport(
  repos: Array<{ repo: string; defaultBranch: string; rules: RuleResult[] }>,
  generatedAt: string = new Date().toISOString(),
): HealthReport {
  const repoReports = repos.map((repo) =>
    buildRepoSummary(repo.repo, repo.defaultBranch, repo.rules),
  );

  return {
    schemaVersion: 1,
    tool: {
      name: TOOL_NAME,
      version: TOOL_VERSION,
    },
    generatedAt,
    repos: repoReports,
    fleet: buildFleetSummary(repoReports),
  };
}

export function buildBadgePayload(repo: RepoReport): {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
} {
  const colorMap: Record<string, string> = {
    A: 'brightgreen',
    B: 'green',
    C: 'yellow',
    D: 'orange',
    F: 'red',
    'N/A': 'lightgrey',
  };

  const badgeGrade = repo.grade === 'N/A' ? 'N/A' : repo.grade;
  const message =
    repo.score === null ? `${badgeGrade}` : `${badgeGrade} (${repo.score.toFixed(1)})`;

  return {
    schemaVersion: 1,
    label: 'repo health',
    message,
    color: colorMap[badgeGrade] ?? 'lightgrey',
  };
}
