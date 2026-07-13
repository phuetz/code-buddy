import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  await appPage.evaluate(() => localStorage.setItem('cowork.tourSeen', '1'));
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
  const tour = appPage.getByTestId('onboarding-tour');
  if (await tour.isVisible({ timeout: 1500 }).catch(() => false)) {
    await tour.getByRole('button', { name: 'Passer', exact: true }).click();
    await expect(tour).toHaveCount(0);
  }
}

test('Assistant presents resident Pocket TTS as primary and Piper as fallback', async ({
  appPage,
}) => {
  const consoleErrors: string[] = [];
  appPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await dismissOnboardingIfPresent(appPage);

  await appPage.getByTitle('Assistant').click();
  await expect(appPage.getByTestId('assistant-view')).toBeVisible();
  await expect(appPage.getByRole('heading', { name: 'Assistant' })).toBeVisible();

  const engine = appPage.getByTestId('assistant-field-CODEBUDDY_TTS_ENGINE');
  await expect(engine).toHaveValue('pocket');
  await expect(engine.locator('option[value="pocket"]')).toHaveText('Pocket TTS — recommandé');
  await expect(engine.locator('option[value="piper"]')).toHaveText('Piper — secours ancien');

  const resident = appPage.getByTestId('assistant-field-CODEBUDDY_POCKET_SERVER');
  await expect(resident).toHaveAttribute('aria-checked', 'true');
  await expect(appPage.getByTestId('assistant-field-CODEBUDDY_POCKET_URL')).toHaveValue(
    'http://127.0.0.1:8766'
  );

  // Interaction proof: switching remains reversible in local UI state and does
  // not save/restart the daemon during this QA test.
  await engine.selectOption('piper');
  await expect(engine).toHaveValue('piper');
  await expect(appPage.getByText('1 changement en attente')).toBeVisible();
  await engine.selectOption('pocket');
  await expect(engine).toHaveValue('pocket');
  await expect(appPage.getByText('Aucun changement en attente')).toBeVisible();

  // Regression proof for the former no-op « Écouter » button: the renderer
  // must reach the main-process synthesis/player bridge and surface completion.
  const previewButton = appPage.getByTestId('assistant-preview').first();
  await expect(previewButton).toBeEnabled();
  await previewButton.click();
  await expect(appPage.getByText(/Aperçu de « .* » joué\./)).toBeVisible({ timeout: 30_000 });

  await appPage.screenshot({
    path: path.join('/tmp', 'codebuddy-assistant-pocket-tts.png'),
    fullPage: false,
  });
  expect(consoleErrors).toEqual([]);
});
