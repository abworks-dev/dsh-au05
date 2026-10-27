import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
async function collect(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.local'].includes(item.name)) continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await collect(path)); else result.push(path);
  }
  return result;
}
const files = await collect(root);
for (const file of files) {
  const content = await readFile(file, 'utf8');
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
      await access(resolve(dirname(file), decodeURIComponent(target.split('#')[0])));
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
