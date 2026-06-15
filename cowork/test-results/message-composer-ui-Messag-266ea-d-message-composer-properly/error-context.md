# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: message-composer-ui.spec.ts >> MessageComposer E2E >> should render the extracted message composer properly
- Location: e2e/message-composer-ui.spec.ts:4:7

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByTestId('onboarding-skip')
    - locator resolved to <button type="button" data-testid="onboarding-skip" class="text-[11px] text-text-muted hover:text-text-primary">Skip onboarding</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is not stable
  - retrying click action
    - waiting for element to be visible, enabled and stable
  - element was detached from the DOM, retrying

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - button "New session" [ref=e6] [cursor=pointer]:
      - img [ref=e7]
      - text: New session
    - button "👤 Register a face" [ref=e9] [cursor=pointer]
    - button "Code Buddy core engine active (middlewares + sanitizer)" [ref=e10] [cursor=pointer]:
      - img [ref=e11]
    - button "Clipboard summariser" [ref=e15] [cursor=pointer]:
      - img [ref=e16]
    - button "Voice chat overlay" [ref=e21] [cursor=pointer]:
      - img [ref=e22]
    - button "Start Code Buddy server" [ref=e24] [cursor=pointer]:
      - img [ref=e25]
    - button "Show keyboard shortcuts" [ref=e27] [cursor=pointer]:
      - img [ref=e28]
    - button "Notifications" [ref=e31] [cursor=pointer]:
      - img [ref=e32]
    - generic [ref=e35]:
      - button "Minimize" [ref=e36] [cursor=pointer]:
        - img [ref=e37]
      - button "Maximize" [ref=e38] [cursor=pointer]:
        - img [ref=e39]
      - button "Close" [ref=e41] [cursor=pointer]:
        - img [ref=e42]
  - generic [ref=e45]:
    - navigation "Cowork navigation" [ref=e46]:
      - generic [ref=e47]:
        - generic [ref=e48]:
          - generic [ref=e49]: Wor
          - generic [ref=e50]:
            - button "Work surface" [ref=e51] [cursor=pointer]:
              - img [ref=e52]
            - button "New chat" [ref=e55] [cursor=pointer]:
              - img [ref=e56]
            - button "Search sessions, messages, memory, knowledge, files…" [ref=e57] [cursor=pointer]:
              - img [ref=e58]
            - button "Focus view" [ref=e61] [cursor=pointer]:
              - img [ref=e62]
            - button "Bookmarks" [ref=e68] [cursor=pointer]:
              - img [ref=e69]
        - generic [ref=e71]:
          - generic [ref=e72]: Age
          - generic [ref=e73]:
            - button "Spawn multi-agent team" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
            - button "Agent Team" [ref=e77] [cursor=pointer]:
              - img [ref=e78]
            - button "Fleet Command Center" [ref=e83] [cursor=pointer]:
              - img [ref=e84]
            - button "Fleet peer events" [ref=e87] [cursor=pointer]:
              - img [ref=e88]
            - button "Autonomy" [ref=e93] [cursor=pointer]:
              - img [ref=e94]
            - button "Paired devices" [ref=e96] [cursor=pointer]:
              - img [ref=e97]
        - generic [ref=e100]:
          - generic [ref=e101]: Aut
          - generic [ref=e102]:
            - button "Workflows" [ref=e103] [cursor=pointer]:
              - img [ref=e104]
            - button "Research / Flow launcher" [ref=e108] [cursor=pointer]:
              - img [ref=e109]
            - button "Mission Board" [ref=e117] [cursor=pointer]:
              - img [ref=e118]
            - button "Desktop Snapshot" [ref=e121] [cursor=pointer]:
              - img [ref=e122]
            - button "Schedules" [ref=e125] [cursor=pointer]:
              - img [ref=e126]
            - button "Hooks & triggers" [ref=e129] [cursor=pointer]:
              - img [ref=e130]
            - button "Custom commands" [ref=e134] [cursor=pointer]:
              - img [ref=e135]
        - generic [ref=e138]:
          - generic [ref=e139]: Com
          - generic [ref=e140]:
            - button "Buddy companion" [ref=e141] [cursor=pointer]:
              - img [ref=e142]
            - button "Delivery channels" [ref=e145] [cursor=pointer]:
              - img [ref=e146]
            - button "Mobile supervision" [ref=e152] [cursor=pointer]:
              - img [ref=e153]
        - generic [ref=e155]:
          - generic [ref=e156]: Ins
          - generic [ref=e157]:
            - button "Activity" [ref=e158] [cursor=pointer]:
              - img [ref=e159]
            - button "Session insights" [ref=e161] [cursor=pointer]:
              - img [ref=e162]
            - button "Tests & executions" [ref=e164] [cursor=pointer]:
              - img [ref=e165]
            - button "Lesson candidates — review queue" [ref=e167] [cursor=pointer]:
              - img [ref=e168]
            - button "User model — observations" [ref=e171] [cursor=pointer]:
              - img [ref=e172]
            - button "Spec backlog — review-gated stories" [ref=e182] [cursor=pointer]:
              - img [ref=e183]
            - button "Reasoning traces" [ref=e186] [cursor=pointer]:
              - img [ref=e187]
            - button "Project Memory" [ref=e189] [cursor=pointer]:
              - img [ref=e190]
        - generic [ref=e194]:
          - generic [ref=e195]: Sys
          - generic [ref=e196]:
            - button "Agent identity" [ref=e197] [cursor=pointer]:
              - img [ref=e198]
            - button "Settings" [ref=e207] [cursor=pointer]:
              - img [ref=e208]
            - button "API Settings" [ref=e211] [cursor=pointer]:
              - img [ref=e212]
            - button "MCP Connectors" [ref=e215] [cursor=pointer]:
              - img [ref=e216]
            - button "Permission rules" [ref=e218] [cursor=pointer]:
              - img [ref=e219]
            - button "📦 Skills" [ref=e221] [cursor=pointer]:
              - img [ref=e222]
            - button "Plugins" [ref=e225] [cursor=pointer]:
              - img [ref=e226]
    - generic [ref=e230]:
      - complementary [ref=e233]:
        - generic [ref=e234]:
          - generic:
            - generic:
              - img "Code Buddy Studio logo" [ref=e235]
              - generic:
                - heading "Code Buddy Studio" [level=1]
            - button "Collapse panel" [ref=e236] [cursor=pointer]:
              - img [ref=e237]
          - button "New chat" [ref=e239] [cursor=pointer]:
            - img [ref=e240]
            - generic [ref=e241]: New chat
          - button "All Sessions" [ref=e242] [cursor=pointer]:
            - img [ref=e243]
            - generic: All Sessions
            - img
        - generic [ref=e247]:
          - paragraph: No tasks yet
          - paragraph: Start a new chat to begin building, researching, or editing files.
        - generic [ref=e249]:
          - button "Settings API Not Configured":
            - img [ref=e250] [cursor=pointer]
            - generic:
              - generic: Settings
              - generic: API Not Configured
          - button "Toggle theme" [ref=e253] [cursor=pointer]:
            - img [ref=e254]
      - separator [ref=e256]
      - main [ref=e259]:
        - generic [ref=e261]:
          - generic [ref=e262]:
            - generic [ref=e263]:
              - img "Code Buddy Studio logo" [ref=e264]
              - heading "Code Buddy Studio" [level=1] [ref=e266]
            - paragraph [ref=e267]: How can I help you today?
          - paragraph [ref=e268]:
            - text: API not configured yet. Please go to Settings to set up your API provider and key.
            - button "Go to Settings" [ref=e269] [cursor=pointer]:
              - text: Go to Settings
              - img [ref=e270]
          - button "All Sessions" [ref=e274] [cursor=pointer]:
            - img [ref=e275]
            - generic [ref=e277]: All Sessions
            - img [ref=e278]
          - generic [ref=e280]:
            - button "Resume 0 sessions" [ref=e281] [cursor=pointer]:
              - img [ref=e282]
              - generic [ref=e286]: Resume 0 sessions
            - button "Create a file" [ref=e287] [cursor=pointer]:
              - img [ref=e288]
              - generic [ref=e291]: Create a file
            - button "Crunch data" [ref=e292] [cursor=pointer]:
              - img [ref=e293]
              - generic [ref=e295]: Crunch data
            - button "Organize files" [ref=e296] [cursor=pointer]:
              - img [ref=e297]
              - generic [ref=e299]: Organize files
            - button "Check emails Chrome" [ref=e300] [cursor=pointer]:
              - img [ref=e301]
              - generic [ref=e304]: Check emails
              - generic [ref=e305]: Chrome
            - button "Search & summarize papers Chrome" [ref=e306] [cursor=pointer]:
              - img [ref=e307]
              - generic [ref=e309]: Search & summarize papers
              - generic [ref=e310]: Chrome
            - button "Summarize papers to Notion Notion" [ref=e311] [cursor=pointer]:
              - img [ref=e312]
              - generic [ref=e317]: Summarize papers to Notion
              - generic [ref=e318]: Notion
          - generic [ref=e319]:
            - textbox "Describe what you'd like to do..." [ref=e320]
            - generic [ref=e321]:
              - generic [ref=e322]:
                - button "Memory Off" [ref=e323] [cursor=pointer]:
                  - img [ref=e324]
                  - generic [ref=e334]: Memory Off
                - button "default_working_dir" [ref=e335] [cursor=pointer]:
                  - img [ref=e336]
                  - generic [ref=e338]: default_working_dir
                - button "Attach Files" [ref=e339] [cursor=pointer]:
                  - img [ref=e340]
                  - generic [ref=e343]: Attach Files
              - button "Let's go" [disabled] [ref=e344]:
                - generic [ref=e345]: Let's go
                - img [ref=e346]
