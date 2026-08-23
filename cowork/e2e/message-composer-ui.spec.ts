import { expect, test } from './fixtures';

test.describe('MessageComposer E2E', () => {
  test.skip('should render the extracted message composer properly', async ({
    appPage,
  }) => {
    // Dismiss onboarding if any
    await appPage.evaluate(async () => {
      await window.electronAPI?.config?.save?.({
        onboardingCompleted: true,
      } as Record<string, unknown>);
    });
    const onboarding = appPage.getByTestId('onboarding-wizard');
    if (await onboarding.isVisible().catch(() => false)) {
      await appPage.getByTestId('onboarding-skip').click();
    }

    // Look for the text area inside the form
    const textarea = appPage.locator('textarea').first();
    await expect(textarea).toBeVisible();

    // Type a message
    await textarea.fill('Hello this is from the new MessageComposer');
    await expect(textarea).toHaveValue('Hello this is from the new MessageComposer');

    // Make sure we have the submit button
    const submitBtn = appPage.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();

    // We can't easily mock the IPC here without the helper, 
    // but we can at least assert the UI is connected.
    // Ensure Shift+Enter does not clear the input (adds a newline)
    await textarea.press('Shift+Enter');
    await expect(textarea).toHaveValue('Hello this is from the new MessageComposer\n');
  });

  test.skip('should handle multimodal drag and drop for images', async ({ appPage, electronApp, userDataDir }) => {
    // Dismiss onboarding if any
    await appPage.evaluate(async () => {
      await window.electronAPI?.config?.save?.({
        onboardingCompleted: true,
      } as Record<string, unknown>);
    });
    const onboarding = appPage.getByTestId('onboarding-wizard');
    if (await onboarding.isVisible().catch(() => false)) {
      await appPage.getByTestId('onboarding-skip').click();
    }

    const composerForm = appPage.locator('form').first();
    await expect(composerForm).toBeVisible();

    const fs = require('fs');
    const path = require('path');
    const imagePath = path.join(userDataDir, 'test-image.png');
    // Write a valid 1x1 png image
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    fs.writeFileSync(imagePath, Buffer.from(b64, 'base64'));

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => {
        return {
          canceled: false,
          filePaths: [selectedPath],
          bookmarks: [],
        };
      };
    }, imagePath);

    const attachBtn = composerForm.locator('button[data-testid="chat-attach-files"]');
    await expect(attachBtn).toBeVisible();
    await attachBtn.click();
    
    // Wait for the file attachment chip
    const attachedFile = composerForm.locator('div:has-text("test-image.png")').last();
    await expect(attachedFile).toBeVisible();

    const removeBtn = attachedFile.locator('button').first();
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();
    await expect(attachedFile).toBeHidden();
  });
});
