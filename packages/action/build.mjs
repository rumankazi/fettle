/**
 * Bundles the Action into the committed `dist/index.js`.
 *
 * This used to carry a `createRequire` banner, because `@actions/core` was
 * CommonJS and esbuild's ESM output replaces `require` with a shim that throws.
 * Nothing in the graph is CommonJS any more, so the banner is gone — and CI runs
 * the built artefact on every pull request, which is what would catch its return.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  // Must match `runs.using` in action.yml, which is what the runner provides.
  target: 'node24',
  // ESM, because `@fettle/core` and this package are both ESM and the nearest
  // package.json declares `"type": "module"`.
  format: 'esm',
});
