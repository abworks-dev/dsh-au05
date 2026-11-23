import { defineConfig } from '@playwright/test';

const preflight = process.env.AU05_VISUAL_PREFLIGHT === '1';
if (!preflight && process.platform !== 'win32') {
  throw new Error('Committed screenshots are Windows-only. Use npm run test:visual:preflight on other platforms; never relabel Windows goldens as Linux.');
}
if (process.env.CI && process.argv.some(arg => arg.startsWith('--update-snapshots'))) {
  throw new Error('CI must compare committed baselines, never update them.');
}

export default defineConfig({
  testDir: './test/visual',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  updateSnapshots: 'none',
  outputDir: 'test-results/au05-visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'test-results/au05-visual-report.json' }]],
  expect: {
    timeout: 5_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0.2, maxDiffPixels: 0 },
  },
  use: {
    browserName: 'chromium',
    headless: true,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    permissions: [],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-win32' }],
});
