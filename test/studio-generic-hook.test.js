import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EVENTS, WINDOWS_ENV, projectHook, forwardHook, readHook } from '../scripts/studio-generic-hook.mjs';
const payload = event => ({ source: 'dsh', payload_version: 1, hook_event_name: event, session_id: 'private-session-id', tool_name: 'secret-tool', tool_input: { command: 'secret-command' } });
test('only nonblocking supported events and opaque stable session aliases', () => {
  for (const event of EVENTS) {
    const projected = projectHook(payload(event));
    assert.deepEqual(Object.keys(projected), ['event', 'sessionId']);
    assert.match(projected.sessionId, /^dsh-[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(projected).includes('private'));
  }
  assert.equal(projectHook(payload('Stop')).sessionId, projectHook(payload('SessionStart')).sessionId);
  assert.notEqual(projectHook(payload('Stop')).sessionId, projectHook({ ...payload('Stop'), session_id: 'another' }).sessionId);
  for (const event of ['PreToolUse', 'SessionEnd', 'SubagentStart', 'SubagentStop', '__proto__']) assert.throws(() => projectHook(payload(event)));
  for (const patch of [{ session_id: '' }, { session_id: '\nsecret' }, { source: 'codex' }, { payload_version: 2 }]) assert.throws(() => projectHook({ ...payload('Stop'), ...patch }));
});
test('reuse sender without CLI execution or arbitrary environment/input sharing', async () => {
  let options;
  const code = await forwardHook(payload('PostToolUse'), value => {
    options = value;
    return { enqueue(event) { assert.equal(event, 'PostToolUse'); queueMicrotask(() => value.onRecord({ code: 'cli_returned_not_lamp_ack' })); return true; } };
  });
  assert.equal(code, 'cli_returned_not_lamp_ack');
  assert.equal(options.env, WINDOWS_ENV);
  assert.equal(options.env.PATH, undefined);
  assert.equal(options.env.NODE_OPTIONS, undefined);
  assert.equal(options.isCurrent(), true);
  assert.ok(!JSON.stringify(options).includes('secret'));
});
test('bounded stdin accepts metadata and rejects malformed/oversized input', async () => {
  assert.deepEqual(await readHook(Readable.from([JSON.stringify(payload('Stop')) + '\n'])), payload('Stop'));
  await assert.rejects(readHook(Readable.from(['not-json'])));
  await assert.rejects(readHook(Readable.from(['x'.repeat(8193)])), /stdin_limit/);
});
test('stalled stdin times out offline', async () => {
  const input = new Readable({ read() {} });
  await assert.rejects(readHook(input, 10), /stdin_timeout/);
});
