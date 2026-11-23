import { test, expect } from '@playwright/test';
import { loadVisualSource, mountVisualCase } from '../fixtures/au05-visual-harness.mjs';
const product = await loadVisualSource();

for (const [theme, width, height] of [['light', 1280, 800], ['dark', 320, 480]]) {
  test(`capsule drag, edge reveal and keyboard reset ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const { pill, panel, errors } = await mountVisualCase(page, { theme, state: 'default', ...product });
    const before = await page.evaluate(() => window.au05VisualActions.slice());
    await panel.getByRole('button', { name: '收起 AU05 设备面板', exact: true }).click();
    const box = await pill.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(5, height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(panel).toHaveCount(0); // A drag's compatibility click must not open or enumerate microphones.
    await expect(page.locator('[data-au05-plugin]')).toHaveAttribute('data-au05-docked', 'left');
    await page.mouse.move(width / 2, 20);
    await expect(page.locator('[data-au05-plugin]')).toHaveAttribute('data-au05-hidden', 'true');
    const hidden = await pill.boundingBox();
    expect(hidden.x).toBeLessThan(0);
    expect(hidden.x + hidden.width).toBeGreaterThan(0);
    await info.attach('half-hidden-capsule', { body: await page.screenshot({ path: info.outputPath('half-hidden.png') }), contentType: 'image/png' });
    await page.mouse.move(5, hidden.y + hidden.height / 2);
    await expect(page.locator('[data-au05-plugin]')).toHaveAttribute('data-au05-hidden', 'false');
    await expect.poll(async () => (await pill.boundingBox()).x).toBe(0);
    expect(await page.evaluate(() => window.au05VisualActions)).toEqual(before);
    await pill.focus();
    await page.keyboard.press('Alt+Home');
    await pill.click();
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await info.attach('revealed-panel', { body: await page.screenshot({ path: info.outputPath('revealed-panel.png') }), contentType: 'image/png' });
    expect(await page.evaluate(() => window.au05VisualForbiddenCalls)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
