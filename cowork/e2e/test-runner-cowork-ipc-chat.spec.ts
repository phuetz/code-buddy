import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the Cowork local OpenAI chat flow from the test runner window', async ({
  appPage,
}) => {
  test.setTimeout(200_000);
  const repoRoot = path.resolve(process.cwd(), '..');
  await dismissOnboardingIfPresent(appPage);

  const workdirResult = await appPage.evaluate(
    async (workspacePath) =>
      window.electronAPI?.invoke?.({
        type: 'workdir.set',
        payload: { path: workspacePath },
      }),
    repoRoot
  );
  expect(workdirResult).toMatchObject({ success: true });

  await appPage.getByText('Outils').click();
  await appPage.getByText('Test Runner').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  const chatId = 'code-buddy-cowork-ipc-chat-flow';
  const chatRow = appPage.getByTestId(`test-catalog-row-${chatId}`);
  await expect(chatRow).toBeVisible();
  await expect(chatRow).toContainText('local OpenAI chat flow');
  await expect(chatRow).toContainText('session chat');
  await expect(chatRow).toContainText('bulle assistant');
  await chatRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${chatId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${chatId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 170_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${chatId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 170_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/59-test-runner-cowork-ipc-chat.png'
    ),
    fullPage: true,
  });
});
