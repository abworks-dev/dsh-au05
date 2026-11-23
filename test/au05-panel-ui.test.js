import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPanelUi } from '../packages/dsh-plugin/src/ui/panel-primitives.js';
import { panelCss } from '../packages/dsh-plugin/src/ui/panel-styles.js';

const h = (type, props, ...children) => ({ type, props, children });

test('shared field preserves native DOM, label association, markers and handlers', () => {
  const { Field, FieldActions } = createPanelUi(h);
  const onChange = () => {};
  const label = h('label', { htmlFor: 'microphone' }, '麦克风');
  const input = h('select', { id: 'microphone', onChange });
  const actions = FieldActions(null, h('button', { type: 'button' }, '刷新列表'));
  const field = Field({ 'data-au05-microphone-settings': '', className: 'extra' }, label, input, actions);
  assert.equal(field.type, 'div');
  assert.equal(field.props.className, 'au05-field extra');
  assert.equal(field.props['data-au05-microphone-settings'], '');
  assert.deepEqual(field.children, [label, input, actions]);
  assert.equal(field.children[1].props.onChange, onChange);
  assert.equal(label.props.htmlFor, input.props.id);
  assert.equal(actions.props.className, 'au05-field-actions');
});

test('shared action groups keep caller semantics without running actions', () => {
  let calls = 0;
  const button = h('button', { disabled: true, onClick: () => calls++ }, '应用');
  const { Actions, FieldActions } = createPanelUi(h);
  for (const create of [Actions, FieldActions]) {
    const group = create({ 'data-test': 'preserved' }, button);
    assert.equal(group.props['data-test'], 'preserved');
    assert.equal(group.children[0], button);
    assert.equal(calls, 0);
  }
});

test('shared styles retain host color authority, responsive field alignment and keyboard focus', () => {
  assert.match(panelCss, /--au05-space-control:8px/);
  assert.match(panelCss, /--au05-label-width:72px/);
  assert.match(panelCss, /grid-template-columns:var\(--au05-label-width\) minmax\(0,1fr\)/);
  assert.match(panelCss, /--au05-label-width:64px/);
  assert.match(panelCss, /\.au05-field-actions \{ grid-column:2;.*flex-wrap:wrap/);
  assert.match(panelCss, /focus-visible.*outline:2px solid var\(--dsw-alias-brand-primary,Highlight\)/);
  assert.match(panelCss, /prefers-reduced-motion:reduce/);
  assert.match(panelCss, /animation:none !important/);
});

test('generated client embeds shared styles and primitives byte-for-byte', async () => {
  const client = await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
  for (const filename of ['panel-styles.js', 'panel-primitives.js']) {
    const source = await readFile(new URL(`../packages/dsh-plugin/src/ui/${filename}`, import.meta.url), 'utf8');
    assert.ok(client.includes(source.replace(/^export /gm, '')), `${filename}: run npm run build:plugin`);
  }
  assert.match(client, /const \{ Field, FieldActions, Actions \} = createPanelUi\(h\)/);
  assert.doesNotMatch(client, /className: 'au05-toggle'/);
  assert.equal((client.match(/\bField\(/g) ?? []).length, 5, 'four fields and factory definition; no duplicated field layout');
});
