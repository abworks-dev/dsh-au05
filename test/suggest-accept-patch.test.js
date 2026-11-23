import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { patchSource, patchFile, EVENT_NAME } from '../scripts/patch-suggest-accept.mjs';

const target = process.env.DSH_SUGGEST_CLIENT || path.join(os.homedir(), '.dsh/profiles/desktop/node_modules/@studyzy/dsh-suggest-prompt/lib/client.js');
const available = fs.existsSync(target);

function harness({ suggestion = { text: 'next', acceptKey: 'Tab' }, running = false, draft = '', phase = 'plain', throws = false } = {}) {
  const source = patchSource(fs.readFileSync(target, 'utf8'));
  const from = source.indexOf('function GhostSuggestion(');
  const to = source.indexOf('\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tstyleUsers += 1;', from);
  const listeners = new Map();
  const cleanups = [];
  const drafts = [];
  const window = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }
  };
  const context = {
    react: { useMemo: fn => fn(), useRef: current => ({ current }), useEffect(fn) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
    window,
    useStoredSuggestion: () => suggestion,
    currentSuggestion: (s, r, d) => !r && s && !d.trim() ? s.text : undefined,
    parseAcceptKey: () => event => event.key === 'Tab',
    DEFAULT_ACCEPT_KEY: 'Tab', DEFAULT_ACCEPT_MATCHER: () => false,
    isComposerFocused: () => true
  };
  vm.createContext(context);
  const render = vm.runInContext(`(${source.slice(from, to)}\n})`, context);
  render({ sessionId: 'session-A', useSession: fn => fn({ running }), useInput: fn => fn({ draft, phase }), inputActions: { setDraft(text) { drafts.push(text); if (throws) throw new Error('write failed'); } } });
  function emit(type = EVENT_NAME, detail = { sessionId: 'session-A' }, extra = {}) {
    const event = { detail, cancelable: true, defaultPrevented: false, preventDefault() { if (this.cancelable) this.defaultPrevented = true; }, ...extra };
    let error;
    for (const fn of listeners.get(type) || []) { try { fn(event); } catch (caught) { error = caught; } }
    return { event, error };
  }
  return { emit, drafts, cleanup() { cleanups.forEach(fn => fn()); } };
}

test('unknown bundles fail closed', () => assert.throws(() => patchSource('unknown'), /anchors missing/));
test('real installed function: exact session acceptance, no duplicate before render', { skip: !available }, () => {
  const h = harness();
  assert.equal(h.emit(EVENT_NAME, { sessionId: 'session-B' }).event.defaultPrevented, false);
  assert.equal(h.emit(EVENT_NAME, {}).event.defaultPrevented, false);
  assert.equal(h.emit(EVENT_NAME, undefined, { cancelable: false }).event.defaultPrevented, false);
  assert.deepEqual(h.drafts, []);
  assert.equal(h.emit().event.defaultPrevented, true);
  assert.equal(h.emit().event.defaultPrevented, true);
  assert.deepEqual(h.drafts, ['next']);
  h.cleanup();
  assert.equal(h.emit().event.defaultPrevented, false);
});
test('real installed function: hidden/ineligible suggestions do not claim', { skip: !available }, () => {
  for (const options of [{ suggestion: null }, { running: true }, { draft: 'existing' }, { phase: 'command' }]) {
    const h = harness(options);
    assert.equal(h.emit().event.defaultPrevented, false);
    assert.deepEqual(h.drafts, []);
  }
});
test('real installed function: composition claims without filling; resumes after end', { skip: !available }, () => {
  const h = harness();
  h.emit('compositionstart');
  assert.equal(h.emit().event.defaultPrevented, true);
  assert.deepEqual(h.drafts, []);
  h.emit('compositionend');
  h.emit();
  assert.deepEqual(h.drafts, ['next']);
});
test('real installed function: setDraft failure is claimed before throwing', { skip: !available }, () => {
  const h = harness({ throws: true });
  const result = h.emit();
  assert.equal(result.event.defaultPrevented, true);
  assert.match(result.error.message, /write failed/);
  h.emit();
  assert.deepEqual(h.drafts, ['next']);
});
test('real installed function: shortcut retained and shares one-shot guard', { skip: !available }, () => {
  const h = harness();
  assert.equal(h.emit('keydown', {}, { key: 'Tab', isComposing: true }).event.defaultPrevented, false);
  assert.equal(h.emit('keydown', {}, { key: 'Tab' }).event.defaultPrevented, true);
  h.emit();
  assert.deepEqual(h.drafts, ['next']);
});
test('patch application backs up original and is idempotent', { skip: !available }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-accept-'));
  try {
    const file = path.join(directory, 'client.js');
    const installed = fs.readFileSync(target, 'utf8');
    const backup = `${target}.au05-accept-original.bak`;
    const original = fs.existsSync(backup) ? fs.readFileSync(backup, 'utf8') : installed;
    fs.writeFileSync(file, original);
    assert.equal(patchFile(file).changed, true);
    assert.equal(fs.readFileSync(`${file}.au05-accept-original.bak`, 'utf8'), original);
    assert.equal(patchFile(file).changed, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
