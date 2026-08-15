/**
 * GitHub Action entry point. Bundled to `dist/index.js` and committed, so
 * consumers never run an install.
 */

import { runAction } from './action.js';
import { createActionRuntime } from './runtime.js';

await runAction({ runtime: createActionRuntime() });
