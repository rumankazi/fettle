/**
 * Bundles the Action into the committed `dist/index.js`.
 *
 * A script rather than a flag soup in package.json, because the banner below needs
 * explaining.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  // The runner pins the Node major version through `runs.using` in action.yml.
  target: 'node20',
  // ESM, because `@fettle/core` and this package are both ESM and the nearest
  // package.json declares `"type": "module"`.
  format: 'esm',
  banner: {
    js: [
      '// `@actions/core` is CommonJS. When esbuild emits ESM it replaces `require`',
      '// with a shim that throws unless a real `require` is in scope, so put one',
      '// there. Without this the bundle dies on load with "Dynamic require of',
      '// \\"os\\" is not supported".',
      "import { createRequire as __fettleCreateRequire } from 'node:module';",
      'const require = __fettleCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
