import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const REAL_GPT55_ENABLED = process.env.COWORK_REAL_GPT55 === '1';
const MARKER = 'REAL-GPT55-COWORK-GUI';

async function configureChatGptProfile(appPage: Page) {
  const result = await appPage.evaluate(async () => {
    const current = await window.electronAPI?.config?.get?.();
    if (!current) {
      throw new Error('Config bridge unavailable');
    }

    const profiles = {
      ...current.profiles,
      chatgpt: {
        ...(current.profiles?.chatgpt || {}),
        apiKey: 'oauth-chatgpt',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        model: 'gpt-5.5',
      },
    };
    const activeConfigSetId = current.activeConfigSetId || current.configSets?.[0]?.id || 'default';
    const configSets = (current.configSets || []).map((set) =>
      set.id === activeConfigSetId
        ? {
            ...set,
            provider: 'chatgpt',
            customProtocol: 'anthropic',
            activeProfileKey: 'chatgpt',
            profiles,
            enableThinking: false,
            updatedAt: new Date().toISOString(),
          }
        : set,
    );

    return window.electronAPI?.config?.save?.({
      provider: 'chatgpt',
      activeProfileKey: 'chatgpt',
      profiles,
      activeConfigSetId,
      configSets,
      apiKey: 'oauth-chatgpt',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-5.5',
      isConfigured: true,
      onboardingCompleted: true,
    } as Record<string, unknown>);
  });

  expect(result).toMatchObject({ success: true });

  const saved = await appPage.evaluate(async () => window.electronAPI?.config?.get?.());
  expect(saved).toMatchObject({
    provider: 'chatgpt',
    activeProfileKey: 'chatgpt',
    model: 'gpt-5.5',
  });
}

async function completeOnboardingIfVisible(appPage: Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible().catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
}

test.skip(!REAL_GPT55_ENABLED, 'Set COWORK_REAL_GPT55=1 to call ChatGPT gpt-5.5 for real.');

test('starts a real Cowork chat through ChatGPT gpt-5.5', async ({ appPage }) => {
  test.setTimeout(240_000);

  await configureChatGptProfile(appPage);
  await completeOnboardingIfVisible(appPage);

  const prompt = `Reponds exactement: ${MARKER}`;
  await appPage.getByTestId('welcome-prompt-input').fill(prompt);
  await appPage.getByTestId('welcome-prompt-input').press('Enter');

  await expect(appPage.getByText(prompt, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(appPage.getByText(new RegExp(`^${MARKER}`))).toBeVisible({ timeout: 180_000 });

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/public-real-gpt55-cowork-chat.png',
    ),
    clip: { x: 350, y: 40, width: 760, height: 820 },
  });
});
