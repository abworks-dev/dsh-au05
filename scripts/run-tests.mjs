// Runs the specs this repository publishes. The file list comes from git (tracked specs),
// so `npm test` exercises exactly what a fresh clone would, and an untracked draft never
// turns the suite red for everyone else. A plain directory walk is the fallback outside git.
//
// The hardware specs drive Windows PowerShell scripts against the real device
// (au05.ps1 -Mode Connect, native-wheel.ps1, the bageshuo bridge). With DSH running they
// wait on its single-instance device lock and never return, and a CI runner has no device
// at all, so they are opt-in: `npm run test:native`.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const HARDWARE_SPECS = new Set([
  'au05-brightness-native.test.js',
  'au05-key-feedback-native.test.js',
  'au05-native.test.js',
  'au05-snapshot-recovery.test.js',
  'au05-wake-recovery.test.js',
  'bageshuo-native-liveness.test.js',
  'bageshuo-native-recovery.test.js',
  'bageshuo-state.test.js',
  'observer-gui.test.js',
  'shortcut-voice.test.js',
  'windows-voice-state.test.js',
  'windows-voice.test.js',
]);
const nameOf = path => path.slice(path.lastIndexOf('/') + 1);

function publishedSpecs() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', 'test'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const names = out.split('\0').filter(path => /^test\/[^/]+\.test\.js$/.test(path)).map(nameOf);
    if (names.length > 0) return names;
  } catch { /* not a git checkout */ }
  return readdirSync(new URL('../test/', import.meta.url)).filter(name => name.endsWith('.test.js'));
}

const hardwareOnly = process.argv.includes('--hardware-only');
const names = publishedSpecs()
  .filter(name => hardwareOnly ? HARDWARE_SPECS.has(name) : !HARDWARE_SPECS.has(name))
  .sort();
if (names.length === 0) throw new Error('no published test files matched');
console.log(`# ${hardwareOnly ? 'hardware' : 'default'} suite: ${names.length} specs`
  + ` (${HARDWARE_SPECS.size} hardware specs ${hardwareOnly ? 'included' : 'excluded; use npm run test:native'})`);
const result = spawnSync(process.execPath, ['--test', ...names.map(name => `test/${name}`)], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
