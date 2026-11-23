// Prove the official comparator rejects a visual change without rewriting any golden.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const goldenDir = resolve('test/visual/__screenshots__/chromium-win32');
const hashes = async () => Object.fromEntries(await Promise.all((await readdir(goldenDir)).sort().map(async name =>
  [name, createHash('sha256').update(await readFile(resolve(goldenDir, name))).digest('hex')])));
const before = await hashes();
assert.ok(before['desktop-viewport.png'], 'record and review the desktop baseline before running the negative control');
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--grep', 'desktop$'], {
  stdio: 'inherit', env: { ...process.env, AU05_VISUAL_PREFLIGHT: '0', AU05_VISUAL_NEGATIVE_CONTROL: '1' },
});
if (result.error) throw result.error;
assert.equal(result.status, 1, 'deliberate visual regression must fail');
const report = JSON.parse(await readFile('test-results/au05-visual-report.json', 'utf8'));
const specs = suite => [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
const failures = report.suites.flatMap(specs).flatMap(spec => spec.tests).flatMap(test => test.results)
  .filter(result => result.status === 'failed');
assert.equal(failures.length, 1, 'exactly the desktop negative control must fail');
assert.match(failures[0].error?.message ?? '', /toHaveScreenshot/);
assert.ok(failures[0].attachments.some(item => item.name.endsWith('-diff.png')), 'official Playwright pixel diff must be emitted');
assert.deepEqual(await hashes(), before, 'no golden may be created, removed or updated by comparison');
await mkdir('test-results/au05-negative', { recursive: true });
for (const attachment of failures[0].attachments.filter(item => item.path)) {
  await cp(attachment.path, resolve('test-results/au05-negative', attachment.path.split(/[\\/]/).pop()));
}
await writeFile('test-results/au05-negative/proof.json', JSON.stringify({ officialDiffRejected: true, goldenCount: Object.keys(before).length, goldenHashesUnchanged: true, error: failures[0].error.message }, null, 2));
console.log('Negative control passed: official screenshot diff rejected the magenta panel; all golden SHA-256 hashes unchanged.');
