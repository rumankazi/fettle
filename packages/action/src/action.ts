/**
 * The Action's behaviour, expressed against an injected runtime.
 *
 * Everything that touches the outside world — inputs, the workspace, the step
 * summary, outputs, the network — goes through `ActionRuntime`, so the whole
 * Action can be exercised in a test without a runner.
 */

import {
  assess,
  badgeFilename,
  badgeSvgFilename,
  buildBadgePayload,
  CONFIG_FILENAME,
  DEFAULT_OUTPUT_DIR,
  gradeFromScore,
  isFloorGrade,
  meetsGradeFloor,
  renderBadgeSvg,
  renderMarkdown,
  TOOL_NAME,
  type AssessOptions,
  type FloorGrade,
  type HealthReport,
} from '@fettle/core';

/** How long to wait on the optional report POST before giving up on it. */
const REPORT_POST_TIMEOUT_MS = 10_000;

export interface ActionRuntime {
  /** Reads an `action.yml` input; returns `''` when unset. */
  getInput(name: string): string;
  getEnv(name: string): string | undefined;
  setOutput(name: string, value: string): void;
  info(message: string): void;
  warning(message: string): void;
  setFailed(message: string): void;
  /** Appends markdown to the job summary. */
  writeSummary(markdown: string): Promise<void>;
  /** Writes a file, creating parent directories. */
  writeFile(path: string, contents: string): Promise<void>;
  postJson(url: string, body: string, timeoutMs: number): Promise<void>;
}

export interface ActionInputs {
  repos: string[];
  token?: string;
  configPath: string;
  failBelow?: FloorGrade;
  reportUrl?: string;
  outputDir: string;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function readInputs(runtime: ActionRuntime): ActionInputs {
  const reposInput = optional(runtime.getInput('repos')) ?? runtime.getEnv('GITHUB_REPOSITORY');
  const repos = (reposInput ?? '')
    .split(/[\n,]+/)
    .map((repo) => repo.trim())
    .filter((repo) => repo.length > 0);

  if (repos.length === 0) {
    throw new InputError(
      'no repositories to scan: set the `repos` input, or run this Action in a repository.',
    );
  }

  for (const repo of repos) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      throw new InputError(`'${repo}' is not a repository name of the form org/name`);
    }
  }

  const failBelowInput = optional(runtime.getInput('fail-below'));
  if (failBelowInput !== undefined && !isFloorGrade(failBelowInput)) {
    throw new InputError(
      `fail-below must be one of A, B, C, D, F; received '${failBelowInput}'. ` +
        `A floor of N/A would gate on nothing.`,
    );
  }

  return {
    repos,
    token: optional(runtime.getInput('token')),
    configPath: optional(runtime.getInput('config-path')) ?? CONFIG_FILENAME,
    failBelow: failBelowInput,
    reportUrl: optional(runtime.getInput('report-url')),
    outputDir: optional(runtime.getInput('output-dir')) ?? DEFAULT_OUTPUT_DIR,
  };
}

/** Joins path segments without pulling in `node:path`, which the runtime owns. */
function join(...segments: string[]): string {
  return segments.map((segment) => segment.replace(/\/+$/, '')).join('/');
}

/**
 * Writes the report, and two badges per repository.
 *
 * The SVG is the one most people want: commit it and reference it by relative path
 * and it renders on a private repository and on GitHub Enterprise Server, with no
 * third party fetching anything. The shields.io payload is for public repositories
 * that would rather let shields draw it.
 *
 * The Action deliberately does not upload these as artifacts — that is
 * `actions/upload-artifact`'s job, and pairing with it keeps our dependency
 * surface at zero and leaves retention to the user.
 */
async function writeReportFiles(
  runtime: ActionRuntime,
  report: HealthReport,
  outputDir: string,
): Promise<string> {
  const reportPath = join(outputDir, 'report.json');
  await runtime.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  for (const repo of report.repos) {
    const payload = buildBadgePayload(repo);
    await runtime.writeFile(
      join(outputDir, 'badge', badgeFilename(repo.repo)),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
    await runtime.writeFile(
      join(outputDir, 'badge', badgeSvgFilename(repo.repo)),
      renderBadgeSvg(payload),
    );
  }

  return reportPath;
}

/**
 * Sends the report to a user-configured endpoint.
 *
 * Failures are warnings, never failures of the run: a dashboard being down says
 * nothing about the health of the repositories we just graded.
 */
async function postReport(
  runtime: ActionRuntime,
  url: string,
  report: HealthReport,
): Promise<void> {
  try {
    await runtime.postJson(url, JSON.stringify(report), REPORT_POST_TIMEOUT_MS);
    runtime.info(`Posted the report to ${url}.`);
  } catch (error) {
    runtime.warning(
      `Could not post the report to ${url}: ${error instanceof Error ? error.message : String(error)}. ` +
        `The scan itself succeeded.`,
    );
  }
}

export type Scanner = (repos: readonly string[], options: AssessOptions) => Promise<HealthReport>;

export interface RunActionOptions {
  runtime: ActionRuntime;
  /** Injected so the Action is testable without a network. */
  scan?: Scanner;
  now?: Date;
}

/** Runs the Action. Reports problems through the runtime rather than throwing. */
export async function runAction({
  runtime,
  scan = assess,
  now,
}: RunActionOptions): Promise<HealthReport | undefined> {
  let inputs: ActionInputs;
  try {
    inputs = readInputs(runtime);
  } catch (error) {
    runtime.setFailed(error instanceof Error ? error.message : String(error));
    return undefined;
  }

  let report: HealthReport;
  try {
    report = await scan(inputs.repos, {
      token: inputs.token,
      configPath: inputs.configPath,
      now,
      onWarning: (repo, warning) => runtime.warning(`${repo}: ${warning}`),
    });
  } catch (error) {
    runtime.setFailed(error instanceof Error ? error.message : String(error));
    return undefined;
  }

  const reportPath = await writeReportFiles(runtime, report, inputs.outputDir);
  await runtime.writeSummary(renderMarkdown(report));

  // For a single repository the fleet average is that repository's score, so one
  // rule covers both cases without a special case.
  const score = report.fleet.averageScore;
  runtime.setOutput('grade', gradeFromScore(score));
  runtime.setOutput('score', score === null ? '' : String(score));
  runtime.setOutput('report-path', reportPath);

  if (inputs.reportUrl !== undefined) {
    await postReport(runtime, inputs.reportUrl, report);
  }

  if (inputs.failBelow !== undefined) {
    const floor = inputs.failBelow;
    const failures = report.repos.filter((repo) => !meetsGradeFloor(repo.grade, floor));

    if (failures.length > 0) {
      runtime.setFailed(
        `${failures.length} repository/repositories graded below ${floor}: ` +
          failures.map((repo) => `${repo.repo} (${repo.grade})`).join(', '),
      );
      return report;
    }
  }

  runtime.info(`${TOOL_NAME} graded ${report.repos.length} repository/repositories.`);
  return report;
}
