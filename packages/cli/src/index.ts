#!/usr/bin/env node

import { run } from './cli.js';

process.exitCode = await run({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (chunk) => process.stderr.write(chunk),
  isTty: process.stdout.isTTY === true,
  columns: process.stdout.columns,
});
