import test from 'node:test';
import assert from 'node:assert/strict';
import { createDshApplication } from '../packages/dsh-plugin/src/dsh-application.js';

function fixture() {
  const owner = {}, inputActions = {}, pending = { kind: 'approval', answerable: true, sessionId: 'a', key: 'p', answer() {} };
  const binding = { key: 'a', props: { inputActions } }, port = {}, root = {}, element = {};
  const rows = { a: { id: 'a', retainedBy: { mainView: 1 } } };
  const status = { pendingInteraction: pending, running: true };
  const document = { visibilityState: 'visible', hasFocus: () => true, activeElement: element };
  const focusBridges = new Map([['a', { owner, isFocused: () => true }]]);
  const answered = new WeakMap(), calls = [];
  const ctx = { uiSession: { adapter: { current: { getSnapshot: () => binding } },
    sessionStatus: { getSnapshot: () => new Map([['a', status]]) } },
    sessions: { list: { getSnapshot: () => ({ byId: rows }) }, binding: () => owner } };
  const api = createDshApplication({ ctx, document, focusBridges, answered,
    resolveScroll: () => ({ port, root }), invoke: action => { calls.push(action); action(); } });
  return { api, ctx, document, focusBridges, answered, calls, owner, binding, rows, status, pending, port, root };
}

function questionFixture() {
  const f = fixture(), clicks = [], fields = [], buttons = [];
  const element = extra => ({ isConnected: true, disabled: false, closest: () => null,
    getClientRects: () => [{}], getAttribute: () => null, ...extra });
  const field = element({ value: '', focus() { f.document.activeElement = field; } });
  fields.push(field);
  buttons.push(...Array.from({ length: 4 }, (_, index) => element({ click() { clicks.push(index); } })));
  const card = element({ getAttribute: () => f.pending.key,
    querySelectorAll: selector => selector === '[data-question-scroll] textarea' ? fields : buttons });
  const cards = [card];
  f.document.querySelectorAll = selector => selector === '[data-question-key]' ? cards : [];
  Object.assign(f.pending, { kind: 'question', getSnapshot: () => ({ state: 'open', channel: 'waterfall', closed: false }) });
  return { ...f, field, fields, card, cards, buttons, clicks };
}

test('question knob focuses the answer field; K2 invokes only the host Next/Submit control', () => {
  const f = questionFixture(), target = f.api.readTarget();
  assert.equal(f.api.questionAction(target, 'submit'), true, 'host retains selected and implicit recommended drafts');
  assert.deepEqual(f.clicks, [3]);
  assert.equal(f.api.questionAction(target, 'focus'), true);
  assert.equal(f.document.activeElement, f.field);
  assert.equal(f.api.questionAction(target, 'submit'), false, 'empty focused custom answer must not send the recommendation');
  f.field.value = '  custom answer  ';
  assert.equal(f.api.questionAction(target, 'submit'), true);
  assert.equal(f.field.value, '  custom answer  ', 'host owns normalization, validation, and multi-question advancement');
  assert.deepEqual(f.clicks, [3, 3]);
  assert.equal(f.calls.length, 0, 'never invokes approval answer APIs');
});

test('question actions fail closed for stale, foreign, hidden, ambiguous and unavailable controls', () => {
  const cases = [
    f => { f.document.visibilityState = 'hidden'; },
    f => { f.document.hasFocus = () => false; },
    f => { f.rows.b = { id: 'b', retainedBy: { mainView: 1 } }; },
    f => { f.status.pendingInteraction = { ...f.pending }; },
    f => { f.pending.key = 'new-key'; },
    f => { f.pending.sessionId = 'b'; },
    f => { f.pending.kind = 'plan-review'; },
    f => { f.pending.review = []; },
    f => { f.pending.getSnapshot = () => ({ state: 'open', closed: true, channel: 'waterfall' }); },
    f => { f.pending.getSnapshot = () => ({ state: 'open', closed: false, channel: 'none' }); },
    f => { f.cards.push(f.card); },
    f => { f.card.isConnected = false; },
    f => { f.card.closest = () => ({}); },
    f => { f.card.getClientRects = () => []; },
    f => { f.fields.length = 0; },
    f => { f.fields.push(f.field); },
    f => { f.field.disabled = true; },
    f => { f.buttons.pop(); },
    f => { f.buttons[3].disabled = true; },
    f => { f.buttons[3].getAttribute = () => 'true'; },
  ];
  for (const mutate of cases) {
    const f = questionFixture(), target = f.api.readTarget(); mutate(f);
    assert.equal(f.api.questionAction(target, 'submit'), false, String(mutate));
    assert.deepEqual(f.clicks, []);
  }
  const f = questionFixture();
  f.pending.getSnapshot = () => ({ state: 'continued', channel: 'rpc', closed: false });
  assert.equal(f.api.questionAction(f.api.readTarget(), 'submit'), true);
});

