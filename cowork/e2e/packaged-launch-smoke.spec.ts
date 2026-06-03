import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packagedExe = process.env.COWORK_PACKAGED_EXE?.trim();

test.skip(
  !packagedExe,
  'Set COWORK_PACKAGED_EXE to the generated win-unpacked executable to smoke the packaged Cowork app.',
);

test('launches the packaged Cowork app with an isolated profile and captures the shell', async () => {
  const executablePath = path.resolve(process.cwd(), packagedExe!);
  expect(existsSync(executablePath), `Missing packaged executable: ${executablePath}`).toBe(true);

  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'cowork-packaged-e2e-'));
  const modelPath = path.join(userDataDir, 'models', 'buffalo_s.onnx');
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, '');

  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await electron.launch({
      executablePath,
      cwd: path.dirname(executablePath),
      args: ['--lang=en-US'],
      env: {
        ...process.env,
        COWORK_E2E: '1',
        COWORK_E2E_USER_DATA_DIR: userDataDir,
        CODEBUDDY_RUNS_DIR: path.join(userDataDir, 'codebuddy-runs'),
        CI: '1',
      },
    });

    const appInfo = await electronApp.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      userData: app.getPath('userData'),
      name: app.getName(),
    }));

    expect(appInfo).toMatchObject({
      isPackaged: true,
      name: 'Code Buddy Studio',
      userData: userDataDir,
    });

    const page = await electronApp.firstWindow({ timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });

    const onboardingClose = page.getByTestId('onboarding-close');
    if (await onboardingClose.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await onboardingClose.click();
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0);
    }

    const screenshotPath = path.resolve(
      process.cwd(),
      '..',
      'docs',
      'qa',
      'code-buddy-studio',
      'screenshots',
      '110-packaged-win-unpacked-launch.png',
    );
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath });
  } finally {
    await electronApp?.close().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
