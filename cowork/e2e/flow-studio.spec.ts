import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboarding(appPage: import('@playwright/test').Page) {
  await appPage.evaluate(() => localStorage.setItem('cowork.tourSeen', '1'));
  const wizard = appPage.getByTestId('onboarding-wizard');
  if (await wizard.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
  }
  const tour = appPage.getByTestId('onboarding-tour');
  if (await tour.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await tour.getByRole('button', { name: 'Passer', exact: true }).click();
  }
}

test('Flow Studio composes ingredients, keyframes and image variants', async ({ electronApp, appPage }) => {
  const consoleErrors: string[] = [];
  appPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await dismissOnboarding(appPage);
  const conceptPath = path.resolve('..', 'docs', 'designs', 'code-buddy-flow-studio-concept.png');
  const videoPath = path.resolve('..', 'docs', 'assets', 'cowork-panels-demo.mp4');

  await electronApp.evaluate(({ ipcMain }, input) => {
    ipcMain.removeHandler('media.list');
    ipcMain.handle('media.list', async () => []);
    ipcMain.removeHandler('dialog.selectFiles');
    ipcMain.handle('dialog.selectFiles', async () => [input.conceptPath]);
    ipcMain.removeHandler('media.generateImage');
    ipcMain.handle('media.generateImage', async () => ({
      ok: true,
      outputPath: input.conceptPath,
      url: `file://${input.conceptPath}`,
    }));
    ipcMain.removeHandler('media.generateVideo');
    ipcMain.handle('media.generateVideo', async (_event, request?: { imagePath?: string; referenceImagePaths?: string[] }) => {
      if (request?.imagePath !== input.conceptPath || request.referenceImagePaths?.[0] !== input.conceptPath) {
        return { ok: false, error: 'references missing' };
      }
      return { ok: true, outputPath: input.videoPath, url: `file://${input.videoPath}` };
    });
    ipcMain.removeHandler('media.capabilities');
    ipcMain.handle('media.capabilities', async () => ({
      imageGeneration: true,
      imageReferences: false,
      videoGeneration: true,
      videoReferences: true,
      firstFrame: true,
      lastFrame: false,
      audio: true,
      provider: 'fal',
      model: 'pixverse-v6',
    }));
    ipcMain.removeHandler('media.export');
    ipcMain.handle('media.export', async () => ({ ok: true, savedTo: '/tmp/export/plan.png' }));
    ipcMain.removeHandler('media.exportMany');
    ipcMain.handle('media.exportMany', async (_event, request?: { paths?: string[] }) => ({ ok: true, copied: request?.paths?.length ?? 0, destDir: '/tmp/export' }));
    ipcMain.removeHandler('media.assembleVideo');
    ipcMain.handle('media.assembleVideo', async (_event, request?: { clips?: string[] }) => {
      if ((request?.clips?.length ?? 0) < 2) return { ok: false, error: 'missing clips' };
      return { ok: true, outputPath: input.videoPath, url: `file://${input.videoPath}`, duration: 20, warnings: [] };
    });
  }, { conceptPath, videoPath });

  await appPage.evaluate(() => {
    window.useAppStore?.getState().setPrimaryView('videostudio');
  });

  const studio = appPage.getByTestId('video-studio-view');
  await expect(studio).toBeVisible();
  await expect(studio).toContainText('Atelier Flow');
  await studio.getByLabel('Nom du projet Flow').fill('Neon Story');
  await expect(appPage.getByTestId('flow-scene-timeline')).toContainText('4 plans');

  await appPage.getByTestId('flow-add-ingredient').click();
  const ingredient = appPage.getByRole('button', { name: /CodeBuddyFlowStudioConcept/ });
  await expect(ingredient).toBeVisible();
  await appPage.getByTestId('flow-ingredient-rail').getByRole('button', { name: 'Personnages' }).click();
  await expect(ingredient).toBeHidden();
  await appPage.getByTestId('flow-ingredient-rail').getByRole('button', { name: 'Objets' }).click();
  await expect(ingredient).toBeVisible();
  await ingredient.click();
  await expect(appPage.getByTestId('flow-prompt')).toHaveValue(/@CodeBuddyFlowStudioConcept/);

  await studio.getByRole('button', { name: 'Images clés' }).click();
  await studio.getByRole('button', { name: /Début/ }).click();
  await expect(studio.getByRole('button', { name: /Début/ })).toContainText('CodeBuddyFlowStudioConcept');

  await appPage.getByTestId('flow-mode-image').click();
  await expect(appPage.getByTestId('flow-capability-note')).toContainText('édition multimodale');
  await studio.getByLabel('Sorties').selectOption('2');
  await appPage.getByTestId('flow-generate').click();
  await expect(appPage.getByTestId('flow-image-preview')).toBeVisible();
  await expect(appPage.getByTestId('flow-notice')).toContainText('2 variantes');
  await expect(appPage.getByTestId('flow-scene-5')).toBeVisible();
  await appPage.getByTestId('flow-export-selected').click();
  await expect(appPage.getByTestId('flow-notice')).toContainText('Plan exporté');
  await appPage.getByTestId('flow-export-all').click();
  await expect(appPage.getByTestId('flow-notice')).toContainText('2 média');

  await appPage.getByTestId('flow-extend-scene').click();
  await expect(appPage.getByTestId('flow-scene-6')).toBeVisible();
  await expect(appPage.getByTestId('flow-prompt')).toHaveValue(/Continuation fluide/);

  await appPage.screenshot({ path: '/tmp/codebuddy-flow-studio.png', fullPage: false });

  await appPage.getByTestId('flow-mode-video').click();
  await expect(appPage.getByTestId('flow-capability-note')).toContainText('fal/pixverse-v6');
  await appPage.getByTestId('flow-generate').click();
  await expect(appPage.getByTestId('flow-video-preview')).toBeVisible();
  await appPage.getByTestId('flow-assemble').click();
  await expect(appPage.getByTestId('flow-notice')).toContainText('Film final assemblé');
  await expect(appPage.getByTestId('flow-scene-8')).toBeVisible();

  await appPage.waitForTimeout(350);
  await appPage.reload();
  await appPage.evaluate(() => window.useAppStore?.getState().setPrimaryView('videostudio'));
  await expect(appPage.getByTestId('video-studio-view')).toBeVisible();
  await expect(appPage.getByLabel('Nom du projet Flow')).toHaveValue('Neon Story');
  await expect(appPage.getByTestId('flow-scene-timeline')).toContainText('8 plans');
  await appPage.getByTestId('flow-new-project').click();
  await expect(appPage.getByLabel('Nom du projet Flow')).toHaveValue('Projet sans titre');
  await expect(appPage.getByTestId('flow-project-picker').locator('option')).toHaveCount(2);
  await appPage.getByLabel('Nom du projet Flow').fill('Second Story');
  await appPage.waitForTimeout(350);
  await appPage.getByTestId('flow-project-picker').selectOption({ label: 'Neon Story' });
  await expect(appPage.getByLabel('Nom du projet Flow')).toHaveValue('Neon Story');
  await expect(appPage.getByTestId('flow-scene-timeline')).toContainText('8 plans');
  await appPage.screenshot({ path: '/tmp/codebuddy-flow-studio-restored.png', fullPage: false });
  expect(consoleErrors).toEqual([]);
});
