/**
 * GitHub Action entry point.
 *
 * Phase 5 wires this to `action.yml` inputs, the step summary, report/badge files
 * and the optional `report-url` POST. Until the GitHub fetch layer exists there is
 * nothing honest for it to report, so it fails loudly rather than emitting a grade
 * it did not measure.
 */

import { TOOL_NAME, TOOL_VERSION } from '@fettle/core';

process.exitCode = 1;
process.stderr.write(
  `${TOOL_NAME} ${TOOL_VERSION}: the Action is not implemented yet (Phase 5). ` +
    `The scoring engine is usable today via the @fettle/core library.\n`,
);
