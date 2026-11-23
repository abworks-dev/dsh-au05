import { test, expect } from '@playwright/test';
import { visualCases, loadVisualSource, mountVisualCase } from '../fixtures/au05-visual-harness.mjs';

const preflight = process.env.AU05_VISUAL_PREFLIGHT === '1';
const product = await loadVisualSource();

for (const [name, width, height, theme, state, scenario = {}] of visualCases) {
  test(name, async ({ page, browser }) => {
    expect(browser.version()).toBe('145.0.7632.6');
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z'));
    const { panel, errors } = await mountVisualCase(page, { theme, state, scenario, ...product });
    const screenshot = async suffix => {
      const bounds = await panel.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, bottom: rect.bottom, overflow: el.scrollWidth - el.clientWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width + 1);
      expect(bounds.bottom).toBeLessThanOrEqual(height + 1);
      expect(bounds.overflow).toBeLessThanOrEqual(1);
      // Keep exact real viewport context AND an unscaled crop of the actual panel, not its pill wrapper.
      if (!preflight) {
        // Test-only deliberate visual regression; never modifies the product source or golden files.
        if (process.env.AU05_VISUAL_NEGATIVE_CONTROL === '1') {
          await page.addStyleTag({ content: '[data-au05-panel] { background:#ff00ff !important; }' });
        }
        await expect(page).toHaveScreenshot(`${name}${suffix}-viewport.png`);
        await expect(panel).toHaveScreenshot(`${name}${suffix}-panel.png`);
      }
    };
    await screenshot('');
    for (const step of scenario.steps ?? []) {
      await page.evaluate(updates => window.publishAu05VisualSnapshot(updates), step.updates);
      await expect.poll(() => panel.locator('[data-au05-input-state]').evaluateAll(elements =>
        Object.fromEntries(elements.map(el => [el.dataset.au05InputState, el.textContent])))).toEqual(step.labels ?? {});
      await screenshot(`-${step.name}`);
    }
    if (state === 'settings' || state === 'custom') {
      await page.locator('[data-au05-advanced] > summary').click();
      await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await screenshot('-advanced');
    }
    expect(await page.evaluate(() => window.au05VisualForbiddenCalls)).toEqual([]);
    expect(await page.evaluate(() => window.au05VisualActions.filter(action => action !== 'refreshMicrophones'))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const [theme, width] of [['light', 320], ['dark', 480]]) {
  test(`region-native-hover-help-${theme}`, async ({ page, browser }, info) => {
    expect(browser.version()).toBe('145.0.7632.6');
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z'));
    const { panel, errors } = await mountVisualCase(page, { theme, state: 'default',
      scenario: { initial: { connected: true, state: 'ready', knobMode: 'regions' } }, ...product });
    const mapping = panel.getByText('滚动高亮区域需鼠标悬停；按下切换区域。', { exact: true });
    await expect(mapping).toBeVisible();
    const bounds = await panel.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, right: rect.right, overflow: el.scrollWidth - el.clientWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width + 1);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    const path = info.outputPath(`region-native-hover-${theme}.png`);
    await panel.screenshot({ path }); await info.attach('native-hover-copy', { path, contentType: 'image/png' });
    expect(await page.evaluate(() => window.au05VisualForbiddenCalls)).toEqual([]);
    expect(await page.evaluate(() => window.au05VisualActions.filter(action => action !== 'refreshMicrophones'))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('region-diagnostics-narrow', async ({ page, browser }, info) => {
  expect(browser.version()).toBe('145.0.7632.6');
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z'));
  const { panel, errors } = await mountVisualCase(page, { theme: 'light', state: 'settings',
    scenario: { initial: { connected: true, state: 'ready', knobMode: 'regions' } }, ...product });
  await page.locator('[data-au05-advanced] > summary').click();
  const diagnostics = page.locator('[data-au05-region-diagnostics]');
  await diagnostics.locator('summary').click();
  const start = diagnostics.getByRole('button', { name: '采样 5 秒', exact: true });
  await expect(start).toBeEnabled();
  await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
  if (!preflight) {
    const path = info.outputPath('region-diagnostics-ready.png'); await panel.screenshot({ path });
    await info.attach('region-diagnostics-ready', { path, contentType: 'image/png' });
    await expect.soft(panel).toHaveScreenshot('region-diagnostics-ready-panel.png');
  }
  await page.evaluate(() => window.publishAu05VisualSnapshot([{ regionDiagnostics: { version: 1, state: 'recording', entries: [] } }]));
  await expect(start).toBeDisabled(); await expect(diagnostics).toHaveAttribute('aria-busy', 'true');
  await expect(diagnostics.locator('textarea')).toHaveCount(0);
  const sample = { version: 1, state: 'stopped', elapsedMs: 32, dropped: 0,
    entries: [{ type: 'stop', tMs: 32, region: 'conversation', reason: 'external_offset', position: 160, target: 200 }] };
  await page.evaluate(value => window.publishAu05VisualSnapshot([{ knobMode: 'scroll', regionDiagnostics: value }]), sample);
  const output = diagnostics.getByRole('textbox', { name: 'AU05 滚动诊断 JSON', exact: true });
  await expect(output).toHaveValue(JSON.stringify(sample)); await expect(output).toHaveAttribute('readonly', '');
  await expect(start).toBeDisabled();
  await output.focus(); await expect(output).toBeFocused();
  await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  if (!preflight) {
    const path = info.outputPath('region-diagnostics-result.png'); await panel.screenshot({ path });
    await info.attach('region-diagnostics-result', { path, contentType: 'image/png' });
    await expect.soft(panel).toHaveScreenshot('region-diagnostics-result-panel.png');
  }
  expect(await page.evaluate(() => window.au05VisualForbiddenCalls)).toEqual([]);
  expect(await page.evaluate(() => window.au05VisualActions.filter(action => action !== 'refreshMicrophones'))).toEqual([]);
  expect(errors).toEqual([]);
});
