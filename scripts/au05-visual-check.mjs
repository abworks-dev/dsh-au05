// Real React + Chromium panel QA. No plugin installation, controller, RPC or media access.
// Uses the same pinned runtime and shared renderer as the official screenshot suite.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { visualCases as cases, loadVisualSource, mountVisualCase } from '../test/fixtures/au05-visual-harness.mjs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const sourcePath = resolve(option('--source', 'packages/dsh-plugin/client.js'));
const out = resolve(option('--out', 'Temp/au05-unslop/after'));
const vendor = option('--vendor', null);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const { source, instrumented, fixture } = await loadVisualSource(sourcePath);
const errors = [], results = [];
const requestedCases = option('--cases', '').split(',').filter(Boolean);
for (const name of requestedCases) assert.ok(cases.some(item => item[0] === name), `unknown_visual_case:${name}`);
try {
  for (const [name, width, height, theme, state, scenario = {}] of cases.filter(item => !requestedCases.length || requestedCases.includes(item[0]))) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' });
    const { pill, panel, errors: pageErrors } = await mountVisualCase(page, { theme, state, scenario, instrumented, fixture, vendor });
    if (state === 'connecting') assert.equal(await page.locator('[data-au05-connect]').isDisabled(), true);
    if (state === 'conflict') assert.equal(await page.locator('[data-au05-voice-mode]').isDisabled(), true);
    if (state === 'preparing') {
      assert.match(await page.locator('[data-au05-voice-status]').innerText(), /尚未开始录音/);
      assert.equal(await page.locator('[data-au05-connection]').innerText(), '准备采集');
    }
    if (state === 'recording') assert.equal(await page.locator('[data-au05-connection]').innerText(), '录音中');
    if (state === 'transcribing') assert.equal(await page.locator('[data-au05-connection]').innerText(), '转写中');
    if (state === 'windows' || state === 'shortcut') {
      assert.match(await page.locator('[data-au05-voice-status]').innerText(), /已请求/);
      assert.doesNotMatch(await page.locator('[data-au05-connection]').innerText(), /录音/);
    }
    if (state === 'studio') {
      assert.equal(await page.locator('[data-au05-auto-connect]').count(), 0);
      assert.equal(await page.locator('[data-au05-light-brightness]').count(), 0);
      assert.equal(await page.locator('[data-au05-key-feedback]').count(), 0);
      assert.match(await page.locator('[data-au05-device-status]').innerText(), /Studio/);
    }
    let keyFeedbackPublications = 0;
    if (scenario.keyFeedback) {
      const expected = scenario.keyFeedback;
      const control = panel.getByRole('checkbox', { name: 'K2 / K3 按键短亮', exact: true });
      assert.equal(await control.isChecked(), expected.checked, `${name}: exact saved feedback setting`);
      assert.equal(await control.isDisabled(), expected.disabled, `${name}: master lights gates key feedback`);
      assert.equal(await page.locator('[data-au05-key-feedback-status]').count(), expected.error ? 1 : 0);
      if (expected.error) {
        assert.equal(await page.locator('[data-au05-key-feedback-status]').getAttribute('role'), 'alert');
        assert.match(await page.locator('[data-au05-key-feedback-status]').innerText(), /未保存.*重试/);
      }
      if (expected.keyboard) {
        await control.focus();
        await page.keyboard.press('Space');
        await control.isChecked().then(value => assert.equal(value, !expected.checked, `${name}: keyboard opt-in`));
        await page.keyboard.press('Space');
        await control.isChecked().then(value => assert.equal(value, expected.checked, `${name}: keyboard opt-out`));
        keyFeedbackPublications = 2;
        await panel.focus();
      }
    }
    const measurePanel = () => panel.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const connect = el.querySelector('[data-au05-connect]').getBoundingClientRect();
      const disconnect = el.querySelector('[data-au05-disconnect]').getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
        connectionButtonsSameRow: Math.abs(connect.top - disconnect.top) < 1,
        connectionButtons: { connect: { left: connect.left, top: connect.top, width: connect.width, height: connect.height },
          disconnect: { left: disconnect.left, top: disconnect.top, width: disconnect.width, height: disconnect.height } },
        mappingOrder: [...el.querySelectorAll('[data-au05-control-detail] > [data-au05-mapping]')].map(item => item.dataset.au05Mapping),
        mappingVisualOrder: [...el.querySelectorAll('[data-au05-mapping]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(item => item.dataset.au05Mapping),
        physicalOrder: [...el.querySelectorAll('[data-au05-lamp]')].sort((a, b) => {
          const first = a.getBoundingClientRect(), second = b.getBoundingClientRect();
          return first.top + first.height / 2 - second.top - second.height / 2;
        }).map(item => item.dataset.au05Lamp),
        fields: [...el.querySelectorAll('.au05-field')].map(field => {
          const label = field.querySelector('label'), control = field.querySelector('select,input');
          const visible = field.checkVisibility({ visibilityProperty: true }) && !field.closest('details:not([open])');
          return { label: label.textContent, named: label.htmlFor === control.id, visible,
            sameRow: visible ? Math.abs(label.getBoundingClientRect().y + label.offsetHeight / 2 - control.getBoundingClientRect().y - control.offsetHeight / 2) < 1 : null };
        }) };
    });
    const validate = measure => {
      assert.ok(measure.left >= 0 && measure.right <= width + 1 && measure.bottom <= height + 1, `${name}: within viewport`);
      assert.ok(measure.scrollWidth <= measure.clientWidth + 1, `${name}: no panel horizontal overflow`);
      if (args.includes('--verify-layout')) {
        assert.ok(measure.connectionButtonsSameRow, `${name}: connection actions stay together`);
        assert.deepEqual(measure.mappingOrder, ['knob', 'k1', 'k2', 'k3'], `${name}: top dial comes before the three keys`);
        assert.deepEqual(measure.mappingVisualOrder, measure.physicalOrder, `${name}: visible description order matches physical controls`);
        for (const field of measure.fields.filter(field => field.visible)) assert.ok(field.named && field.sameRow, `${name}: field label aligned and associated`);
      }
    };
    const checkFeedback = async (labels = {}, highlights = {}) => {
      const feedback = await panel.evaluate(el => {
        const svg = el.querySelector('[data-au05-device-vector]'), panelRect = el.getBoundingClientRect();
        const labels = Object.fromEntries([...el.querySelectorAll('[data-au05-input-state]')].map(item => [item.dataset.au05InputState, item.textContent]));
        const shapes = [...svg.querySelectorAll('[data-au05-input-control]')].map(item => {
          const control = item.dataset.au05InputControl, bounds = item.getBBox();
          const lamp = svg.querySelector(`[data-au05-lamp="${control}"]`).getBBox(), style = getComputedStyle(item);
          return { control, state: item.dataset.inputState, tag: item.tagName, stroke: style.stroke, pointerEvents: style.pointerEvents,
            inset: bounds.x > lamp.x && bounds.y > lamp.y && bounds.x + bounds.width < lamp.x + lamp.width && bounds.y + bounds.height < lamp.y + lamp.height };
        });
        return { labels, highlights: Object.fromEntries(shapes.map(item => [item.control, item.state])), shapes,
          nonInteractive: svg.getAttribute('aria-hidden') === 'true' && svg.getAttribute('focusable') === 'false'
            && !svg.querySelector('a,button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])'),
          labelsFit: [...el.querySelectorAll('[data-au05-input-state]')].every(item => {
            const rect = item.getBoundingClientRect();
            return item.tagName === 'SPAN' && item.closest('[data-au05-mapping]').dataset.au05Mapping === item.dataset.au05InputState
              && rect.left >= panelRect.left && rect.right <= panelRect.right;
          }),
          mappings: [...el.querySelectorAll('[data-au05-mapping] p')].map(item => item.textContent),
          lampModes: [...el.querySelectorAll('[data-au05-lamp]')].map(item => item.dataset.lampMode),
          connection: el.closest('[data-au05-plugin]').querySelector('[data-au05-connection]').textContent };
      });
      assert.deepEqual(feedback.labels, labels, `${name}: exact input feedback wording`);
      assert.deepEqual(feedback.highlights, highlights, `${name}: only the observed physical controls highlighted`);
      assert.ok(feedback.nonInteractive, `${name}: SVG remains a non-interactive illustration`);
      assert.ok(feedback.labelsFit, `${name}: feedback labels remain within the panel and their control mapping`);
      for (const shape of feedback.shapes) {
        assert.equal(shape.tag, shape.control === 'knob' ? 'circle' : 'rect', `${name}: physical shape for ${shape.control}`);
        assert.equal(shape.pointerEvents, 'none', `${name}: echo does not capture clicks`);
        assert.equal(shape.stroke, 'rgb(36, 94, 168)', `${name}: blue input echo, separate from lamps`);
        assert.ok(shape.inset, `${name}: input echo is inset within ${shape.control}`);
      }
      return feedback;
    };
    if (scenario.lamp) {
      assert.equal(await page.locator('[data-au05-key-light="k3"]').textContent(), `配置回读：${scenario.lamp.mode}`, `${name}: K3 configuration is explicit`);
      const request = page.locator('[data-au05-key-request="k3"]');
      if (scenario.lamp.request) assert.equal(await request.textContent(), scenario.lamp.request, `${name}: K3 request reason is explicit`);
      else assert.equal(await request.count(), 0, `${name}: idle does not claim an off request`);
      if (scenario.lamp.task) assert.equal(await page.locator('[data-au05-task-lamp-state]').textContent(), scenario.lamp.task);
    }
    const feedbackBefore = await checkFeedback();
    const inputChecks = [];
    await panel.evaluate(el => { window.au05VisualPanelNode = el; });
    for (const step of scenario.steps ?? []) {
      await page.evaluate(updates => window.publishAu05VisualSnapshot(updates), step.updates);
      await page.waitForFunction(({ expected, connection }) => {
        const labels = [...document.querySelectorAll('[data-au05-input-state]')];
        return labels.length === Object.keys(expected).length && labels.every(item => expected[item.dataset.au05InputState] === item.textContent)
          && (!connection || document.querySelector('[data-au05-connection]').textContent === connection);
      }, { expected: step.labels ?? {}, connection: step.connection });
      const feedback = await checkFeedback(step.labels, step.highlights);
      assert.deepEqual(feedback.mappings, feedbackBefore.mappings, `${name}: input echoes do not rewrite control actions`);
      assert.deepEqual(feedback.lampModes, feedbackBefore.lampModes, `${name}: input echoes do not claim lamp readback`);
      assert.doesNotMatch(feedback.connection, /录音|转写|采集/, `${name}: input echoes do not imply recording`);
      assert.equal(await panel.evaluate(el => el === window.au05VisualPanelNode && document.activeElement === el), true, `${name}: live React update preserves panel and focus`);
      const stepMeasure = await measurePanel();
      await page.screenshot({ path: resolve(out, `${name}-${step.name}.png`) });
      await panel.screenshot({ path: resolve(out, `${name}-${step.name}-panel.png`) });
      validate(stepMeasure);
      inputChecks.push({ name: step.name, updates: step.updates, feedback, measure: stepMeasure });
    }
    const publications = await page.evaluate(() => window.au05VisualPublications.length);
    assert.equal(publications, keyFeedbackPublications + (scenario.steps ?? []).reduce((count, step) => count + step.updates.length, 0), `${name}: every synthetic publication delivered`);
    const measure = await measurePanel(); validate(measure);
    let expandedMeasure = null;
    await page.screenshot({ path: resolve(out, `${name}.png`) });
    // A tight, unchanged crop of the real panel; comparisons never rescale it.
    await panel.screenshot({ path: resolve(out, `${name}-panel.png`) });
    if (state === 'settings' || state === 'custom') {
      await page.locator('[data-au05-device-settings]').scrollIntoViewIfNeeded();
      await page.locator('[data-au05-device-settings]').screenshot({ path: resolve(out, `${name}-fields.png`) });
      await page.locator('[data-au05-advanced] > summary').click();
      await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
      expandedMeasure = await measurePanel(); validate(expandedMeasure);
      if (args.includes('--verify-layout')) assert.equal(expandedMeasure.fields.filter(field => field.visible).length, 3, `${name}: all three expanded fields actually measured`);
      await page.screenshot({ path: resolve(out, `${name}-scrolled.png`) });
    }
    // Clicking the drawing must never be a device operation or an approval action.
    await page.locator('.au05-device-art').click();
    // Verify keyboard close, focus return and no accidental effects in the fixture.
    await panel.focus();
    await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert.equal(await pill.evaluate(el => document.activeElement === el), true, `${name}: focus returns to pill`);
    await page.keyboard.press('Enter');
    await panel.waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-au05-close]').evaluate(el => document.activeElement === el), true, `${name}: first Tab is close`);
    assert.equal(await page.locator('[data-au05-close]').evaluate(el => getComputedStyle(el).outlineStyle !== 'none'), true, `${name}: focus outline`);
    if (scenario.steps) await page.screenshot({ path: resolve(out, `${name}-keyboard.png`) });
    const keyboardStops = [];
    for (let index = 0; index < 12; index++) {
      const stop = await page.evaluate(() => ({ tag: document.activeElement.tagName,
        inDrawing: Boolean(document.activeElement.closest('[data-au05-device-vector]')),
        inputState: document.activeElement.hasAttribute('data-au05-input-state') }));
      assert.equal(stop.inDrawing || stop.inputState, false, `${name}: input feedback adds no keyboard stops`);
      keyboardStops.push(stop);
      await page.keyboard.press('Tab');
    }
    const actions = await page.evaluate(() => window.au05VisualActions);
    assert.deepEqual(actions.filter(action => action !== 'refreshMicrophones'), scenario.keyFeedback?.keyboard ? ['setKeyFeedback:true', 'setKeyFeedback:false'] : [], `${name}: only explicit synthetic setting changes, never device operations`);
    results.push({ name, viewport: { width, height }, theme, state, measure, expandedMeasure, feedbackBefore, inputChecks,
      publications, actions, keyboard: 'passed', keyboardStops });
    errors.push(...pageErrors.map(error => `${name}: ${error}`));
    await page.close();
  }
  assert.deepEqual(errors, [], 'no browser runtime errors');
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ source: sourcePath, sha256: createHash('sha256').update(source).digest('hex'), fixture: 'real productView and panelCss; synthetic controller; no DSH host', fixtureSha256: createHash('sha256').update(fixture).digest('hex'), browser: await browser.version(), checks: { offline: args.includes('--offline'), verifyLayout: args.includes('--verify-layout') }, errors, results }, null, 2));
  const before = option('--compare-with', null);
  if (before) for (const [name, file] of [['desktop', 'desktop-panel.png'], ['narrow', 'narrow-panel.png'], ['settings', 'settings-fields.png']]) {
    const images = await Promise.all([resolve(before, file), resolve(out, file)].map(async path => `data:image/png;base64,${(await readFile(path)).toString('base64')}`));
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(`<html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#eef0f3;color:#20252b;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;display:flex;gap:16px;align-items:flex-start}figure{margin:0}figcaption{margin-bottom:12px;font-weight:600}img{display:block;max-width:none}</style><figure><figcaption>优化前</figcaption><img src="${images[0]}"></figure><figure><figcaption>优化后</figcaption><img src="${images[1]}"></figure></html>`);
    const size = await page.evaluate(async () => {
      await Promise.all([...document.images].map(image => image.decode()));
      return { width: [...document.images].reduce((width, image) => width + image.naturalWidth, 48), height: Math.max(...[...document.images].map(image => image.naturalHeight)) + 68 };
    });
    await page.setViewportSize(size);
    await page.screenshot({ path: resolve(out, `compare-${name}.png`), fullPage: true });
    await page.close();
  }
  console.log(JSON.stringify({ out, cases: results.length, inputSteps: results.reduce((count, result) => count + result.inputChecks.length, 0),
    publications: results.reduce((count, result) => count + result.publications, 0), verifyLayout: args.includes('--verify-layout'), errors }, null, 2));
} finally { await browser.close(); }
