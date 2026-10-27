import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { createObserver, FINISH_STATUSES } from './server.mjs';

const runFile = promisify(execFile);
const captureScript = fileURLToPath(new URL('../../scripts/windows-hid-readonly.ps1', import.meta.url));
const captureStatuses = new Set(FINISH_STATUSES.filter(status => !status.startsWith('collector_') && status !== 'stopped'));
const activeStatuses = new Set(['timeout', 'report_limit', 'cancelled', 'disconnected', 'io_error']);

// A bounded, non-persisting NDJSON parser. Never echo stdout, stderr, parse errors, or unknown fields.
export function createCollector(server, stop = () => {}) {
  const decoder = new StringDecoder('utf8');
  let buffer = '', size = 0, ready = false, terminal = false, failed = false;
  const fail = () => {
    if (failed) return;
    failed = true; buffer = ''; server.finish('collector_protocol_error'); stop();
  };
  const line = text => {
    if (failed) return;
    if (!text || text.length > 4096 || terminal) return fail();
    let record;
    try { record = JSON.parse(text); } catch { return fail(); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) return fail();
    if (record.type === 'status' && record.event === 'ready' && !ready) {
      if (!server.ingest(record)) return fail();
      ready = true; return;
    }
    if (record.type === 'input' && ready) {
      if (!server.ingest(record)) fail();
      return;
    }
    // The existing final aggregate stays JSON but only its fixed status crosses this boundary.
    // A timeout/caps IO error can occur before ready; finishing must never imply hardware readiness.
    if (Object.hasOwn(record, 'type') || record.mode !== 'capture' || record.writes !== 0
      || !captureStatuses.has(record.status)
      || (ready && !activeStatuses.has(record.status) && record.status !== 'hid_operation_failed')) return fail();
    terminal = true; server.finish(record.status);
  };
  return {
    write(chunk) {
      if (failed) return;
      size += Buffer.byteLength(chunk);
      if (size > 2 * 1024 * 1024) return fail();
      buffer += decoder.write(Buffer.from(chunk));
      let newline;
      while (!failed && (newline = buffer.indexOf('\n')) !== -1) {
        const text = buffer.slice(0, newline).replace(/\r$/u, '');
        buffer = buffer.slice(newline + 1);
        line(text);
      }
      if (buffer.length > 4096) fail();
    },
    end() {
      if (failed) return;
      buffer += decoder.end();
      if (buffer) line(buffer.replace(/\r$/u, ''));
      buffer = '';
      if (!terminal && !failed) server.finish('collector_exit');
    },
  };
}

// Windows mode bits do not establish privacy. Create a protected user-only ACL *before* any token
// exists, and verify both directory and file ACLs. No inherited Everyone/Users read access is accepted.
const aclScript = `
$ErrorActionPreference = 'Stop'
try {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $directory = $env:AU05_PRIVATE_DIRECTORY
    if ($env:AU05_ACL_ACTION -eq 'create') {
        if ([System.IO.Directory]::Exists($directory)) { throw 'exists' }
        $acl = [System.Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
        [System.IO.FileSystemAclExtensions]::Create([System.IO.DirectoryInfo]::new($directory), $acl)
    }
    $paths = @($directory)
    if ($env:AU05_ACL_ACTION -eq 'verify-file') { $paths += $env:AU05_PRIVATE_FILE }
    foreach ($path in $paths) {
        if (([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'link' }
        $actual = Get-Acl -LiteralPath $path
        if ($actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner' }
        if ($path -eq $directory -and -not $actual.AreAccessRulesProtected) { throw 'inheritance' }
        $allowed = $false
        foreach ($entry in $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
            if ($entry.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
                if ($entry.IdentityReference.Value -ne $sid.Value) { throw 'public' }
                if (($entry.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) { $allowed = $true }
            }
        }
        if (-not $allowed) { throw 'rights' }
    }
    [Console]::Out.Write('private')
} catch { exit 1 }
`;
async function checkWindowsAcl(directory, file, action) {
  const { AU05_OBSERVER_TOKEN: omitted, ...safeEnv } = process.env;
  const { stdout } = await runFile('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(aclScript, 'utf16le').toString('base64')], {
    env: { ...safeEnv, AU05_PRIVATE_DIRECTORY: directory, AU05_PRIVATE_FILE: file, AU05_ACL_ACTION: action },
    windowsHide: true, timeout: 10000, maxBuffer: 256,
  });
  if (stdout !== 'private') throw new Error('token_privacy_failed');
}

