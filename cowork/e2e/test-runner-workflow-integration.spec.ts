import path from 'node:path';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('runs the real workflow bridge integration suite from the test runner window', async ({
  appPage,
}) => {
  test.setTimeout(180_000);
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

  const workflowId = 'code-buddy-cowork-workflow-bridge-integration';
  const workflowRow = appPage.getByTestId(`test-catalog-row-${workflowId}`);
  await expect(workflowRow).toBeVisible();
  await expect(workflowRow).toContainText('workflow bridge integration');
  await expect(workflowRow).toContainText('Vitest avec vrai Orchestrator local');
  await workflowRow.scrollIntoViewIfNeeded();
  await appPage.getByTestId(`test-catalog-run-${workflowId}`).click();

  await expect(appPage.getByTestId(`test-catalog-status-${workflowId}`)).toHaveAttribute(
    'aria-label',
    'passed',
    { timeout: 150_000 }
  );
  await expect(appPage.getByTestId(`test-catalog-result-${workflowId}`)).toHaveText(
    '8 ok / 0 ko',
    { timeout: 150_000 }
  );
  const outputText = await appPage.getByTestId('test-runner-output').textContent();
  expect(outputText ?? '').not.toContain('\u001b');
  expect(outputText ?? '').not.toContain('[32m');

  await appPage.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/54-test-runner-workflow-integration.png'
    ),
    fullPage: true,
  });
});
