import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, lstat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createObserver, INPUT_EVENTS } from '../apps/observer/server.mjs';
import { createCollector, createPrivateToken } from '../apps/observer/main.mjs';

const token = 'a'.repeat(64);
const origin = 'http://127.0.0.1:60890';
async function fixture(t) {
  // Synthetic HTTP fixture only. Importing main never starts pwsh or opens hardware.
  const server = createObserver({ token, origins: [origin] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server;
}
function request(server, { path = '/v1/health', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method,
      headers: { authorization: `Bearer ${token}`, origin, ...headers }, agent: false }, res => {
      let text = '';
      res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text,
        data: text ? JSON.parse(text) : undefined }));
    });
    req.on('error', reject); req.end(body);
  });
}
function stream(server) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: '/v1/events',
      headers: { authorization: `Bearer ${token}`, origin }, agent: false }, res => {
      let buffer = '';
      const queued = [], waiting = [];
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          if (frame.startsWith(':')) continue;
          const event = frame.match(/^event: (.+)$/mu)?.[1];
          const data = JSON.parse(frame.match(/^data: (.+)$/mu)?.[1]);
          const value = { event, data };
          if (waiting.length) waiting.shift()(value); else queued.push(value);
        }
      });
      resolve({ res, next: () => queued.length ? Promise.resolve(queued.shift()) : new Promise(done => waiting.push(done)) });
    });
    req.on('error', reject);
  });
}
function collectorFixture() {
  const server = createObserver({ token });
  const records = [], finishes = [];
  const ingest = server.ingest, finish = server.finish;
  server.ingest = record => { const accepted = ingest(record); if (accepted) records.push(record); return accepted; };
  server.finish = status => { finishes.push(status); return finish(status); };
  let stops = 0;
  const collector = createCollector(server, () => { stops++; });
  return { server, collector, records, finishes, get stops() { return stops; } };
}

// All data below is synthetic. None of these tests invoke main/startObserver/list/capture.
test('observer configuration is token-protected and exact loopback origins only', () => {
  for (const value of ['', '*', 'a'.repeat(63), 'A'.repeat(64), 'hello', `${token}\n`, `${token}\r\n`]) assert.throws(() => createObserver({ token: value }));
  for (const value of ['*', 'http://evil.test', 'http://localhost/path', 'http://localhost/',
    'http://user@localhost', 'file://localhost', 'http://localhost?x=1', 'http://127.0.0.1:80',
    'dsh-app://other', 'dsh-app://app/', 'dsh-app://app:123', 'other-app://app', 'null'])
    assert.throws(() => createObserver({ token, origins: [value] }));
  assert.throws(() => createObserver({ token, origins: [] }));
  for (const value of ['http://localhost:60890', 'http://127.0.0.1:60890', 'https://[::1]:60890', 'dsh-app://app'])
    assert.ok(createObserver({ token, origins: [value] }) instanceof http.Server);
});

test('health starts unverified, sanitized, safe and read-only; authenticated local GET only', async t => {
  const server = await fixture(t);
  const result = await request(server);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { mode: 'read-only', hardware: false, readOnly: true, writes: 0,
    finished: false, sequence: 0, counts: Object.fromEntries(INPUT_EVENTS.map(event => [event, 0])) });
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['access-control-allow-origin'], origin);
  assert.equal((await request(server, { headers: { authorization: '' } })).status, 401);
  assert.equal((await request(server, { headers: { authorization: `Bearer ${'b'.repeat(64)}` } })).status, 401);
  for (const host of ['localhost', 'localhost:17376', '127.0.0.1', 'evil.test', '[::1]:17376'])
    assert.equal((await request(server, { headers: { host } })).status, 403);
  for (const value of ['null', '*', 'http://localhost:60890', 'http://127.0.0.1:60890/', 'http://127.0.0.1:60891'])
    assert.equal((await request(server, { headers: { origin: value } })).status, 403);
  for (const path of ['/v1/health?token=private_marker', '/v1/events?x=1', '/v1/%68ealth', '/v1/events/',
    '/v1/lease', '/v1/control', '/v1/mock/input', '//v1/health']) assert.equal((await request(server, { path })).status, 404);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
    assert.equal((await request(server, { method })).status, 405);
});

