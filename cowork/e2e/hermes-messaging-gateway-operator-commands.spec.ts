import path from 'node:path';
import { expect, test } from './fixtures';

const fixtureConfigPath = 'e2e/fixtures/hermes-messaging-channels.json';
process.env.CODEBUDDY_CHANNELS_CONFIG = fixtureConfigPath;

async function dismissOnboardingIfPresent(appPage: import('@playwright/test').Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('captures Hermes messaging gateway operator commands from the Fleet window', async ({
  appPage,
}) => {
  test.setTimeout(160_000);
  const repoRoot = path.resolve(process.cwd(), '..');
  await appPage.setViewportSize({ width: 1440, height: 1000 });
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

  const directStatus = await appPage.evaluate(
    async (configPath) => window.electronAPI?.channels?.status?.({ configPath }),
    fixtureConfigPath
  );
  expect(directStatus).toMatchObject({
    ok: true,
    report: {
      config: {
        configuredCount: 1,
        enabledCount: 1,
      },
      kind: 'codebuddy_channel_status',
    },
  });
  expect(JSON.stringify(directStatus)).not.toContain('fixture-token-not-secret');

  await appPage.getByTestId('fleet-command-center-button').click();
  const fleetCenter = appPage.getByTestId('fleet-command-center');
  await expect(fleetCenter).toBeVisible();

  const gateway = appPage.getByTestId('fleet-hermes-messaging-gateway');
  await gateway.scrollIntoViewIfNeeded();
  await expect(gateway).toBeVisible();
  await expect(gateway).toContainText('Hermes messaging gateway');
  await expect(gateway).toContainText('Configured');
  await expect(gateway).toContainText('1');
  await expect(gateway).toContainText('telegram');
  await expect(gateway).toContainText('buddy hermes messaging status --json');
  await expect(gateway).toContainText('buddy hermes messaging start --json --config');
  await expect(gateway).not.toContainText('fixture-token-not-secret');

  await fleetCenter.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/111-hermes-messaging-gateway-operator-commands.png'
    ),
  });
});