export async function createPrivateToken(env = process.env) {
  if (env.AU05_OBSERVER_TOKEN !== undefined) {
    if (typeof env.AU05_OBSERVER_TOKEN !== 'string' || env.AU05_OBSERVER_TOKEN.length !== 64
      || !/^[a-f0-9]{64}$/u.test(env.AU05_OBSERVER_TOKEN)) throw new Error('invalid_token');
    // A parent can securely provision the token without a second disk copy or stdout disclosure.
    return { token: env.AU05_OBSERVER_TOKEN, cleanup: async () => {} };
  }
  const token = randomBytes(32).toString('hex');
  const directory = join(tmpdir(), `au05-observer-${randomBytes(16).toString('hex')}`);
  const file = join(directory, 'token');
  const cleanup = async () => {
    // Only these two exact randomly-created targets are removed, never a recursive temp-directory delete.
    await unlink(file).catch(() => {});
    await rmdir(directory).catch(() => {});
  };
  try {
    if (process.platform === 'win32') await checkWindowsAcl(directory, file, 'create');
    else await mkdir(directory, { mode: 0o700 });
    await writeFile(file, token, { flag: 'wx', mode: 0o600 });
    if (process.platform === 'win32') await checkWindowsAcl(directory, file, 'verify-file');
    else {
      await chmod(directory, 0o700); await chmod(file, 0o600);
      if (((await lstat(directory)).mode & 0o077) || ((await lstat(file)).mode & 0o077)) throw new Error('token_privacy_failed');
    }
    if (await readFile(file, 'utf8') !== token) throw new Error('token_privacy_failed');
    return { token, file, cleanup };
  } catch { await cleanup(); throw new Error('token_privacy_failed'); }
}

export async function startObserver(env = process.env) {
  if (process.platform !== 'win32') throw new Error('windows_required');
  const portText = env.AU05_OBSERVER_PORT ?? '17376';
  if (typeof portText !== 'string' || /[^0-9]/u.test(portText) || portText.length < 1 || portText.length > 5
    || Number(portText) < 1024 || Number(portText) > 65535) throw new Error('invalid_port');
  const origins = (env.AU05_OBSERVER_ORIGINS ?? 'http://127.0.0.1:60890,dsh-app://app').split(',');
  const secret = await createPrivateToken(env);
  let server, child, watchdog, cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    clearTimeout(watchdog);
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    await secret.cleanup();
  })();
  try {
    server = createObserver({ token: secret.token, origins });
    server.once('observer:shutdown', () => { void cleanup(); });
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(Number(portText), '127.0.0.1', resolveListen);
    });
    server.on('error', () => {
      process.stderr.write('{"error":"observer_server_error"}\n');
      server.close(); server.closeAllConnections();
    });
    const stopChild = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill(); };
    const collector = createCollector(server, stopChild);
    const { AU05_OBSERVER_TOKEN: omitted, ...childEnv } = env;
    // Exactly one bounded read-only acquisition. No retry, hardware reopen, list, or output report path.
    child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', captureScript,
      '-Mode', 'capture', '-Seconds', '120', '-MaxReports', '10000', '-StreamEvents'], {
      env: childEnv, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
    });
    child.stdout.on('data', chunk => collector.write(chunk));
    child.stdout.on('error', () => { server.finish('collector_error'); stopChild(); });
    child.once('error', () => { clearTimeout(watchdog); server.finish('collector_error'); });
    child.once('close', () => { clearTimeout(watchdog); collector.end(); });
    watchdog = setTimeout(() => { server.finish('collector_timeout'); stopChild(); }, 150000);
    watchdog.unref();
    const stop = () => { server.close(); server.closeAllConnections(); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
    server.once('close', () => { for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop); });
    process.stdout.write(JSON.stringify({ status: 'observer_listening', mode: 'read-only', port: Number(portText) }) + '\n');
    return server;
  } catch {
    if (server?.listening) { server.close(); server.closeAllConnections(); }
    await cleanup();
    throw new Error('observer_start_failed');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startObserver(); }
  catch (error) {
    const code = ['windows_required', 'invalid_port', 'invalid_token', 'token_privacy_failed'].includes(error?.message)
      ? error.message : 'observer_start_failed';
    process.stderr.write(JSON.stringify({ error: code }) + '\n');
    process.exitCode = 1;
  }
}
