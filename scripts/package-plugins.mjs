// Local release preparation only. Never publishes, installs, connects or runs lifecycle scripts.
import { readFile, writeFile, mkdir, copyFile, cp, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm || !isAbsolute(npm) || !npm.endsWith('.js')) throw new Error('run_with_npm_run_pack_plugins');
const dist = resolve(root, 'dist');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version)) throw new Error('invalid_release_version');
const stage = resolve(root, '.local', `package-${randomUUID()}`, `AU05-${version}`);
await mkdir(dist, { recursive: true }); await mkdir(stage, { recursive: true });
const report = [];
for (const folder of ['packages/dsh-plugin', 'packages/dsh-studio-hook']) {
  const child = spawnSync(process.execPath, [npm, 'pack', `./${folder}`, '--ignore-scripts', '--json', '--pack-destination', dist],
    { cwd: root, shell: false, encoding: 'utf8', timeout: 30000 });
  if (child.error || child.status !== 0) throw new Error('local_pack_failed');
  const metadata = JSON.parse(child.stdout);
  const rows = Array.isArray(metadata) ? metadata : Object.values(metadata);
  if (rows.length !== 1) throw new Error('ambiguous_pack_metadata');
  const [packed] = rows;
  if (packed.version !== version || basename(packed.filename) !== packed.filename) throw new Error('invalid_pack_metadata');
  const base = resolve(root, folder);
  const included = new Set();
  for (const row of packed.files) {
    const file = row.path, source = resolve(base, file), rel = relative(base, source);
    if (isAbsolute(rel) || rel.startsWith('..') || /(?:^|[\\/])(?:\.local|\.env[^/\\]*|node_modules)(?:[\\/]|$)/.test(file)
      || !(await lstat(source)).isFile()) throw new Error('unsafe_package_file');
    included.add(file);
    const destination = resolve(stage, folder, file);
    await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination);
  }
  for (const file of ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'LICENSE']) {
    if (!included.has(file)) throw new Error('incomplete_plugin_package');
  }
  if (folder.endsWith('dsh-studio-hook') && ['runtime.js', 'mode-lease.js', 'input.js', 'input-runtime.js', 'feature-rpc.js'].some(file => !included.has(file))) throw new Error('missing_runtime');
  const bytes = await readFile(resolve(dist, packed.filename));
  report.push({ name: packed.name, version, filename: packed.filename, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), files: packed.files.length });
}
// Bundle only our reviewed, hash-inventoried Studio producer; never a live pairing file.
const producerRoot = resolve(root, 'packages/ulanzi-dsh-input');
const built = spawnSync(process.execPath, [resolve(producerRoot, 'build.cjs'), '--refresh'], { cwd: root, shell: false, encoding: 'utf8', timeout: 30000 });
if (built.error || built.status !== 0) throw new Error('studio_input_bundle_failed');
const producerName = 'com.abworks.dshinput.ulanziPlugin';
const producerBase = resolve(producerRoot, 'bundle', producerName);
const inventory = JSON.parse(await readFile(resolve(producerRoot, 'bundle/hashes.json'), 'utf8'));
for (const [file, digest] of Object.entries(inventory)) {
  const source = resolve(producerBase, file), rel = relative(producerBase, source);
  if (isAbsolute(rel) || rel.startsWith('..') || /(?:^|[\\/])(?:bridge\\.json|\\.env[^/]*|node_modules)(?:[\\/]|$)/.test(file)
    || !(await lstat(source)).isFile()) throw new Error('unsafe_studio_input_file');
  if (createHash('sha256').update(await readFile(source)).digest('hex') !== digest) throw new Error('studio_input_hash_mismatch');
  const destination = resolve(stage, 'StudioPlugin', producerName, file);
  await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination);
}
await copyFile(resolve(producerRoot, 'bundle/hashes.json'), resolve(stage, 'StudioPlugin/hashes.json'));
await mkdir(resolve(stage, 'packages/ulanzi-dsh-input'), { recursive: true });
await copyFile(resolve(producerRoot, 'README.md'), resolve(stage, 'packages/ulanzi-dsh-input/README.md'));
await cp(resolve(root, 'docs'), resolve(stage, 'docs'), { recursive: true });
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md']) await copyFile(resolve(root, file), resolve(stage, file));
await writeFile(resolve(stage, 'README.md'), (await readFile(resolve(root, 'docs/quick-start-dev.md'), 'utf8')).replace('(<product-guide.md>)', '(<docs/product-guide.md>)'));
const zip = `AU05-${version}.zip`;
const archived = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(root, 'scripts/archive-plugins.ps1'),
  '-Source', stage, '-Destination', resolve(dist, zip)], { cwd: root, shell: false, encoding: 'utf8', timeout: 30000 });
if (archived.error || archived.status !== 0) throw new Error('local_zip_failed');
const bytes = await readFile(resolve(dist, zip));
report.push({ name: 'AU05 local bundle', version, filename: zip, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
await writeFile(resolve(dist, 'manifest.json'), JSON.stringify({ version, published: false, hardwareTested: false, artifacts: report }, null, 2) + '\n');
console.log(JSON.stringify({ version, published: false, artifacts: report }, null, 2));