```

# Test source

```ts
  1  | import { expect, test } from './fixtures';
  2  | 
  3  | test.describe('MessageComposer E2E', () => {
  4  |   test('should render the extracted message composer properly', async ({
  5  |     appPage,
  6  |   }) => {
  7  |     // Dismiss onboarding if any
  8  |     await appPage.evaluate(async () => {
  9  |       await window.electronAPI?.config?.save?.({
  10 |         onboardingCompleted: true,
  11 |       } as Record<string, unknown>);
  12 |     });
  13 |     const onboarding = appPage.getByTestId('onboarding-wizard');
  14 |     if (await onboarding.isVisible().catch(() => false)) {
> 15 |       await appPage.getByTestId('onboarding-skip').click();
     |                                                    ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  16 |     }
  17 | 
  18 |     // Look for the text area inside the form
  19 |     const textarea = appPage.locator('textarea').first();
  20 |     await expect(textarea).toBeVisible();
  21 | 
  22 |     // Type a message
  23 |     await textarea.fill('Hello this is from the new MessageComposer');
  24 |     await expect(textarea).toHaveValue('Hello this is from the new MessageComposer');
  25 | 
  26 |     // Make sure we have the submit button
  27 |     const submitBtn = appPage.locator('button[type="submit"]');
  28 |     await expect(submitBtn).toBeVisible();
  29 | 
  30 |     // We can't easily mock the IPC here without the helper, 
  31 |     // but we can at least assert the UI is connected.
  32 |     // Ensure Shift+Enter does not clear the input (adds a newline)
  33 |     await textarea.press('Shift+Enter');
  34 |     await expect(textarea).toHaveValue('Hello this is from the new MessageComposer\n');
  35 |   });
  36 | 
  37 |   test('should handle multimodal drag and drop for images', async ({ appPage, electronApp, userDataDir }) => {
  38 |     // Dismiss onboarding if any
  39 |     await appPage.evaluate(async () => {
  40 |       await window.electronAPI?.config?.save?.({
  41 |         onboardingCompleted: true,
  42 |       } as Record<string, unknown>);
  43 |     });
  44 |     const onboarding = appPage.getByTestId('onboarding-wizard');
  45 |     if (await onboarding.isVisible().catch(() => false)) {
  46 |       await appPage.getByTestId('onboarding-skip').click();
  47 |     }
  48 | 
  49 |     const composerForm = appPage.locator('form').first();
  50 |     await expect(composerForm).toBeVisible();
  51 | 
  52 |     const fs = require('fs');
  53 |     const path = require('path');
  54 |     const imagePath = path.join(userDataDir, 'test-image.png');
  55 |     // Write a valid 1x1 png image
  56 |     const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  57 |     fs.writeFileSync(imagePath, Buffer.from(b64, 'base64'));
  58 | 
  59 |     await electronApp.evaluate(({ dialog }, selectedPath) => {
  60 |       const originalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
  61 |       dialog.showOpenDialog = async (...args) => {
  62 |         return {
  63 |           canceled: false,
  64 |           filePaths: [selectedPath],
  65 |           bookmarks: [],
  66 |         };
  67 |       };
  68 |     }, imagePath);
  69 | 
  70 |     const attachBtn = composerForm.locator('button[data-testid="chat-attach-files"]');
  71 |     await expect(attachBtn).toBeVisible();
  72 |     await attachBtn.click();
  73 |     
  74 |     // Wait for the file attachment chip
  75 |     const attachedFile = composerForm.locator('div:has-text("test-image.png")').last();
  76 |     await expect(attachedFile).toBeVisible();
  77 | 
  78 |     const removeBtn = attachedFile.locator('button').first();
  79 |     await expect(removeBtn).toBeVisible();
  80 |     await removeBtn.click();
  81 |     await expect(attachedFile).toBeHidden();
  82 |   });
  83 | });
  84 | 
```