// Shared real-component harness. No server, authenticated GUI, RPC or hardware controller.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const fontRoot = resolve(require.resolve('@fontsource/noto-sans-sc/package.json'), '..');
const fontCss = (await Promise.all([400, 600].map(async weight => {
  const data = await readFile(resolve(fontRoot, `files/noto-sans-sc-chinese-simplified-${weight}-normal.woff2`));
  return `@font-face { font-family:"AU05 Visual Noto"; font-style:normal; font-weight:${weight}; font-display:block; src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2'); }`;
}))).join('\n');
export async function loadVisualSource(sourcePath = resolve('packages/dsh-plugin/client.js')) {
  const source = await readFile(sourcePath, 'utf8');
  // Match the formatted inject array however many services it declares, so adding one
  // does not silently disable the isolated fixture.
  const marker = /^ {6}inject: \[[^\]]*\],$/m;
  const declared = source.match(new RegExp(marker.source, 'gm')) ?? [];
  assert.equal(declared.length, 1, 'export only the real view for the isolated browser fixture');
  return { source, instrumented: source.replace(declared[0], `      visualView: productView,\n${declared[0]}`),
    fixture: await readFile(new URL('./au05-panel-browser.js', import.meta.url), 'utf8') };
}
// Synthetic lamp snapshots exercise the real view without a live device or controller.
const lampSnapshot = (channels, reasons, sessionState) => ({
  connected: true, state: 'ready', sessionId: 'visual', sessionState, lightResult: 'verified',
  lightObservationSessionId: 'visual', lightObservation: { channels, reasons, lightsEnabled: true },
  lightTrace: [{ type: 'request', requestId: 1, channels }, { type: 'result', requestId: 1, result: 'verified',
    readback: { stage: 'post_write', matched: 1, comparison: { observed: { mode: 2, lights: channels.flatMap(mode => [mode, 255, 2, 21, 21]) } } } }],
});
export const visualCases = [
  ['lamp-idle-dark', 480, 900, 'light', 'default', {
    initial: lampSnapshot([0, 0, 0, 0], [null, null, null, null], '待命'),
    lamp: { mode: '关闭', request: null, task: '灯光：配置回读一致' },
  }],
  ['lamp-released-original', 480, 900, 'light', 'default', {
    initial: { connected: true, state: 'ready', lightsEnabled: false, lightResult: 'restored' },
    lamp: { mode: '未知', request: null, task: '原灯光配置已恢复并回读一致' },
  }],
  ['lamp-approval', 480, 900, 'light', 'default', {
    initial: lampSnapshot([0, 2, 2, 0], [null, 'approval', 'approval', null], '等待审批'),
    lamp: { mode: '呼吸', request: '上次请求：呼吸 · 等待审批' },
  }],
  ['lamp-running-narrow', 320, 720, 'dark', 'default', {
    initial: lampSnapshot([0, 0, 2, 1], [null, null, 'cancel', 'progress'], '运行中'),
    lamp: { mode: '呼吸', request: '上次请求：呼吸 · 可停止运行' },
  }],
  ['desktop', 1440, 900, 'light', 'default'],
  ['narrow', 320, 720, 'light', 'default'],
  ['dark', 1440, 900, 'dark', 'default'],
  ['settings', 480, 900, 'light', 'settings'],
  ['narrow-settings', 320, 900, 'light', 'settings'],
  ['custom', 320, 900, 'light', 'custom'],
  ['preparing', 480, 900, 'light', 'preparing'],
  ['recording', 480, 900, 'light', 'recording'],
  ['transcribing', 480, 900, 'light', 'transcribing'],
  ['error', 320, 720, 'light', 'error'],
  ['conflict', 380, 760, 'dark', 'conflict'],
  ['connecting', 480, 720, 'light', 'connecting'],
  ['windows', 480, 900, 'light', 'windows'],
  ['shortcut', 480, 900, 'light', 'shortcut'],
  ['studio', 480, 900, 'dark', 'studio'],
  ['short', 480, 360, 'light', 'settings'],
  ['key-feedback-default', 320, 900, 'light', 'settings', { keyFeedback: { checked: false, disabled: false, keyboard: true } }],
  ['key-feedback-enabled', 480, 900, 'dark', 'settings', { initial: { keyFeedback: true }, keyFeedback: { checked: true, disabled: false } }],
  ['key-feedback-disabled', 320, 900, 'light', 'settings', { initial: { keyFeedback: true, lightsEnabled: false }, keyFeedback: { checked: true, disabled: true } }],
  ['key-feedback-unsaved', 320, 900, 'dark', 'settings', { initial: { keyFeedback: true, keyFeedbackSaved: false }, keyFeedback: { checked: true, disabled: false, error: true } }],
  // Input echoes are controller snapshots, not browser clicks on the non-interactive drawing.
  ['input-idle', 480, 900, 'light', 'default', { initial: { connected: true, state: 'ready' } }],
  ['input-k1-down', 480, 900, 'light', 'default', {
    initial: { connected: true, state: 'ready' },
    steps: [{ name: 'pressed', updates: [{ inputFeedback: { k1: 'down' } }], labels: { k1: '按下' }, highlights: { k1: 'down' } }],
  }],
  ['input-k1-tap', 480, 900, 'light', 'default', {
    initial: { connected: true, state: 'ready' },
    steps: [{ name: 'released-in-one-batch', updates: [{ inputFeedback: { k1: 'down' } }, { inputFeedback: { k1: 'up' } }],
      labels: { k1: '松开' }, highlights: { k1: 'up' } }],
  }],
  ['input-knob-directions', 480, 900, 'light', 'default', {
    initial: { connected: true, state: 'ready' },
    steps: [
      { name: 'pressed-right', updates: [{ inputFeedback: { knob: 'down', rotation: 'right' } }], labels: { knob: '按下 · 右转' }, highlights: { knob: 'down' } },
      { name: 'opposite-left', updates: [{ inputFeedback: { knob: 'down', rotation: 'left' } }], labels: { knob: '按下 · 左转' }, highlights: { knob: 'down' } },
      { name: 'rotation-only', updates: [{ inputFeedback: { rotation: 'left' } }], labels: { knob: '左转' }, highlights: { knob: 'left' } },
    ],
  }],
  ['input-narrow', 320, 720, 'light', 'default', {
    initial: { connected: true, state: 'ready' },
    steps: [{ name: 'all-controls', updates: [{ inputFeedback: { k1: 'up', k2: 'down', k3: 'up', knob: 'up', rotation: 'right' } }],
      labels: { knob: '松开 · 右转', k1: '松开', k2: '按下', k3: '松开' }, highlights: { knob: 'up', k1: 'up', k2: 'down', k3: 'up' } }],
  }],
  ['input-dark', 480, 900, 'dark', 'default', {
    initial: { connected: true, state: 'ready' },
    steps: [{ name: 'pressed-right', updates: [{ inputFeedback: { k1: 'down', knob: 'down', rotation: 'right' } }],
      labels: { knob: '按下 · 右转', k1: '按下' }, highlights: { knob: 'down', k1: 'down' } }],
  }],
  ['input-studio', 320, 900, 'dark', 'studio', {
    steps: [{ name: 'pressed-left', updates: [{ inputFeedback: { k2: 'up', k3: 'down', rotation: 'left' } }],
      labels: { knob: '左转', k2: '松开', k3: '按下' }, highlights: { knob: 'left', k2: 'up', k3: 'down' } }],
  }],
  ['input-lifecycle', 320, 720, 'dark', 'default', {
    initial: { connected: true, state: 'ready' },
    steps: [
      { name: 'pressed', updates: [{ inputFeedback: { k1: 'down', knob: 'down', rotation: 'right' } }], labels: { knob: '按下 · 右转', k1: '按下' }, highlights: { knob: 'down', k1: 'down' } },
      { name: 'cleared', updates: [{ inputFeedback: {} }] },
      { name: 'disconnected-stale-hidden', updates: [{ connected: false, state: 'disconnected', inputFeedback: { k1: 'down', rotation: 'left' } }], connection: '未连接' },
    ],
  }],
];

