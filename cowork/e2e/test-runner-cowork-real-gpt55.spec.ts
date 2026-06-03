import path from 'node:path';
import { expect, test } from './fixtures';

const REAL_GPT55_ENABLED = process.env.COWORK_REAL_GPT55 === '1';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test.skip(
  !REAL_GPT55_ENABLED,
  'Set COWORK_REAL_GPT55=1 to run the real Cowork ChatGPT gpt-5.5 smoke from the GUI test runner.'
);

test('runs the real Cowork ChatGPT gpt-5.5 chat smoke from the test runner window', async ({
  appPage,
}) => {
  test.setTimeout(360_000);
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

  await appPage.getByTestId('test-runner-button').click();
  await expect(appPage.getByRole('heading', { name: 'Tests & executions' })).toBeVisible();

  const realChatId = 'code-buddy-cowork-real-gpt55-chat';
  const realChatRow = appPage.getByTestId(`test-catalog-row-${realChatId}`);
  await expect(realChatRow).toBeVisible();
  await expect(realChatRow).toContainText('COWORK_REAL_GPT55');
  await realChatRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${realChatId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${realChatId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 300_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${realChatId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 300_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/public-test-runner-cowork-real-gpt55.png'
    ),
    clip: { x: 640, y: 70, width: 460, height: 610 },
  });
});
