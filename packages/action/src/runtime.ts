/**
 * The real `ActionRuntime`: `@actions/core` for the runner protocol, `node:fs`
 * for the workspace, `fetch` for the optional report POST.
 *
 * Kept apart from `action.ts` so the logic there never imports a module that only
 * works inside a runner.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as core from '@actions/core';
import type { ActionRuntime } from './action.js';

export function createActionRuntime(): ActionRuntime {
  return {
    getInput: (name) => core.getInput(name),
    getEnv: (name) => process.env[name],
    setOutput: (name, value) => core.setOutput(name, value),
    info: (message) => core.info(message),
    warning: (message) => core.warning(message),
    setFailed: (message) => core.setFailed(message),

    writeSummary: async (markdown) => {
      // Falls back to the log when GITHUB_STEP_SUMMARY is absent, so running the
      // bundle outside a runner still shows the report rather than throwing.
      if (process.env.GITHUB_STEP_SUMMARY === undefined) {
        core.info(markdown);
        return;
      }
      await core.summary.addRaw(markdown, true).write();
    },

    writeFile: async (path, contents) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, 'utf8');
    },

    postJson: async (url, body, timeoutMs) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
    },
  };
}
