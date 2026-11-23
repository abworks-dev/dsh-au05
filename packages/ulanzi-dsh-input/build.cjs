'use strict';
// Local-only packaging; no install hooks, downloads, Studio launch, profile edits or device access.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = __dirname;
const arg = process.argv.indexOf('--vendor-source');
if (arg !== -1) {
  const source = path.resolve(process.argv[arg + 1] || '');
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (metadata.name !== 'ws' || metadata.version !== '8.18.0') throw new Error('reviewed_ws_source_required');
  const target = path.join(root, 'vendor', 'ws');
  fs.mkdirSync(target, { recursive: true });
  // Retained dependency is the Node CommonJS runtime subset, not browser/ESM entrypoints.
  for (const name of ['package.json', 'LICENSE', 'index.js', 'lib']) {
    const from = path.join(source, name), to = path.join(target, name);
    if (fs.existsSync(to)) {
      if (!fs.statSync(from).isFile() || !fs.readFileSync(from).equals(fs.readFileSync(to))) throw new Error('vendor_already_exists');
      continue;
    }
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
  }
}
const vendor = path.join(root, 'vendor', 'ws');
if (JSON.parse(fs.readFileSync(path.join(vendor, 'package.json'), 'utf8')).version !== '8.18.0') throw new Error('reviewed_ws_source_required');
const output = path.join(root, 'bundle', 'com.abworks.dshinput.ulanziPlugin');
const refresh = process.argv.includes('--refresh');
if (fs.existsSync(output)) {
  if (!refresh) throw new Error('bundle_already_exists');
  const recorded = JSON.parse(fs.readFileSync(path.join(root, 'bundle', 'hashes.json'), 'utf8'));
  for (const [name, digest] of Object.entries(recorded)) {
    const filename = path.resolve(output, name);
    if (!filename.startsWith(output + path.sep) || createHash('sha256').update(fs.readFileSync(filename)).digest('hex') !== digest) throw new Error('bundle_modified');
  }
  function verifyOnlyRecorded(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('bundle_symlink_forbidden');
      if (entry.isDirectory()) verifyOnlyRecorded(filename);
      else if (!Object.hasOwn(recorded, path.relative(output, filename).split(path.sep).join('/'))) throw new Error('unexpected_bundle_file');
    }
  }
  verifyOnlyRecorded(output);
}
fs.mkdirSync(output, { recursive: true });
for (const name of ['manifest.json', 'package.json', 'service.js', 'service.cjs', 'producer.cjs', 'assets', 'vendor', 'README.md', 'THIRD_PARTY_NOTICES.md']) {
  fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true, errorOnExist: !refresh, force: refresh });
}
const hashes = {};
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('bundle_symlink_forbidden');
    if (entry.isDirectory()) walk(filename);
    else hashes[path.relative(output, filename).split(path.sep).join('/')] = createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  }
}
walk(output);
fs.writeFileSync(path.join(root, 'bundle', 'hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Built ${Object.keys(hashes).length} files; no installation performed.`);
