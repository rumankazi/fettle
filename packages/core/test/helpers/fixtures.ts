import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads a recorded API response shape.
 *
 * Fixtures stay as `.json` so they can be replaced by a genuine recorded response
 * without translation.
 */
export function fixture<T = unknown>(name: string): T {
  const path = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
