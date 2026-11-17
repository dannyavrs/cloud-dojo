/** Import first in any script that writes learner progress. Refuses to run against the real data folders. */
import path from 'node:path'
import { DATA_DIR, DATA_DIR_OVERRIDE, DEFAULT_DATA_DIR, LEGACY_DATA_DIR } from '../server/paths'

if (!DATA_DIR_OVERRIDE || [DEFAULT_DATA_DIR, LEGACY_DATA_DIR].includes(path.resolve(DATA_DIR))) {
  console.error('Refusing to run: this script would write to your real progress folder.\nUse `bun run test:e2e` / `bun run capture`, or set CLOUD_DOJO_DATA_DIR to a temp folder (see scripts/with-temp-data.ts).')
  process.exit(2)
}
