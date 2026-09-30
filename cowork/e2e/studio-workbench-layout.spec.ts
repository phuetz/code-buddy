import path from 'node:path';
import { test, expect } from './fixtures';

test('the scaffold composer leaves the editor toolbar clickable at laptop size', async ({ electronApp, appPage, userDataDir }) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
  });
  await appPage.evaluate(() => localStorage.setItem('cowork.tourSeen', '1'));
  if (await appPage.getByTestId('onboarding-skip').isVisible()) await appPage.getByTestId('onboarding-skip').click();
  const skip = appPage.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.isVisible()) await skip.click();
  await appPage.getByTitle('App Studio', { exact: true }).click();
  await appPage.getByPlaceholder(/Describe the app to build/).fill('A small synthetic app');
  await appPage.getByPlaceholder('Destination folder', { exact: true }).fill(path.join(userDataDir, 'app'));
  await appPage.getByRole('button', { name: 'Template', exact: true }).click();
  await expect(appPage.getByText('Project created:', { exact: false })).toBeVisible({ timeout: 30_000 });
  const run = appPage.getByRole('button', { name: 'Run', exact: true });
  // A trial click checks real Chromium hit testing without starting a server.
  await run.click({ trial: true, timeout: 5_000 });
  await appPage.getByRole('button', { name: 'Editor', exact: true }).click();
  const editor = appPage.locator('.cm-editor');
  await expect(editor).toBeVisible();
  expect((await editor.boundingBox())?.height).toBeGreaterThan(40);
  const command = await appPage.evaluate(async (cwd) => {
    return window.electronAPI.studio.commands.runToEnd({ cwd, command: 'node --version', id: 'scaffold-workspace-check' });
  }, path.join(userDataDir, 'app'));
  expect(command).toMatchObject({ ok: true, data: { code: 0 } });
});
