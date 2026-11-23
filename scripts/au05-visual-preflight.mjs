// Cross-platform environment setup without another npm dependency.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, AU05_VISUAL_PREFLIGHT: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
