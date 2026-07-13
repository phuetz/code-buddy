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

test('rail theme picker applies and persists the selected theme', async ({ appPage }) => {
  const consoleErrors: string[] = [];
  appPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await dismissOnboardingIfPresent(appPage);

  const themeButton = appPage.getByTestId('rail-theme');
  await expect(themeButton).toBeVisible();
  await expect(appPage.getByLabel('Palette de commandes')).toBeVisible();
  await expect(appPage.getByLabel('Raccourcis clavier')).toBeVisible();
  await themeButton.click();

  const picker = appPage.getByTestId('theme-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('menuitemradio')).toHaveCount(7);
  await expect(appPage.getByTestId('theme-option-light')).toHaveAttribute('aria-checked', 'true');

  await appPage.getByTestId('theme-option-dark').click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(() => appPage.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe('dark');

  await appPage.reload();
  await expect(appPage.getByTestId('app-root')).toBeVisible();
  await expect
    .poll(() => appPage.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe('dark');

  await appPage.getByTestId('rail-theme').click();
  await expect(appPage.getByTestId('theme-option-dark')).toHaveAttribute('aria-checked', 'true');
  await appPage.getByTestId('theme-option-light').click();
  await expect(appPage.locator('html')).toHaveClass(/\blight\b/);

  await appPage.reload();
  await expect(appPage.getByTestId('app-root')).toBeVisible();
  await expect(appPage.locator('html')).toHaveClass(/\blight\b/);
  await appPage.getByTestId('rail-theme').click();
  await expect(appPage.getByTestId('theme-option-light')).toHaveAttribute('aria-checked', 'true');

  await appPage.screenshot({
    path: path.join('/tmp', 'codebuddy-theme-picker-light.png'),
    fullPage: false,
  });
  expect(consoleErrors).toEqual([]);
});
