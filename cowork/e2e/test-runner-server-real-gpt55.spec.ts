import path from 'node:path';
import { expect, test } from './fixtures';

const REAL_SERVER_GPT55_ENABLED = process.env.CODEBUDDY_REAL_GPT55_SERVER === '1';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test.skip(
  !REAL_SERVER_GPT55_ENABLED,
  'Set CODEBUDDY_REAL_GPT55_SERVER=1 to run the real server ChatGPT gpt-5.5 smoke from the GUI test runner.'
);

test('runs the real server ChatGPT gpt-5.5 API smoke from the test runner window', async ({
  appPage,
}) => {
  test.setTimeout(420_000);
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

  const realServerId = 'code-buddy-server-real-gpt55-chat';
  const realServerRow = appPage.getByTestId(`test-catalog-row-${realServerId}`);
  await expect(realServerRow).toBeVisible();
  await expect(realServerRow).toContainText('CODEBUDDY_REAL_GPT55_SERVER');
  await realServerRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${realServerId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${realServerId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 360_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${realServerId}`)).toHaveText(
    '1 ok / 0 ko',
    { timeout: 360_000 }
  );

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/public-test-runner-server-real-gpt55.png'
    ),
    clip: { x: 640, y: 70, width: 460, height: 610 },
  });
});
