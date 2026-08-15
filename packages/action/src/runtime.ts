/**
 * The real `ActionRuntime`, written against the runner protocol directly.
 *
 * This was `@actions/core`. That package brought `@actions/exec`, `@actions/io`,
 * `@actions/http-client`, `tunnel`, `@fastify/busboy` and `undici` with it — around
 * three quarters of the bundle we ship to consumers, and three high-severity
 * advisories in code we never call — in exchange for the six functions below. Each
 * is a documented file or stdout convention, so we implement them.
 *
 * The protocol: https://docs.github.com/actions/reference/workflow-commands
 */

import { appendFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ActionRuntime } from './action.js';

/**
 * Escapes a value for a `::command::` line.
 *
 * A raw newline would end the command and let the rest of the string be
 * interpreted as workflow output — so evidence from a scanned repository must not
 * reach a log line unescaped.
 */
function escapeCommandData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** `INPUT_CONFIG_PATH` for `config-path`, per the runner's input convention. */
function inputVariable(name: string): string {
  return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
}

/**
 * Formats one entry for `$GITHUB_OUTPUT`.
 *
 * The heredoc form is what supports multi-line values. The delimiter is random per
 * call: a value containing the delimiter could otherwise close the block early and
 * have the remainder parsed as further outputs.
 */
export function formatOutputEntry(name: string, value: string): string {
  const delimiter = `ghadelimiter_${randomUUID()}`;

  if (name.includes(delimiter) || value.includes(delimiter)) {
    throw new Error(`refusing to write output '${name}': it contains the delimiter`);
  }
  if (name.includes('\n')) {
    throw new Error(`refusing to write output '${name}': names cannot contain newlines`);
  }

  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

export interface RuntimeOptions {
  env?: Record<string, string | undefined>;
  /** Where log lines and workflow commands go. */
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
}

export function createActionRuntime(options: RuntimeOptions = {}): ActionRuntime {
  const env = options.env ?? process.env;
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });

  const command = (name: string, message: string) =>
    write(`::${name}::${escapeCommandData(message)}\n`);

  return {
    getInput: (name) => (env[inputVariable(name)] ?? '').trim(),
    getEnv: (name) => env[name],

    setOutput: (name, value) => {
      const path = env.GITHUB_OUTPUT;
      if (path === undefined || path === '') {
        // Outside a runner there is nowhere to put outputs; say so rather than
        // failing, so the bundle stays runnable for a smoke test.
        write(`::debug::output ${name}=${value} (no GITHUB_OUTPUT)\n`);
        return;
      }
      appendFileSync(path, formatOutputEntry(name, value), 'utf8');
    },

    info: (message) => write(`${message}\n`),
    warning: (message) => command('warning', message),

    setFailed: (message) => {
      command('error', message);
      setExitCode(1);
    },

    writeSummary: async (markdown) => {
      const path = env.GITHUB_STEP_SUMMARY;
      if (path === undefined || path === '') {
        // Falls back to the log so running the bundle outside a runner still shows
        // the report rather than throwing.
        write(`${markdown}\n`);
        return;
      }
      await appendFile(path, `${markdown}\n`, 'utf8');
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
