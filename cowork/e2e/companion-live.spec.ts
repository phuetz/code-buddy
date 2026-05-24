import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

test.skip(
  process.env.COWORK_LIVE_COMPANION !== '1',
  'Live companion validation requires COWORK_LIVE_COMPANION=1 and a built root dist/.',
);

async function completeOnboardingForTest(appPage: Page) {
  await appPage.evaluate(async () => {
    await window.electronAPI?.config?.save?.({
      onboardingCompleted: true,
    } as Record<string, unknown>);
  });

  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible().catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
}

async function createProjectThroughSettings(
  appPage: Page,
  userDataDir: string,
): Promise<string> {
  const workspacePath = path.join(userDataDir, 'buddy-live-workspace');
  mkdirSync(workspacePath, { recursive: true });

  await appPage.getByTestId('sidebar-settings-button').click();
  await expect(appPage.getByTestId('settings-panel')).toBeVisible({ timeout: 20_000 });
  await completeOnboardingForTest(appPage);
  await appPage.getByTestId('settings-tab-projects').click();

  await appPage.getByPlaceholder('Project name').fill('Buddy Live Project');
  await appPage.getByPlaceholder('Workspace path').fill(workspacePath);
  await appPage.getByRole('button', { name: 'Create project' }).click();

  await expect(appPage.getByText('Buddy Live Project')).toBeVisible();
  await appPage.getByRole('button', { name: 'Set active' }).click();
  await expect(appPage.getByRole('button', { name: 'Clear active' })).toBeVisible();
  await appPage.getByTestId('settings-panel').getByRole('button', { name: 'Close' }).click();

  return workspacePath;
}

async function readCompanionPanelText(appPage: Page): Promise<string> {
  return appPage.locator('body').innerText();
}

test('validates Buddy companion against real core IPC and local hardware surfaces', async ({
  appPage,
  userDataDir,
}) => {
  await completeOnboardingForTest(appPage);

  await appPage.getByTestId('companion-panel-button').click();
  await expect(appPage.getByRole('heading', { name: 'Buddy companion' })).toBeVisible();
  await expect(
    appPage.getByText('Select a project before opening Buddy companion senses.'),
  ).toBeVisible();
  await appPage.getByLabel('Close companion panel').click();

  const workspacePath = await createProjectThroughSettings(appPage, userDataDir);

  await completeOnboardingForTest(appPage);
  await appPage.getByTestId('companion-panel-button').click();
  await expect(appPage.getByRole('heading', { name: 'Buddy companion' })).toBeVisible();
  await expect(appPage.getByText(workspacePath, { exact: true })).toBeVisible();
  await expect(appPage.getByText('Brain', { exact: true })).toBeVisible();
  await expect(appPage.getByText('Dialogue', { exact: true })).toBeVisible();
  await expect(appPage.getByText('Camera', { exact: true })).toBeVisible();

  const initialText = await readCompanionPanelText(appPage);
  expect(initialText).not.toContain('core companion module unavailable');
  expect(initialText).not.toContain('Failed to load companion status');

  await appPage.getByRole('button', { name: 'Record self-state' }).click();
  await expect(appPage.getByText('self/companion_status')).toBeVisible({ timeout: 15_000 });

  await appPage.getByRole('button', { name: 'Self-evaluate' }).click();
  await expect(appPage.getByText('Self-evaluation')).toBeVisible({ timeout: 20_000 });

  await appPage.getByRole('button', { name: 'Improve loop' }).click();
  await expect(appPage.getByText('Improvement loop')).toBeVisible({ timeout: 20_000 });

  await appPage.getByRole('button', { name: 'Buddy check-in' }).click();
  await expect(appPage.getByRole('heading', { name: 'Check-in' })).toBeVisible({
    timeout: 20_000,
  });

  await appPage.getByRole('button', { name: 'Inspect camera' }).click();
  await expect
    .poll(async () => {
      const panelText = await readCompanionPanelText(appPage);
      if (panelText.includes('Vision inspection')) return 'vision-ok';
      if (
        panelText.includes('Cannot capture camera snapshot') ||
        panelText.includes('Camera inspection failed') ||
        panelText.includes('Camera snapshot failed') ||
        panelText.includes('core camera')
      ) {
        return 'camera-unavailable-controlled';
      }
      return 'waiting';
    }, { timeout: 20_000 })
    .not.toBe('waiting');

  const finalText = await readCompanionPanelText(appPage);
  expect(finalText).not.toContain('NO_ACTIVE_PROJECT');
  expect(finalText).not.toContain('Unhandled');
});
