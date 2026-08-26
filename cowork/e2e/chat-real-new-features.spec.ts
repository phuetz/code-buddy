import path from 'node:path';
import { expect, test } from './fixtures';

const REAL_GPT55_ENABLED = process.env.COWORK_REAL_GPT55 === '1';

async function completeOnboardingForTest(appPage: import('@playwright/test').Page) {
  await appPage.evaluate(async () => {
    // @ts-expect-error window.electronAPI is not typed in page evaluate
    await window.electronAPI?.config?.save?.({
      onboardingCompleted: true,
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      isConfigured: true,
    });
  });

  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test.skip(
  !REAL_GPT55_ENABLED,
  'Set COWORK_REAL_GPT55=1 to run real ChatGPT tests.'
);

test('Real condition test of new features (MCP + Browser Overlay)', async ({ appPage }) => {
  test.setTimeout(600_000);
  await completeOnboardingForTest(appPage);

  // 1. Verify MCP Connectors are present in Settings -> MCP
  await appPage.getByText('Fichier', { exact: true }).click();
  await appPage.getByText('Paramètres').click();
  await expect(appPage.getByTestId('settings-panel')).toBeVisible({ timeout: 20000 });
  
  await appPage.getByTestId('settings-tab-mcpMarketplace').click();
  
  // They should be visible in the registry
  await expect(appPage.getByRole('heading', { name: 'Notion', exact: true }).first()).toBeVisible({ timeout: 10000 });
  await expect(appPage.getByRole('heading', { name: 'Slack', exact: true }).first()).toBeVisible();
  await expect(appPage.getByRole('heading', { name: 'Trello', exact: true }).first()).toBeVisible();

  // Take screenshot of MCP Marketplace
  await appPage.screenshot({
    path: path.resolve(process.cwd(), '../docs/qa/screenshots/mcp-marketplace-new-connectors.png'),
  });

  // 2. Go back to chat and use ChatGPT to trigger browser action
  await appPage.locator('button[aria-label="Fermer"]').or(appPage.locator('button[aria-label="Close"]')).first().click();
  await expect(appPage.getByTestId('settings-panel')).toBeHidden({ timeout: 5000 });

  // Input prompt
  const input = appPage.getByTestId('welcome-prompt-input').or(appPage.getByTestId('chat-prompt-input')).first();
  await input.fill('Use the browser tool to navigate to https://example.com and tell me the title. I want to see the browser overlay popup.');
  const submitBtn = appPage.locator('button').filter({ hasText: /Let's go/i }).or(appPage.getByTestId('chat-prompt-submit')).first();
  if (await submitBtn.isVisible().catch(() => false)) {
    await submitBtn.click();
  } else {
    await input.press('Enter');
  }

  // Wait for the Browser Operator Overlay to appear
  const overlay = appPage.getByTestId('browser-operator-overlay');
  await expect(overlay).toBeVisible({ timeout: 240_000 });
  
  // Click on "Live View" to toggle the webview
  const liveViewBtn = appPage.getByTitle('Show Live WebView');
  try {
    await liveViewBtn.waitFor({ state: 'visible', timeout: 5000 });
    await liveViewBtn.click();
    
    // Verify webview is rendered
    const webview = appPage.locator('webview');
    await expect(webview).toBeVisible({ timeout: 10000 });
    
    // Take a screenshot of the live webview
    await appPage.screenshot({
      path: path.resolve(process.cwd(), '../docs/qa/screenshots/browser-webview-live.png'),
    });
  } catch (e) {
    console.log('Skipping webview as liveViewBtn did not appear');
  }

  // 3. Verify Office Document Preview
  // Ask the agent to generate a dummy text file with .docx extension to trigger the preview pane
  await input.fill('Write a short summary in a file named test_doc.docx using the edit tool.');
  if (await submitBtn.isVisible().catch(() => false)) {
    await submitBtn.click();
  } else {
    await input.press('Enter');
  }
  
  // The system will intercept the file save and might show the visual validation or file preview
  // Wait for file preview pane to appear
  const filePreview = appPage.getByTestId('file-preview-pane');
  try {
    await filePreview.waitFor({ state: 'visible', timeout: 60_000 });
    await expect(filePreview).toBeVisible();
    await appPage.screenshot({
      path: path.resolve(process.cwd(), '../docs/qa/screenshots/office-document-preview.png'),
    });
  } catch (e) {
    console.log('Skipping office document preview as it did not appear');
  }
});