test('reads the unique retained main view with official owner and UI capabilities', () => {
  const f = fixture(), target = f.api.readTarget();
  assert.equal(target.sessionId, 'a');
  assert.equal(target.binding, f.binding);
  assert.equal(target.sessionOwner, f.owner);
  assert.equal(target.pending, f.pending);
  assert.equal(target.inputActions, f.binding.props.inputActions);
  assert.equal(target.composerFocused, true);
  assert.equal(target.focused, true);
  assert.equal(target.running, true);
  assert.equal(target.scrollPort, f.port);
  assert.equal(target.scrollRoot, f.root);
  assert.equal(f.api.equalTarget(target, f.api.readTarget()), true);
});

test('ambiguous, mismatched, missing-owner and throwing snapshots fail closed', () => {
  const f = fixture();
  f.rows.b = { id: 'b', retainedBy: { mainView: 1 } };
  assert.equal(f.api.readTarget(), null);
  delete f.rows.b;
  f.binding.key = 'b';
  assert.equal(f.api.readTarget(), null);
  f.binding.key = 'a'; f.ctx.sessions.binding = () => null;
  assert.equal(f.api.readTarget(), null);
  f.ctx.sessions.binding = () => { throw new Error('unavailable'); };
  assert.equal(f.api.readTarget(), null);
});

test('ambiguous main ownership stops inspecting irrelevant session eligibility without caching later reads', () => {
  const f = fixture();
  f.rows.b = { id: 'b', retainedBy: { mainView: 1 } };
  let eligibilityReads = 0;
  for (let index = 0; index < 1000; index++) {
    f.rows[`background-${index}`] = { id: `background-${index}`,
      get retainedBy() { eligibilityReads++; return { mainView: 0 }; } };
  }
  assert.equal(f.api.readTarget(), null);
  assert.equal(eligibilityReads, 0, 'two retained owners already prove ambiguity');
  f.rows.b.retainedBy.mainView = 0;
  assert.equal(f.api.readTarget().sessionId, 'a');
  assert.equal(eligibilityReads, 1000, 'a subsequent read must establish uniqueness afresh');
  f.rows['background-999'] = { id: 'background-999', retainedBy: { mainView: 1 } };
  assert.equal(f.api.readTarget(), null, 'a newly retained background owner is not cached away');
});

test('composer ownership and document visibility remain independent snapshot facts', () => {
  const f = fixture();
  f.focusBridges.get('a').owner = {};
  f.document.visibilityState = 'hidden';
  const target = f.api.readTarget();
  assert.equal(target.composerFocused, false);
  assert.equal(target.focused, false);
  f.status.pendingInteraction = undefined;
  assert.equal(f.api.readTarget().pendingKey, undefined);
});

test('equality detects every captured identity and eligibility field', () => {
  const { api } = fixture(), target = api.readTarget();
  assert.equal(api.equalTarget(null, null), true);
  assert.equal(api.equalTarget(null, target), false);
  for (const key of Object.keys(target)) {
    assert.equal(api.equalTarget(target, { ...target, [key]: Symbol(key) }), false, key);
  }
});

test('approval validates scope and capability, deduplicates per owner and shares answered state', () => {
  const f = fixture(), target = f.api.readTarget(), answers = [];
  f.pending.answer = answer => answers.push(answer);
  for (const patch of [{ kind: 'question' }, { answerable: false }, { sessionId: 'b' }, { key: 1 }, { answer: null }]) {
    assert.equal(f.api.approve({ ...target, pending: { ...f.pending, ...patch } }, 'allowed-once'), false);
  }
  assert.equal(f.api.approve({ ...target, pending: null }, 'allowed-once'), false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.api.approve(target, 'allowed-once'), true);
  assert.equal(f.api.approve(target, 'rejected'), true);
  assert.deepEqual(answers, ['allowed-once']);
  assert.equal(f.answered.get(f.owner).has('p'), true);
  assert.equal(f.api.approve({ ...target, sessionOwner: {} }, 'rejected'), true);
  assert.deepEqual(answers, ['allowed-once', 'rejected']);
});
