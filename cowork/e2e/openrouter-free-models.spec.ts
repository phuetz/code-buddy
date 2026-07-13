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

test('OpenRouter exposes a zero-cost model pool without changing the saved provider', async ({
  appPage,
}) => {
  const consoleErrors: string[] = [];
  appPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await dismissOnboardingIfPresent(appPage);

  await appPage.evaluate(() => {
    const exposed = window as typeof window & {
      useAppStore?: { getState: () => { setShowSettings?: (show: boolean) => void } };
    };
    exposed.useAppStore?.getState().setShowSettings?.(true);
  });
  await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  await appPage.getByTestId('settings-tab-api').click();
  await appPage.getByTestId('llm-provider-openrouter').click();
  const modelInput = appPage.locator('#api-model-input');
  if ((await modelInput.evaluate((element) => element.tagName)) === 'INPUT') {
    await appPage.getByTestId('llm-toggle-model-preset').click();
  }

  const models = appPage.locator('#api-model-input');
  await expect(models).toBeVisible();
  await expect(models.locator('option[value="openrouter/free"]')).toHaveText(
    'Gratuit — routeur automatique (recommandé)'
  );
  await expect(models.locator('option[value="openai/gpt-oss-20b:free"]')).toHaveCount(1);
  await expect(models.locator('option[value="cohere/north-mini-code:free"]')).toHaveCount(1);
  await expect(models.locator('option[value="qwen/qwen3-coder:free"]')).toHaveCount(1);
  await expect(models.locator('option[value="google/gemma-4-26b-a4b-it:free"]')).toHaveCount(1);
  await expect(
    models.locator('option[value="nvidia/nemotron-3-ultra-550b-a55b:free"]')
  ).toHaveCount(1);
  await expect(models.locator('option[value="poolside/laguna-xs-2.1:free"]')).toHaveCount(1);

  // Provider changes stay local because this QA path never clicks the explicit
  // save button.
  expect(consoleErrors).toEqual([]);
});
