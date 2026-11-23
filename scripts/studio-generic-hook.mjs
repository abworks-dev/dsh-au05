import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createStudioSender } from '../packages/dsh-studio-hook/sender.js';

// Nonblocking notifications only. Never use this adapter as a PreToolUse policy.
export const EVENTS = Object.freeze(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'PermissionRequest']);
export const WINDOWS_ENV = Object.freeze({
  APPDATA: 'C:/Users/ASUS/AppData/Roaming',
  LOCALAPPDATA: 'C:/Users/ASUS/AppData/Local',
  USERPROFILE: 'C:/Users/ASUS', SystemRoot: 'C:/Windows', WINDIR: 'C:/Windows',
  TEMP: 'C:/Users/ASUS/AppData/Local/Temp', TMP: 'C:/Users/ASUS/AppData/Local/Temp',
});

export function projectHook(value) {
  if (!value || Array.isArray(value) || value.source !== 'dsh' || value.payload_version !== 1 ||
      !EVENTS.includes(value.hook_event_name) || typeof value.session_id !== 'string' ||
      !value.session_id.length || value.session_id.length > 256 || /[\x00-\x1f\x7f]/.test(value.session_id)) {
    throw new Error('unsupported_hook_metadata');
  }
  // Do not copy tool_name, tool_input, prompts, paths or any arbitrary fields.
  return { event: value.hook_event_name,
    sessionId: `dsh-${createHash('sha256').update(value.session_id).digest('hex')}` };
}

export async function forwardHook(value, senderFactory = createStudioSender) {
  const { event, sessionId } = projectHook(value);
  return new Promise(resolve => {
    const sender = senderFactory({ sessionId, isCurrent: () => true, env: WINDOWS_ENV,
      onRecord(record) { resolve(record.code); } });
    if (!sender.enqueue(event)) resolve('not_enqueued');
  });
}

export async function readHook(input, timeoutMs = 1000) {
  let bytes = 0;
  const chunks = [];
  const timer = setTimeout(() => input.destroy(new Error('stdin_timeout')), timeoutMs);
  try {
    for await (const chunk of input) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8192) throw new Error('stdin_limit');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { clearTimeout(timer); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const code = await forwardHook(await readHook(process.stdin));
    if (code !== 'cli_returned_not_lamp_ack') process.exitCode = 1;
    process.stderr.write(`${code}\n`);
  } catch {
    process.stderr.write('studio_hook_not_forwarded\n');
    process.exitCode = 1;
  }
}
