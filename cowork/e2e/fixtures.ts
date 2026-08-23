import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import electronBinary from 'electron';
import os from 'node:os';
import path from 'node:path';

type CoworkFixtures = {
  electronApp: ElectronApplication;
  appPage: Page;
  userDataDir: string;
};

export const test = base.extend<CoworkFixtures>({
  userDataDir: async (_, use) => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cowork-e2e-'));
    await use(tempDir);
    rmSync(tempDir, { recursive: true, force: true });
  },
  electronApp: async ({ userDataDir }, use) => {
    const modelPath = path.join(userDataDir, 'models', 'buffalo_s.onnx');
    mkdirSync(path.dirname(modelPath), { recursive: true });
    writeFileSync(modelPath, '');

    const electronApp = await electron.launch({
      executablePath: electronBinary,
      cwd: process.cwd(),
      args: ['e2e/electron-main.cjs', '--lang=en-US'],
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
