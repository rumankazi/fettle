/**
 * Every user-visible occurrence of the product name resolves here, so renaming the
 * tool stays a mechanical change to this file plus the package names.
 */

export const TOOL_NAME = 'fettle';
export const TOOL_VERSION = '2.0.1'; // x-release-please-version

/** The per-repository configuration file we look for on the default branch. */
export const CONFIG_FILENAME = '.fettle.yml';

/**
 * Label shown on the shields.io badge.
 *
 * Deliberately the metric rather than the product name, matching how shields
 * badges read elsewhere ("coverage", "build", "downloads").
 */
export const BADGE_LABEL = 'repo health';

/** Where the Action writes `report.json` and `badge/<repo>.json` by default. */
export const DEFAULT_OUTPUT_DIR = 'fettle-report';
