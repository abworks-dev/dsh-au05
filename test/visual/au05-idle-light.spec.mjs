import { test, expect } from '@playwright/test';
import { loadVisualSource, mountVisualCase } from '../fixtures/au05-visual-harness.mjs';
const product = await loadVisualSource();
for (const [theme, width] of [['light', 1280], ['dark', 320]]) {
  test(`idle snapshot deferred notice ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 640 });
    const request = { type: 'request', requestId: 7, state: 'idle', channels: [0, 0, 0, 0] };
    const initial = { connected: true, state: 'ready', lightState: 'idle', lightsEnabled: true,
      lightResult: 'failed', lightError: 'snapshot_unavailable', lightTrace: [request,
        { ...request, type: 'result', result: 'failed', reason: 'snapshot_unavailable', readback: { stage: 'initial', matched: 0 } }] };
    const { pill, panel, errors } = await mountVisualCase(page, { theme, state: 'default', scenario: { initial }, ...product });
    await expect(pill).toHaveAttribute('data-attention', 'false');
    const status = panel.locator('[data-au05-light-status]');
    await expect(status).toHaveText('灯光：待命，尚未接管');
    await expect(status).toHaveAttribute('role', 'status');
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await info.attach('idle-snapshot-notice', { body: await page.screenshot({ path: info.outputPath('idle-snapshot-notice.png') }), contentType: 'image/png' });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.au05VisualForbiddenCalls)).toEqual([]);
  });
}
