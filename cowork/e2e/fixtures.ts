import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import electronBinary from 'electron';
import os from 'node:os';
import path from 'node:path';

/**
 * Intentionally no Buffalo_S ONNX in the shared e2e fixture.
 * An empty file made `presence:has-model` lie (VD/R33 twin). A real ~13 MB
 * model is not vendored. The install dialog is not auto-opened (84450e4d8).
 */
export const BUFFALO_ONNX_FIXTURE_SKIP_REASON =
  'No Buffalo_S ONNX in e2e: empty files lie about install; a real 13MB model is not vendored. Dialog is not auto-opened.';

type CoworkFixtures = {
  electronApp: ElectronApplication;
  appPage: Page;
  userDataDir: string;
};

export const test = base.extend<CoworkFixtures>({
  // Playwright requires an object destructure here (`{}`), not `_`.
  // eslint-disable-next-line no-empty-pattern -- fixture contract, see e2e-fixture-destructure.test.ts
  userDataDir: async ({}, use) => {
    const configuredRoot = process.env.COWORK_E2E_TMP_ROOT?.trim();
    const tempRoot = configuredRoot ? path.resolve(configuredRoot) : os.tmpdir();
    mkdirSync(tempRoot, { recursive: true });
    const tempDir = mkdtempSync(path.join(tempRoot, 'cowork-e2e-'));
    await use(tempDir);
    rmSync(tempDir, { recursive: true, force: true });
  },
  electronApp: async ({ userDataDir }, use) => {
    const electronApp = await electron.launch({
      executablePath: electronBinary,
      cwd: process.cwd(),
      args: ['e2e/electron-main.cjs', '--lang=en-US', '--no-sandbox', '--disable-gpu'],
      env: {
        ...process.env,
        COWORK_E2E: '1',
        COWORK_E2E_USER_DATA_DIR: userDataDir,
        CODEBUDDY_RUNS_DIR: path.join(userDataDir, 'codebuddy-runs'),
        CI: '1',
      },
    });

    await use(electronApp);
    await electronApp.close();
  },
  appPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });
    await use(page);
  },
});

export { expect };
