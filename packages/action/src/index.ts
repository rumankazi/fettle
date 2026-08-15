import { assess, TOOL_NAME } from '@fettle/core';

async function run(): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY ?? 'example/demo';
  const report = await assess(repo);

  console.log(`Fettle action for ${TOOL_NAME}: ${report.grade} (${report.score ?? 'N/A'})`);
}

void run();