test('CORS permits Authorization-only GET preflight, never control or wildcard headers', async t => {
  const server = await fixture(t);
  const headers = { authorization: '', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' };
  const result = await request(server, { method: 'OPTIONS', headers });
  assert.equal(result.status, 204);
  assert.equal(result.headers['access-control-allow-methods'], 'GET');
  assert.equal(result.headers['access-control-allow-headers'], 'Authorization');
  assert.equal(result.headers['cache-control'], 'no-store');
  for (const change of [{ 'access-control-request-method': 'POST' },
    { 'access-control-request-headers': 'authorization, content-type' },
    { 'access-control-request-headers': 'x-au05-lease' }, { 'access-control-request-headers': '*' }])
    assert.equal((await request(server, { method: 'OPTIONS', headers: { ...headers, ...change } })).status, 403);
});

test('official desktop origin is exact, enabled by default, and gets only GET Authorization CORS', async t => {
  const server = createObserver({ token });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const result = await request(server, { headers: { origin: 'dsh-app://app' } });
  assert.equal(result.status, 200); assert.equal(result.headers['access-control-allow-origin'], 'dsh-app://app');
  const preflight = await request(server, { method: 'OPTIONS', headers: { origin: 'dsh-app://app',
    'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-headers'], 'Authorization');
  assert.equal(preflight.headers['access-control-allow-methods'], 'GET');
  for (const value of ['null', '*', 'dsh-app://other', 'dsh-app://app/', 'dsh-app://app:60890'])
    assert.equal((await request(server, { headers: { origin: value } })).status, 403);
});

test('body and header size limits reject data without collecting a request body', async t => {
  const server = await fixture(t);
  assert.equal((await request(server, { headers: { 'content-length': '999999999' } })).status, 413);
  assert.equal((await request(server, { headers: { 'transfer-encoding': 'chunked' }, body: 'private_marker' })).status, 413);
  assert.equal((await request(server, { headers: { 'x-large': 'x'.repeat(9000) } })).status, 431);
});

test('SSE begins with snapshot, then fixed input/status only; finish latches and no lease exists', async t => {
  const server = await fixture(t);
  assert.equal(server.ingest({ type: 'input', event: 'k1.down' }), false, 'no events before a verified read handle');
  const client = await stream(server);
  const first = await client.next();
  assert.equal(first.event, 'snapshot'); assert.equal(first.data.type, 'snapshot');
  assert.equal(first.data.hardware, false);
  assert.equal(server.ingest({ type: 'status', event: 'ready' }), true);
  const ready = await client.next();
  assert.equal(ready.event, 'status'); assert.equal(ready.data.event, 'ready'); assert.equal(ready.data.hardware, true);
  assert.equal(server.ingest({ type: 'input', event: 'k1.down' }), true);
  const input = await client.next();
  assert.equal(input.event, 'input'); assert.equal(input.data.event, 'k1.down');
  assert.equal(input.data.sequence, 2); assert.equal(input.data.counts['k1.down'], 1);
  assert.equal(input.data.lastEvent, 'k1.down');
  assert.equal(server.finish('timeout'), true);
  const end = await client.next();
  assert.equal(end.event, 'status'); assert.equal(end.data.event, 'timeout');
  assert.equal(end.data.hardware, false); assert.equal(end.data.finished, true);
  assert.equal(end.data.readOnly, true); assert.equal(end.data.writes, 0);
  assert.equal(server.ingest({ type: 'status', event: 'ready' }), false);
  assert.equal(server.ingest({ type: 'input', event: 'k2.up' }), false);
  assert.equal(server.finish('disconnected'), false);
  const late = await stream(server);
  const snapshot = await late.next();
  assert.equal(snapshot.event, 'snapshot'); assert.equal(snapshot.data.finished, true);
  assert.equal(snapshot.data.counts['k1.down'], 1);
  const { type, event, ...expectedHealth } = end.data;
  assert.deepEqual((await request(server)).data, expectedHealth);
});

test('ingestion rejects extension fields, raw reports, arbitrary events, spoofed counters and unsafe status', async t => {
  const server = await fixture(t);
  const client = await stream(server); await client.next();
  for (const value of [null, [], 'x', { type: 'status', event: 'ready', path: 'private_marker' },
    { type: 'input', event: 'k1.down', sequence: 999999999999999999 },
    { type: 'input', event: 'private_marker' }, { type: 'status', event: 'hardware' },
    { type: 'report', raw: [85, 0, 1] }, Object.create({ type: 'status', event: 'ready' })]) assert.equal(server.ingest(value), false);
  server.ingest({ type: 'status', event: 'ready' }); await client.next();
  for (const event of INPUT_EVENTS) assert.equal(server.ingest({ type: 'input', event }), true);
  const data = (await request(server)).data;
  assert.equal(data.sequence, 11); assert.ok(Number.isSafeInteger(data.sequence));
  assert.deepEqual(Object.values(data.counts), Array(10).fill(1));
  assert.equal(JSON.stringify(data).includes('private_marker'), false);
  assert.equal(server.finish({ status: 'timeout', path: 'private_marker' }), true);
  const health = (await request(server)).data;
  assert.equal(health.finished, true); assert.equal(health.hardware, false);
  assert.equal(JSON.stringify(health).includes('private_marker'), false);
});

test('SSE caps at four clients and shutdown ends open streams and disallows ingestion', async t => {
  const server = await fixture(t);
  const clients = [];
  for (let i = 0; i < 4; i++) { clients.push(await stream(server)); assert.equal((await clients[i].next()).event, 'snapshot'); }
  assert.equal((await request(server, { path: '/v1/events' })).status, 429);
  const ended = clients.map(client => new Promise(resolve => client.res.once('end', resolve)));
  let shutdowns = 0; server.on('observer:shutdown', () => { shutdowns++; });
  await new Promise(resolve => server.close(resolve));
  await Promise.all(ended);
  assert.equal(shutdowns, 1);
  assert.equal(server.ingest({ type: 'status', event: 'ready' }), false);
});

test('server input counters are bounded to the capture report maximum', () => {
  const server = createObserver({ token });
  server.ingest({ type: 'status', event: 'ready' });
  for (let i = 0; i < 10000; i++) assert.equal(server.ingest({ type: 'input', event: 'right.pulse' }), true);
  assert.equal(server.ingest({ type: 'input', event: 'right.pulse' }), false);
});

test('collector parses chunked NDJSON, discards summary extensions, and never reopens', () => {
  const f = collectorFixture();
  f.collector.write(Buffer.from('{"type":"sta'));
  f.collector.write(Buffer.from('tus","event":"ready"}\r\n{"type":"input","event":"k2.up"}\n'));
  f.collector.write(Buffer.from('{"status":"timeout","mode":"capture","writes":0,"raw":"private_marker","eventReportCounts":{"button_1_up":1}}\n'));
  f.collector.end();
  assert.deepEqual(f.records, [{ type: 'status', event: 'ready' }, { type: 'input', event: 'k2.up' }]);
  assert.deepEqual(f.finishes, ['timeout']); assert.equal(f.stops, 0);
  assert.equal(JSON.stringify(f.records).includes('private_marker'), false);
});

test('collector protocol errors and excessive lines stop once with only a fixed code', () => {
  for (const output of ['private_marker\n', 'null\n', '[]\n', '{}\n', '\n',
    '{"type":"input","event":"k1.down"}\n',
    '{"type":"status","event":"ready","path":"private_marker"}\n',
    '{"mode":"capture","status":"private_marker","writes":0}\n',
    '{"mode":"capture","status":"no_device","writes":1}\n', 'x'.repeat(4097),
    '{"type":"status","event":"ready"}\n{"type":"input","event":"private_marker"}\n']) {
    const f = collectorFixture(); f.collector.write(Buffer.from(output)); f.collector.end();
    assert.deepEqual(f.finishes, ['collector_protocol_error']); assert.equal(f.stops, 1);
    f.collector.write(Buffer.from(output)); assert.equal(f.stops, 1);
  }
});

test('collector handles no-device summary, truncated output, missing summary and total byte cap', () => {
  const noDevice = collectorFixture();
  noDevice.collector.write(Buffer.from('{"mode":"capture","status":"no_device","writes":0}'));
  noDevice.collector.end(); assert.deepEqual(noDevice.finishes, ['no_device']);
  for (const status of ['timeout', 'io_error', 'hid_operation_failed']) {
    const beforeReady = collectorFixture();
    beforeReady.collector.write(Buffer.from(JSON.stringify({ mode: 'capture', status, writes: 0 }) + '\n'));
    beforeReady.collector.end();
    assert.deepEqual(beforeReady.records, [], 'terminal summary must not fabricate a ready event');
    assert.deepEqual(beforeReady.finishes, [status]);
  }
  const incomplete = collectorFixture(); incomplete.collector.write(Buffer.from('{"type":')); incomplete.collector.end();
  assert.deepEqual(incomplete.finishes, ['collector_protocol_error']);
  const missing = collectorFixture(); missing.collector.end(); assert.deepEqual(missing.finishes, ['collector_exit']);
  const large = collectorFixture(); large.collector.write(Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.deepEqual(large.finishes, ['collector_protocol_error']); assert.equal(large.stops, 1);
});

test('secure token provisioning accepts parent environment without disk, otherwise private temporary storage', async t => {
  const parent = await createPrivateToken({ AU05_OBSERVER_TOKEN: token });
  assert.equal(parent.token, token); assert.equal(parent.file, undefined); await parent.cleanup();
  for (const value of ['public', `${token}\n`, `${token}\r\n`, 123])
    await assert.rejects(createPrivateToken({ AU05_OBSERVER_TOKEN: value }));
  const generated = await createPrivateToken({});
  try {
    assert.match(generated.token, /^[a-f0-9]{64}$/u);
    assert.match(generated.file, /au05-observer-[a-f0-9]{32}/u);
    assert.ok((await readFile(generated.file, 'utf8')) === generated.token, 'private token content must match without disclosing it');
    if (process.platform !== 'win32') assert.equal((await lstat(generated.file)).mode & 0o077, 0);
    else {
      const probe = join(dirname(generated.file), 'empty-owner-probe');
      try {
        // Empty, exclusive scratch file: expose the OS default-owner distinction without a secret.
        await writeFile(probe, '', { flag: 'wx', mode: 0o600 });
        const aclCheck = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $sid = $identity.User
    function Test-PrivateAcl([string] $path) {
        if (([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
        $acl = Get-Acl -LiteralPath $path
        if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or -not $acl.AreAccessRulesProtected) { return $false }
        $entries = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        if ($entries.Count -ne 1) { return $false }
        $entry = $entries[0]
        return ($entry.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
            $entry.IdentityReference.Value -eq $sid.Value -and -not $entry.IsInherited -and
            ($entry.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)
    }
    $probeAcl = Get-Acl -LiteralPath $env:AU05_TEST_OWNER_PROBE
    [Console]::Out.Write((@{
        directoryPrivate = [bool](Test-PrivateAcl $env:AU05_TEST_PRIVATE_DIRECTORY)
        filePrivate = [bool](Test-PrivateAcl $env:AU05_TEST_PRIVATE_FILE)
        processDefaultOwnerMatchesUser = [bool]($identity.Owner.Value -eq $sid.Value)
        probeOwnerMatchesUser = [bool]($probeAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value)
    } | ConvertTo-Json -Compress))
} catch { exit 1 }
`;
        const { AU05_OBSERVER_TOKEN: omitted, ...safeEnv } = process.env;
        const { stdout } = await promisify(execFile)('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
          Buffer.from(aclCheck, 'utf16le').toString('base64')], {
          env: { ...safeEnv, AU05_TEST_PRIVATE_DIRECTORY: dirname(generated.file),
            AU05_TEST_PRIVATE_FILE: generated.file, AU05_TEST_OWNER_PROBE: probe },
          windowsHide: true, timeout: 10000, maxBuffer: 4096,
        });
        const actual = JSON.parse(stdout);
        assert.equal(actual.directoryPrivate, true, 'directory must have current-user owner and protected user-only FullControl ACL');
        assert.equal(actual.filePrivate, true, 'token must have current-user owner and protected user-only FullControl ACL');
        assert.equal(typeof actual.processDefaultOwnerMatchesUser, 'boolean');
        assert.equal(typeof actual.probeOwnerMatchesUser, 'boolean');
        t.diagnostic(JSON.stringify({ processDefaultOwnerMatchesUser: actual.processDefaultOwnerMatchesUser,
          probeOwnerMatchesUser: actual.probeOwnerMatchesUser }));
      } finally { await unlink(probe).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
  } finally { await generated.cleanup(); }
  await assert.rejects(lstat(generated.file), { code: 'ENOENT' });
  await assert.rejects(lstat(dirname(generated.file)), { code: 'ENOENT' });
});

test('main static contract is single bounded read-only pwsh capture with no raw output, token logging or persistence', async () => {
  const main = await readFile(new URL('../apps/observer/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /'-Mode', 'capture', '-Seconds', '120', '-MaxReports', '10000', '-StreamEvents'/u);
  assert.match(main, /server\.listen\(Number\(portText\), '127\.0\.0\.1'/u);
  assert.match(main, /AU05_OBSERVER_PORT \?\? '17376'/u);
  assert.match(main, /AU05_OBSERVER_ORIGINS \?\? 'http:\/\/127\.0\.0\.1:60890,dsh-app:\/\/app'/u);
  assert.match(main, /stdio: \['ignore', 'pipe', 'ignore'\]/u);
  assert.match(main, /SetAccessRuleProtection\(\$true, \$false\)/u);
  assert.match(main, /IdentityReference\.Value -ne \$sid\.Value/u);
  assert.match(main, /process\.argv\[1\].*fileURLToPath\(import\.meta\.url\)/u);
  assert.equal([...main.matchAll(/\bspawn\(/gu)].length, 1);
  assert.equal([...main.matchAll(/\bwriteFile\(/gu)].length, 1, 'only private token is written');
  assert.doesNotMatch(main, /console\.(?:log|error)|stdout\.pipe|stderr\.pipe|setInterval|ControlGate|X-AU05-Lease/u);
});
