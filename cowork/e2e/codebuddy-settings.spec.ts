import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function dismissOnboardingIfPresent(appPage: Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('selects a Code Buddy model discovered from the configured backend', async ({ appPage }) => {
  await appPage.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/v1/models')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'gpt-local-e2e' },
            { id: 'qwen-e2e:32b' },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
  });

  await dismissOnboardingIfPresent(appPage);
  await appPage.getByTestId('sidebar-settings-button').click();
  await expect(appPage.getByTestId('settings-panel')).toBeVisible({ timeout: 20000 });
  await dismissOnboardingIfPresent(appPage);
  await appPage.getByTestId('settings-tab-codebuddy').click();
  await expect(appPage.getByTestId('settings-codebuddy')).toBeVisible();

  await appPage.getByTestId('codebuddy-models-refresh').click();
  await expect(appPage.getByTestId('codebuddy-model-select')).toBeVisible();

  const selector = appPage.getByTestId('codebuddy-model-select');
  await expect(selector).toContainText('qwen-e2e:32b');
  await selector.selectOption('qwen-e2e:32b');
  await expect(selector).toHaveValue('qwen-e2e:32b');
});
