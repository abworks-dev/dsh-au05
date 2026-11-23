import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
async function collect(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.local', 'Temp', '.dsh', '.impeccable', 'dist', 'coverage',
      'test-results', 'playwright-report'].includes(item.name)) continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await collect(path)); else result.push(path);
  }
  return result;
}
// Check the reviewable set: what git would publish, i.e. tracked files plus untracked files
// that are not ignored. That is the same set locally and on a fresh clone, and it keeps
// scratch directories (Temp/, .dsh/, .local/) out of the scan.
async function collectReviewable() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const listed = [...new Set(out.split('\0').filter(Boolean))].map(name => resolve(root, name));
    const kept = [];
    for (const path of listed) {
      try { await access(path); kept.push(path); } catch { /* tracked but deleted in this checkout */ }
    }
    if (kept.length > 0) return kept;
  } catch { /* not a git checkout: fall back to walking the tree */ }
  return collect(root);
}
const files = await collectReviewable();
// Markdown links must resolve inside the reviewable set: a link to a local scratch file
// (Temp/, .local/) would pass here and 404 on every fresh clone, so it fails instead.
const known = new Set(files.map(file => relative(root, file).replaceAll('\\', '/')));
function linkTargetsPublished(target) {
  if (known.has(target)) return true;
  const prefix = target.endsWith('/') ? target : `${target}/`;
  for (const path of known) if (path.startsWith(prefix)) return true;
  return false;
}
for (const file of files) {
  const bytes = await readFile(file);
  if (bytes.includes(0)) continue; // binary asset: no text encoding or link review applies
  const content = bytes.toString('utf8');
  if (content.includes('\uFFFD')) throw new Error(`replacement_character: ${file}`);
  // Conservative credential patterns; does not constitute a full secret scan.
  for (const pattern of [/gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /sk-[A-Za-z0-9]{24,}/])
    if (pattern.test(content)) throw new Error(`possible_secret: ${file}`);
  if (extname(file) === '.json') JSON.parse(content);
  if (extname(file) === '.md') {
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '');
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const resolved = relative(root, resolve(dirname(file), decodeURIComponent(target.split('#')[0]))).replaceAll('\\', '/');
      if (!linkTargetsPublished(resolved)) throw new Error(`missing_link: ${relative(root, file)} -> ${target}`);
    }
  }
}
for (const path of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', '.gitignore',
  'docs/architecture.md', 'docs/dsh-plugin.md', 'docs/hardware.md', 'docs/protocol.md',
  'docs/security.md', 'docs/validation.md', 'docs/roadmap.md', 'docs/sources.md',
  'packages/dsh-plugin/client.js', '.github/workflows/ci.yml']) await access(resolve(root, path));
const ignored = await readFile(resolve(root, '.gitignore'), 'utf8');
if (!ignored.includes('.local/') || !ignored.includes('.env')) throw new Error('missing_secret_exclusions');
console.log(`PASS: ${files.length} source files; JSON, local Markdown links, UTF-8 and basic credential patterns checked.`);