export async function mountVisualCase(page, { theme, state, scenario = {}, instrumented, fixture, vendor }) {
  // Network is always blocked, including accidental host/RPC calls introduced by a regression.
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { errors.push('unexpected_network_request:' + route.request().url()); return route.abort(); });
    // setContent needs no server and no access to the authenticated DSH GUI.
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AU05 isolated component QA</title><style>
      :root { color-scheme:${theme}; --dsw-alias-bg-base:${theme === 'dark' ? '#202124' : '#ffffff'}; --dsw-alias-bg-layer-1:${theme === 'dark' ? '#28292d' : '#f7f8fa'}; --dsw-alias-bg-layer-2:${theme === 'dark' ? '#303136' : '#f2f4f6'}; --dsw-alias-label-primary:${theme === 'dark' ? '#eeeff1' : '#20252b'}; --dsw-alias-label-secondary:${theme === 'dark' ? '#b6bbc4' : '#59636f'}; --dsw-alias-border-l1:${theme === 'dark' ? '#3b3f46' : '#e2e5e9'}; --dsw-alias-border-l2:${theme === 'dark' ? '#555b65' : '#c3c9d1'}; --dsw-alias-brand-primary:${theme === 'dark' ? '#9cc2ff' : '#245ea8'}; --dsw-alias-state-idle-primary:#7f8996; --dsw-alias-state-success-primary:${theme === 'dark' ? '#73bc92' : '#21764b'}; --dsw-alias-state-warn-primary:${theme === 'dark' ? '#e0b66c' : '#8b5b0f'}; --dsw-alias-state-error-primary:${theme === 'dark' ? '#f29c9c' : '#b32d35'}; }
      body { margin:0; background:${theme === 'dark' ? '#17181b' : '#eef0f3'}; font:13px/1.5 system-ui,"Segoe UI","Microsoft YaHei",sans-serif; } #root { min-height:100vh; }
    </style></head><body><div id="root"></div></body></html>`);
    await page.evaluate(() => {
      window.au05VisualForbiddenCalls = [];
      const deny = name => () => { window.au05VisualForbiddenCalls.push(name); throw new Error('forbidden_visual_effect:' + name); };
      for (const name of ['fetch', 'WebSocket', 'EventSource', 'AudioContext', 'webkitAudioContext']) window[name] = deny(name);
      for (const name of ['mediaDevices', 'hid', 'serial', 'usb', 'bluetooth']) Object.defineProperty(navigator, name, { configurable: true, get: deny('navigator.' + name) });
    });
    await page.addStyleTag({ content: `${fontCss}\nbody, [data-au05-plugin], [data-au05-plugin] :is(button,input,select,textarea) { font-family:"AU05 Visual Noto",sans-serif; }` });
    await page.addScriptTag({ path: vendor ? resolve(vendor, 'react.js') : resolve(require.resolve('react/package.json'), '../umd/react.development.js') });
    await page.addScriptTag({ path: vendor ? resolve(vendor, 'react-dom.js') : resolve(require.resolve('react-dom/package.json'), '../umd/react-dom.development.js') });
    await page.evaluate(() => { window.__ModuleLoader__ = { load: value => { window.visualModule = value; } }; });
    await page.addScriptTag({ content: instrumented });
    await page.addScriptTag({ content: fixture });
    await page.evaluate(({ state, initial }) => window.mountAu05Visual(state, initial), { state, initial: scenario.initial });
    const pill = page.locator('[data-au05-pill]'), panel = page.locator('[data-au05-panel]');
    await pill.click();
    await panel.waitFor();
    assert.equal(await panel.evaluate(el => document.activeElement === el), true, 'dialog focus');
    if (state === 'settings' || state === 'custom') {
      await page.locator('[data-au05-device-settings] > summary').click();
      await panel.evaluate(el => { el.scrollTop = 0; });
    }

  await page.evaluate(() => document.fonts.ready);
  return { pill, panel, errors };
}
