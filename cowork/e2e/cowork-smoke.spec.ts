import type { ElectronApplication, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';
import {
  createAndActivateProject,
  expectSavedRule,
  injectPermissionRequest,
} from './permission-helpers';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

function writeSelectedDocxPlaceholder(filePath: string) {
  writeFileSync(filePath, 'e2e placeholder for selected DOCX attachment');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function writeReadableDocx(filePath: string, paragraphs: string[]) {
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip();
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    )
  );
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    )
  );
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        paragraphs
          .map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`)
          .join('') +
        '</w:body>' +
        '</w:document>'
    )
  );
  writeFileSync(filePath, zip.toBuffer());
}

async function mockOpenFileDialog(electronApp: ElectronApplication, selectedPath: string) {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    const originalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = async (...args) => {
      const options = args[args.length - 1] as { properties?: string[] } | undefined;
      if (options?.properties?.includes('openFile')) {
        return {
          canceled: false,
          filePaths: [selectedPath],
          bookmarks: [],
        };
      }

      return originalShowOpenDialog(...args);
    };
  }, selectedPath);
}

async function dismissOptionalModelDialogs(appPage: Page) {
  await appPage.evaluate(() => {
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            setShowEnrollmentDialog?: (show: boolean) => void;
            setShowModelInstallDialog?: (show: boolean) => void;
          };
        };
      }
    ).useAppStore?.getState();

    store?.setShowEnrollmentDialog?.(false);
    store?.setShowModelInstallDialog?.(false);
  });

  await expect(appPage.getByRole('heading', { name: /Buffalo/i })).toHaveCount(0);
}

async function dismissOnboardingIfPresent(appPage: Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 3000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
}

async function mockAuditEvalReviewHandlers(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }) => {
    const startedAt = Date.now() - 1_000;
    const run = {
      runId: 'run_e2e_eval_review',
      objective: 'Hermes e2e eval review',
      status: 'completed' as const,
      startedAt,
      endedAt: startedAt + 1_000,
      durationMs: 1_000,
      eventCount: 3,
      artifactCount: 1,
      channel: 'cowork',
      tags: ['fleet', 'eval'],
      toolCallCount: 1,
      totalCost: 0,
      totalTokens: 120,
    };
    const detail = {
      ...run,
      events: [],
      metrics: {},
      artifacts: ['document-workshop.docx'],
    };
    const generatedAt = new Date(startedAt + 1_000).toISOString();
    const golden = {
      schemaVersion: 1,
      generatedAt,
      kind: 'golden_workflow_eval_report',
      mode: 'redacted_trajectory_golden_eval',
      runId: run.runId,
      summary: { failed: 0, passed: 1, total: 1 },
      safety: { mutationDisabled: true, readOnly: true, toolReplay: false },
      trajectory: {
        artifactContentIncluded: true,
        kind: 'run_trajectory_export',
        redaction: 'secrets-redacted',
      },
      results: [
        {
          schemaVersion: 1,
          generatedAt,
          kind: 'golden_workflow_eval_result',
          passed: true,
          fixture: { id: 'doc-workshop', title: 'Document workshop' },
          results: [
            {
              assertionId: 'document-artifact',
              passed: true,
              reason: 'Found artifact.',
            },
          ],
          runId: run.runId,
        },
      ],
    };
    const policy = {
      schemaVersion: 1,
      generatedAt,
      kind: 'policy_eval_report',
      mode: 'redacted_trajectory_policy_eval',
      runId: run.runId,
      summary: { failed: 0, passed: 1, total: 1 },
      safety: { mutationDisabled: true, readOnly: true, toolReplay: false },
      trajectory: {
        artifactContentIncluded: true,
        kind: 'run_trajectory_export',
        redaction: 'secrets-redacted',
      },
      results: [
        {
          schemaVersion: 1,
          generatedAt,
          kind: 'policy_eval_result',
          passed: true,
          policy: {
            id: 'safe-profile-no-mutation',
            title: 'Safe profile cannot mutate files',
          },
          results: [
            {
              assertionId: 'no-mutation-tools',
              passed: true,
              reason: 'No forbidden tool was used.',
            },
          ],
          runId: run.runId,
        },
      ],
    };

    ipcMain.removeHandler('audit.listRuns');
    ipcMain.removeHandler('audit.getRunDetail');
    ipcMain.removeHandler('audit.buildGoldenWorkflowEvalReport');
    ipcMain.removeHandler('audit.buildPolicyEvalReport');
    ipcMain.handle('audit.listRuns', async () => [run]);
    ipcMain.handle('audit.getRunDetail', async () => detail);
    ipcMain.handle('audit.buildGoldenWorkflowEvalReport', async () => golden);
    ipcMain.handle('audit.buildPolicyEvalReport', async () => policy);
  });
}

test.beforeEach(async ({ appPage }, testInfo) => {
  if (testInfo.title !== 'shows the welcome view on a fresh profile') {
    await dismissOnboardingIfPresent(appPage);
  }
});

test('shows the welcome view on a fresh profile', async ({ appPage }) => {
  await expect(appPage.getByTestId('welcome-view')).toBeVisible();
  await expect(appPage.getByTestId('welcome-api-settings-cta')).toBeVisible();
  await expect(appPage.getByTestId('onboarding-wizard')).toBeVisible();
  await expect(appPage.getByTestId('onboarding-path-quickstart')).toContainText('Quick start');

  await appPage.getByTestId('onboarding-next').click();
  await expect(appPage.getByTestId('onboarding-brain-options')).toBeVisible();
  await expect(appPage.getByTestId('onboarding-brain-codebuddy')).toContainText('Code Buddy brain');

  await appPage.getByTestId('onboarding-next').click();
  await expect(appPage.getByTestId('onboarding-backend-mode')).toContainText('Local backend first');

  await appPage.getByTestId('onboarding-next').click();
  await expect(appPage.getByTestId('onboarding-companion-permissions')).toContainText(
    'Camera vision'
  );

  await appPage.getByTestId('onboarding-next').click();
  await expect(appPage.getByTestId('onboarding-ready-actions')).toContainText('First chat');
});

test('fills the Word-workshop prompt from a selected DOCX on the welcome view', async ({
  electronApp,
  appPage,
  userDataDir,
}) => {
  const docPath = path.join(userDataDir, 'Questions - Impacts.docx');

  writeSelectedDocxPlaceholder(docPath);
  await mockOpenFileDialog(electronApp, docPath);
  await dismissOnboardingIfPresent(appPage);
  await dismissOptionalModelDialogs(appPage);

  await expect(appPage.getByTestId('welcome-view')).toBeVisible();
  await appPage.getByTestId('welcome-attach-files').click();
  await expect(appPage.getByText('Questions - Impacts.docx')).toBeVisible();

  const action = appPage.getByTestId('welcome-document-workshop-action');
  await expect(action).toBeVisible();
  await action.click();

  const promptInput = appPage.getByTestId('welcome-prompt-input');
  await expect(promptInput).toHaveValue(/Analyse les documents attaches/);
  await expect(promptInput).toHaveValue(/Questions - Impacts\.docx/);
  await expect(promptInput).toHaveValue(/Genere ensuite un document DOCX technique complet/);
});

test('fills the Word-workshop prompt from a selected PDF on the welcome view', async ({
  electronApp,
  appPage,
  userDataDir,
}) => {
  const pdfPath = path.join(userDataDir, 'Analyse fonctionnelle.pdf');

  writeFileSync(pdfPath, '%PDF-1.4 e2e placeholder for selected PDF attachment');
  await mockOpenFileDialog(electronApp, pdfPath);
  await dismissOnboardingIfPresent(appPage);
  await dismissOptionalModelDialogs(appPage);

  await expect(appPage.getByTestId('welcome-view')).toBeVisible();
  await appPage.getByTestId('welcome-attach-files').click();
  await expect(appPage.getByText('Analyse fonctionnelle.pdf')).toBeVisible();

  const action = appPage.getByTestId('welcome-document-workshop-action');
  await expect(action).toBeVisible();
  await action.click();

  const promptInput = appPage.getByTestId('welcome-prompt-input');
  await expect(promptInput).toHaveValue(/Analyse les documents attaches/);
  await expect(promptInput).toHaveValue(/Analyse fonctionnelle\.pdf/);
  await expect(promptInput).toHaveValue(/captures ecran/);
});

test('fills the Word-workshop prompt from a selected DOCX in an active chat', async ({
  electronApp,
  appPage,
  userDataDir,
}) => {
  const now = Date.now();
  const sessionId = `e2e-docx-session-${now}`;
  const docPath = path.join(userDataDir, 'Questions - Impacts.docx');

  writeSelectedDocxPlaceholder(docPath);
  await mockOpenFileDialog(electronApp, docPath);
  await dismissOnboardingIfPresent(appPage);
  await dismissOptionalModelDialogs(appPage);

  await appPage.evaluate(
    ({ id, createdAt }) => {
      const store = (
        window as unknown as {
          useAppStore?: {
            getState: () => {
              addSession: (session: unknown) => void;
              setActiveSession: (sessionId: string) => void;
            };
          };
        }
      ).useAppStore?.getState();

      if (!store) {
        throw new Error('useAppStore missing');
      }

      store.addSession({
        id,
        title: 'Atelier Word e2e',
        status: 'idle',
        cwd: 'D:\\Atelier',
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        model: 'e2e-model',
        createdAt,
        updatedAt: createdAt,
      });
      store.setActiveSession(id);
    },
    { id: sessionId, createdAt: now }
  );

  await expect(appPage.getByTestId('chat-attach-files')).toBeVisible();
  await appPage.getByTestId('chat-attach-files').click();
  await expect(appPage.getByText('Questions - Impacts.docx')).toBeVisible();

  const action = appPage.getByTestId('chat-document-workshop-action');
  await expect(action).toBeVisible();
  await action.click();

  const promptInput = appPage.getByTestId('chat-prompt-input');
  await expect(promptInput).toHaveValue(/Analyse les documents attaches/);
  await expect(promptInput).toHaveValue(/Questions - Impacts\.docx/);
  await expect(promptInput).toHaveValue(/Questions extraites/);
});

test('opens context artifacts in the file preview pane', async ({ appPage, userDataDir }) => {
  const now = Date.now();
  const sessionId = `e2e-artifact-preview-session-${now}`;
  const artifactPath = path.join(userDataDir, 'artifact-preview.txt');
  writeFileSync(artifactPath, 'Artifact preview smoke from ContextPanel.');
  await dismissOnboardingIfPresent(appPage);
  await dismissOptionalModelDialogs(appPage);
  await appPage.setViewportSize({ width: 1440, height: 900 });

  await appPage.evaluate(
    ({ id, createdAt, cwd, filePath }) => {
      const store = (
        window as unknown as {
          useAppStore?: {
            getState: () => {
              addSession: (session: unknown) => void;
              setActiveSession: (sessionId: string) => void;
              setContextPanelCollapsed: (collapsed: boolean) => void;
              setTraceSteps: (sessionId: string, steps: unknown[]) => void;
            };
          };
        }
      ).useAppStore?.getState();

      if (!store) {
        throw new Error('useAppStore missing');
      }

      store.addSession({
        id,
        title: 'Artifact preview e2e',
        status: 'idle',
        cwd,
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        model: 'e2e-model',
        createdAt,
        updatedAt: createdAt,
      });
      store.setActiveSession(id);
      store.setContextPanelCollapsed(false);
      store.setTraceSteps(id, [
        {
          id: 'write-artifact-preview',
          type: 'tool_call',
          status: 'completed',
          title: 'Write',
          toolName: 'Write',
          toolOutput: `File created successfully at: ${filePath}`,
          timestamp: createdAt,
        },
      ]);
    },
    { id: sessionId, createdAt: now, cwd: userDataDir, filePath: artifactPath }
  );

  await expect(appPage.getByTestId('context-artifact-row-0')).toContainText('artifact-preview.txt');
  await appPage.getByTestId('context-artifact-row-0').click();

  await expect(appPage.getByTestId('file-preview-pane')).toBeVisible();
  await expect(appPage.getByText('Artifact preview smoke from ContextPanel.')).toBeVisible();
});

test('renders the complete Word-workshop progress rail from session evidence', async ({
  appPage,
  userDataDir,
}) => {
  const now = Date.now();
  const sessionId = `e2e-word-workshop-progress-${now}`;
  const sourcePath = path.join(userDataDir, 'Questions - Impacts.docx');
  const imagePath = path.join(userDataDir, 'Questions - Impacts-images', 'image1.png');
  const docxPath = path.join(userDataDir, 'Questions - Impacts-livrable.docx');

  writeSelectedDocxPlaceholder(sourcePath);
  await writeReadableDocx(docxPath, [
    'Livrable Atelier Word valide.',
    'Question 1: Impact confirme.',
  ]);
  await dismissOptionalModelDialogs(appPage);
  await appPage.setViewportSize({ width: 1440, height: 900 });

  await appPage.evaluate(
    ({ id, createdAt, cwd, source, image, docx }) => {
      const store = (
        window as unknown as {
          useAppStore?: {
            getState: () => {
              addSession: (session: unknown) => void;
              setActiveSession: (sessionId: string) => void;
              setContextPanelCollapsed: (collapsed: boolean) => void;
              setMessages: (sessionId: string, messages: unknown[]) => void;
              setTraceSteps: (sessionId: string, steps: unknown[]) => void;
            };
          };
        }
      ).useAppStore?.getState();

      if (!store) {
        throw new Error('useAppStore missing');
      }

      store.addSession({
        id,
        title: 'Atelier Word progress e2e',
        status: 'idle',
        cwd,
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        model: 'e2e-model',
        createdAt,
        updatedAt: createdAt,
      });
      store.setActiveSession(id);
      store.setContextPanelCollapsed(false);
      store.setMessages(id, [
        {
          id: 'user-docx',
          sessionId: id,
          role: 'user',
          timestamp: createdAt,
          content: [
            {
              type: 'file_attachment',
              filename: 'Questions - Impacts.docx',
              relativePath: source,
              size: 4096,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
          ],
        },
        {
          id: 'assistant-progress',
          sessionId: id,
          role: 'assistant',
          timestamp: createdAt + 1,
          content: [
            {
              type: 'text',
              text:
                'Contexte fonctionnel capture\n' +
                'Questions extraites\n' +
                'OCR termine\n' +
                'Reponses preparees',
            },
          ],
        },
      ]);
      store.setTraceSteps(id, [
        {
          id: 'read',
          type: 'tool_call',
          status: 'completed',
          title: 'Document read',
          toolName: 'document',
          toolInput: { operation: 'read' },
          toolOutput: `Document read: ${source}`,
          timestamp: createdAt,
        },
        {
          id: 'images',
          type: 'tool_call',
          status: 'completed',
          title: 'Extract images',
          toolName: 'document',
          toolInput: { operation: 'extract_images' },
          toolOutput: `Extracted 1 embedded image(s)\n- ${image}`,
          timestamp: createdAt + 1,
        },
        {
          id: 'ocr',
          type: 'tool_call',
          status: 'completed',
          title: 'OCR screenshots',
          toolName: 'ocr_extract',
          toolOutput: 'OCR termine pour image1.png',
          timestamp: createdAt + 2,
        },
        {
          id: 'docx',
          type: 'tool_call',
          status: 'completed',
          title: 'Generate DOCX',
          toolName: 'generate_document',
          toolOutput: `Created DOCX: ${docx}`,
          timestamp: createdAt + 3,
        },
      ]);
    },
    {
      id: sessionId,
      createdAt: now,
      cwd: userDataDir,
      source: sourcePath,
      image: imagePath,
      docx: docxPath,
    }
  );

  await expect(appPage.getByTestId('context-document-workshop')).toBeVisible();
  await expect(appPage.getByTestId('context-document-workshop-progress')).toHaveText('9/9');
  await expect(appPage.getByTestId('context-document-workshop-step-source')).toBeVisible();
  await expect(appPage.getByTestId('context-document-workshop-step-answers')).toBeVisible();
  await expect(appPage.getByTestId('context-document-workshop-step-deliverable')).toBeVisible();
  await expect(appPage.getByTestId('context-artifact-row-0')).toContainText(
    'Questions - Impacts-livrable.docx'
  );
  await dismissOnboardingIfPresent(appPage);
  await appPage.getByTestId('context-artifact-row-0').click();
  await expect(appPage.getByTestId('file-preview-pane')).toBeVisible();
  await expect(appPage.getByText('Livrable Atelier Word valide.')).toBeVisible();
  await expect(appPage.getByText('Question 1: Impact confirme.')).toBeVisible();
});

test('opens Settings and renders the A2A registry tab', async ({ appPage }) => {
  await appPage.getByTestId('sidebar-settings-button').click();

  await expect(appPage.getByTestId('settings-panel')).toBeVisible({ timeout: 20000 });
  await dismissOnboardingIfPresent(appPage);
  await appPage.getByTestId('settings-tab-a2a').click();
  await expect(appPage.getByTestId('settings-a2a-agents')).toBeVisible();
  await expect(appPage.getByTestId('a2a-add-url-input')).toBeVisible();
  await expect(appPage.getByTestId('a2a-empty-state')).toBeVisible();
});

test('reviews Audit Log golden and policy eval summaries in-place', async ({
  electronApp,
  appPage,
}) => {
  await mockAuditEvalReviewHandlers(electronApp);
  await dismissOptionalModelDialogs(appPage);

  await appPage.getByTestId('sidebar-settings-button').click();
  await expect(appPage.getByTestId('settings-panel')).toBeVisible({ timeout: 20000 });
  await appPage.getByTestId('settings-tab-logs').click();
  await appPage.getByRole('button', { name: 'Audit log' }).click();

  await expect(appPage.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(appPage.getByText('Hermes e2e eval review')).toBeVisible();
  await appPage.getByRole('button', { name: /Hermes e2e eval review/ }).click();

  await expect(appPage.getByRole('button', { name: /Review evals/ })).toBeVisible();
  await appPage.getByRole('button', { name: /Review evals/ }).click();

  const evalPanel = appPage.getByLabel('Evaluation report summary');
  await expect(evalPanel).toBeVisible();
  await expect(evalPanel).toContainText(/Golden workflow.*run_e2e_eval_review/);
  await expect(evalPanel).toContainText(/Policy guardrails.*run_e2e_eval_review/);
  await expect(evalPanel).toContainText('Document workshop');
  await expect(evalPanel).toContainText('Safe profile cannot mutate files');
  await expect(evalPanel).toContainText('read-only');
  await expect(evalPanel).toContainText('no tool replay');
  await expect(appPage.getByRole('button', { name: /Evals reviewed/ })).toBeVisible();
});

test('switches the renderer language to French from Settings', async ({ appPage }) => {
  await appPage.getByTestId('sidebar-settings-button').click();
  await expect(appPage.getByTestId('settings-panel')).toBeVisible({ timeout: 20000 });
  await dismissOnboardingIfPresent(appPage);
  await appPage.getByTestId('settings-tab-general').click();
  await appPage.getByRole('button', { name: 'Français' }).click();

  await expect(appPage.getByRole('heading', { name: 'Apparence' })).toBeVisible();
  await expect(appPage.getByRole('heading', { name: 'Langue' })).toBeVisible();
  await expect
    .poll(() => appPage.evaluate(() => window.localStorage.getItem('i18nextLng')))
    .toBe('fr');
});

test('opens the global search dialog from the keyboard shortcut', async ({ appPage }) => {
  await appPage.keyboard.press(`${modKey}+Shift+K`);

  await expect(appPage.getByTestId('global-search-dialog')).toBeVisible();
  await expect(appPage.getByTestId('global-search-input')).toBeFocused();
  await expect(appPage.getByTestId('global-search-empty-state')).toBeVisible();
});

test('opens the reasoning trace viewer from the keyboard shortcut', async ({ appPage }) => {
  await appPage.keyboard.press(`${modKey}+Shift+R`);

  await expect(appPage.getByTestId('reasoning-trace-viewer')).toBeVisible();
  await expect(appPage.getByTestId('reasoning-empty-state')).toBeVisible();
});

test('opens the session insights panel from the titlebar', async ({ appPage }) => {
  await appPage.getByTestId('session-insights-button').click();

  await expect(appPage.getByTestId('session-insights-panel')).toBeVisible();
  await expect(appPage.getByTestId('session-insights-empty')).toBeVisible();
});

test('opens the session resume dialog from the welcome view', async ({ appPage }) => {
  await appPage.getByTestId('welcome-resume-session').click();

  await expect(appPage.getByTestId('session-resume-dialog')).toBeVisible();
  await expect(appPage.getByTestId('session-resume-empty')).toBeVisible();
});

test('opens the focus view from the titlebar', async ({ appPage }) => {
  await appPage.getByTestId('focus-view-button').click();

  await expect(appPage.getByTestId('focus-view')).toBeVisible();
  await expect(appPage.getByTestId('focus-view-empty')).toBeVisible();
});

test('denies a permission request and opens permission rules prefilled for review', async ({
  appPage,
}) => {
  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-tool-use',
    toolName: 'mcp__Chrome__navigate_page',
    input: { url: 'https://example.com/settings' },
    action: 'chrome.navigate',
    details: {
      url: 'https://example.com/settings',
      app: 'Chrome',
      target: 'Settings page',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await dismissOnboardingIfPresent(appPage);
  await appPage.getByTestId('permission-deny-review-button').click();

  await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  await expect(appPage.getByTestId('settings-tab-rules')).toBeVisible();
  await expect(appPage.getByTestId('settings-permission-rules')).toBeVisible();
  await expect(appPage.getByTestId('settings-rules-test-tool-input')).toHaveValue(
    'mcp__Chrome__navigate_page'
  );
  await expect(appPage.getByTestId('settings-rules-test-arg-input')).toHaveValue(
    'https://example.com/settings'
  );
  await expect(appPage.getByTestId('settings-rules-deny-input')).toHaveValue(
    'mcp__Chrome__navigate_page(https://example.com/*)'
  );
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
});

test('allows a permission request and opens permission rules with the edited allow draft', async ({
  appPage,
}) => {
  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-tool-use-allow',
    toolName: 'mcp__Chrome__navigate_page',
    input: { url: 'https://example.com/account/profile' },
    action: 'chrome.navigate',
    details: {
      url: 'https://example.com/account/profile',
      app: 'Chrome',
      target: 'Profile page',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage
    .getByTestId('permission-scoped-rule-draft-input')
    .fill('mcp__Chrome__navigate_page(https://example.com/account/*)');
  await appPage.getByTestId('permission-allow-review-button').click();

  await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  await expect(appPage.getByTestId('settings-permission-rules')).toBeVisible();
  await expect(appPage.getByTestId('settings-rules-test-tool-input')).toHaveValue(
    'mcp__Chrome__navigate_page'
  );
  await expect(appPage.getByTestId('settings-rules-test-arg-input')).toHaveValue(
    'https://example.com/account/profile'
  );
  await expect(appPage.getByTestId('settings-rules-allow-input')).toHaveValue(
    'mcp__Chrome__navigate_page(https://example.com/account/*)'
  );
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
});

test('saves a deny target rule and the next matching permission is pre-blocked by that rule', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace',
    'E2E Rules Save'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-rule-1',
    toolName: 'mcp__Chrome__navigate_page',
    input: { url: 'https://example.com/admin/panel' },
    projectId,
    action: 'chrome.navigate',
    details: {
      url: 'https://example.com/admin/panel',
      app: 'Chrome',
      target: 'Admin panel',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-always-deny-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'mcp__Chrome__navigate_page(https://example.com/*)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-rule-2',
    toolName: 'mcp__Chrome__navigate_page',
    input: { url: 'https://example.com/admin/users' },
    projectId,
    action: 'chrome.navigate',
    details: {
      url: 'https://example.com/admin/users',
      app: 'Chrome',
      target: 'Admin users',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved deny rule would block this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-covered-note')).toContainText(
    'This request is already covered by a saved deny rule.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'mcp__Chrome__navigate_page(https://example.com/*)'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
});

test('saves an allow target rule and the next matching permission is pre-approved by that rule', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace-allow',
    'E2E Rules Save Allow'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-allow-rule-1',
    toolName: 'mcp__Chrome__navigate_page',
    input: { url: 'https://example.com/docs/getting-started' },
    projectId,
    action: 'chrome.navigate',
    details: {
      url: 'https://example.com/docs/getting-started',
      app: 'Chrome',
      target: 'Docs getting started',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-always-allow-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'mcp__Chrome__navigate_page(https://example.com/*)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-allow-rule-2',
    toolName: 'mcp__Chrome__navigate_page',
    input: { url: 'https://example.com/docs/reference' },
    projectId,
    action: 'chrome.navigate',
    details: {
      url: 'https://example.com/docs/reference',
      app: 'Chrome',
      target: 'Docs reference',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved allow rule would auto-approve this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-covered-note')).toContainText(
    'This request is already covered by a saved allow rule.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'mcp__Chrome__navigate_page(https://example.com/*)'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
});

test('saves a target-based gui deny rule and matches the next non-url permission by target', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace-target',
    'E2E Rules Save Target'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-target-rule-1',
    toolName: 'mcp__Computer__click',
    input: { target: 'Save button' },
    projectId,
    action: 'computer.click',
    details: {
      app: 'Desktop App',
      target: 'Save button',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-always-deny-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'mcp__Computer__click(Save button*)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-target-rule-2',
    toolName: 'mcp__Computer__click',
    input: { target: 'Save button primary' },
    projectId,
    action: 'computer.click',
    details: {
      app: 'Desktop App',
      target: 'Save button primary',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved deny rule would block this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-covered-note')).toContainText(
    'This request is already covered by a saved deny rule.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'mcp__Computer__click(Save button*)'
  );
  await expect(appPage.getByTestId('permission-covered-suggestion-note')).toContainText(
    'mcp__Computer__click(Save button primary*)'
  );
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific deny rule'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
});

test('reviews a more specific deny rule from a covered target-based permission', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-review-workspace-target-deny',
    'E2E Rules Review Target Deny'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-review-target-deny-1',
    toolName: 'mcp__Computer__click',
    input: { target: 'Save button' },
    projectId,
    action: 'computer.click',
    details: {
      app: 'Desktop App',
      target: 'Save button',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-always-deny-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'mcp__Computer__click(Save button*)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-review-target-deny-2',
    toolName: 'mcp__Computer__click',
    input: { target: 'Save button primary' },
    projectId,
    action: 'computer.click',
    details: {
      app: 'Desktop App',
      target: 'Save button primary',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific deny rule'
  );
  await appPage.getByTestId('permission-review-covered-rule-button').click();

  await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  await expect(appPage.getByTestId('settings-permission-rules')).toBeVisible();
  await expect(appPage.getByTestId('settings-rules-test-tool-input')).toHaveValue(
    'mcp__Computer__click'
  );
  await expect(appPage.getByTestId('settings-rules-test-arg-input')).toHaveValue(
    'Save button primary'
  );
  await expect(appPage.getByTestId('settings-rules-deny-input')).toHaveValue(
    'mcp__Computer__click(Save button primary*)'
  );
});

test('saves a target-based gui allow rule and matches the next non-url permission by target', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace-target-allow',
    'E2E Rules Save Target Allow'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-target-allow-rule-1',
    toolName: 'mcp__Computer__click',
    input: { target: 'Confirm button' },
    projectId,
    action: 'computer.click',
    details: {
      app: 'Desktop App',
      target: 'Confirm button',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-always-allow-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'mcp__Computer__click(Confirm button*)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-target-allow-rule-2',
    toolName: 'mcp__Computer__click',
    input: { target: 'Confirm button primary' },
    projectId,
    action: 'computer.click',
    details: {
      app: 'Desktop App',
      target: 'Confirm button primary',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved allow rule would auto-approve this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-covered-note')).toContainText(
    'This request is already covered by a saved allow rule.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'mcp__Computer__click(Confirm button*)'
  );
  await expect(appPage.getByTestId('permission-covered-suggestion-note')).toContainText(
    'mcp__Computer__click(Confirm button primary*)'
  );
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific allow rule'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
});

test('saves a bash deny rule and the next matching command is pre-blocked', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace-bash-deny',
    'E2E Rules Save Bash Deny'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-bash-deny-1',
    toolName: 'Bash',
    input: { command: 'npm test && npm run lint' },
    projectId,
    action: 'bash.exec',
    details: {
      command: 'npm test && npm run lint',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-scoped-rule-draft-input')).toHaveValue(
    'Bash(npm *)'
  );
  await appPage.getByTestId('permission-always-deny-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'Bash(npm *)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-bash-deny-2',
    toolName: 'Bash',
    input: { command: 'npm run build' },
    projectId,
    action: 'bash.exec',
    details: {
      command: 'npm run build',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved deny rule would block this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-covered-note')).toContainText(
    'This request is already covered by a saved deny rule.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'Bash(npm *)'
  );
  await expect(appPage.getByTestId('permission-covered-suggestion-note')).toContainText(
    'Bash(npm run build)'
  );
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific deny rule'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
});

test('saves a bash allow rule and the next matching command is pre-approved', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace-bash-allow',
    'E2E Rules Save Bash Allow'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-bash-allow-1',
    toolName: 'Bash',
    input: { command: 'git status && git diff' },
    projectId,
    action: 'bash.exec',
    details: {
      command: 'git status && git diff',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-scoped-rule-draft-input')).toHaveValue(
    'Bash(git *)'
  );
  await appPage.getByTestId('permission-always-allow-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'Bash(git *)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-bash-allow-2',
    toolName: 'Bash',
    input: { command: 'git log --oneline' },
    projectId,
    action: 'bash.exec',
    details: {
      command: 'git log --oneline',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved allow rule would auto-approve this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-covered-note')).toContainText(
    'This request is already covered by a saved allow rule.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'Bash(git *)'
  );
  await expect(appPage.getByTestId('permission-covered-suggestion-note')).toContainText(
    'Bash(git log --oneline)'
  );
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific allow rule'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
});

test('reviews a more specific bash deny rule from a covered command', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-review-workspace-bash-deny',
    'E2E Rules Review Bash Deny'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-review-bash-deny-1',
    toolName: 'Bash',
    input: { command: 'npm test && npm run lint' },
    projectId,
    action: 'bash.exec',
    details: {
      command: 'npm test && npm run lint',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-always-deny-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'Bash(npm *)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-review-bash-deny-2',
    toolName: 'Bash',
    input: { command: 'npm run build' },
    projectId,
    action: 'bash.exec',
    details: {
      command: 'npm run build',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific deny rule'
  );
  await appPage.getByTestId('permission-review-covered-rule-button').click();

  await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  await expect(appPage.getByTestId('settings-permission-rules')).toBeVisible();
  await expect(appPage.getByTestId('settings-rules-test-tool-input')).toHaveValue('Bash');
  await expect(appPage.getByTestId('settings-rules-test-arg-input')).toHaveValue('npm run build');
  await expect(appPage.getByTestId('settings-rules-deny-input')).toHaveValue('Bash(npm run build)');
});

test('reviews a more specific bash allow rule from a covered command', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-review-workspace-bash-allow',
    'E2E Rules Review Bash Allow'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-review-bash-allow-1',
    toolName: 'Bash',
    input: { command: 'git status && git diff' },
    projectId,
    action: 'bash.exec',
    details: {
      command: 'git status && git diff',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-always-allow-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'Bash(git *)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-review-bash-allow-2',
    toolName: 'Bash',
    input: { command: 'git log --oneline' },
    projectId,
    action: 'bash.exec',
    details: {
      command: 'git log --oneline',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific allow rule'
  );
  await appPage.getByTestId('permission-review-covered-rule-button').click();

  await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  await expect(appPage.getByTestId('settings-permission-rules')).toBeVisible();
  await expect(appPage.getByTestId('settings-rules-test-tool-input')).toHaveValue('Bash');
  await expect(appPage.getByTestId('settings-rules-test-arg-input')).toHaveValue(
    'git log --oneline'
  );
  await expect(appPage.getByTestId('settings-rules-allow-input')).toHaveValue(
    'Bash(git log --oneline)'
  );
});

test('saves an edit deny rule and the next matching file permission is pre-blocked', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace-edit-deny',
    'E2E Rules Save Edit Deny'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-edit-deny-1',
    toolName: 'Edit',
    input: { file_path: 'src\\components\\Button.tsx' },
    projectId,
    action: 'edit.file',
    details: {
      file_path: 'src\\components\\Button.tsx',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-scoped-rule-draft-input')).toHaveValue(
    'Edit(src/components/Button.tsx)'
  );
  await appPage.getByTestId('permission-always-deny-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'Edit(src/components/Button.tsx)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-edit-deny-2',
    toolName: 'Edit',
    input: { file_path: 'src\\components\\Button.tsx' },
    projectId,
    action: 'edit.file',
    details: {
      file_path: 'src\\components\\Button.tsx',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved deny rule would block this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'Edit(src/components/Button.tsx)'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
});

test('saves a write allow rule and the next matching file permission is pre-approved', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace-write-allow',
    'E2E Rules Save Write Allow'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-write-allow-1',
    toolName: 'Write',
    input: { file_path: 'docs\\guide.md' },
    projectId,
    action: 'write.file',
    details: {
      file_path: 'docs\\guide.md',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-scoped-rule-draft-input')).toHaveValue(
    'Write(docs/guide.md)'
  );
  await appPage.getByTestId('permission-always-allow-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'Write(docs/guide.md)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-write-allow-2',
    toolName: 'Write',
    input: { file_path: 'docs\\guide.md' },
    projectId,
    action: 'write.file',
    details: {
      file_path: 'docs\\guide.md',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved allow rule would auto-approve this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'Write(docs/guide.md)'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
});

test('uses a folder-scoped file rule so a sibling file in the same directory also matches', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-save-workspace-folder-allow',
    'E2E Rules Save Folder Allow'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-folder-allow-1',
    toolName: 'Write',
    input: { file_path: 'docs\\guide.md' },
    projectId,
    action: 'write.file',
    details: {
      file_path: 'docs\\guide.md',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-scoped-rule-draft-input')).toHaveValue(
    'Write(docs/guide.md)'
  );
  await appPage.getByTestId('permission-use-folder-rule-button').click();
  await expect(appPage.getByTestId('permission-scoped-rule-draft-input')).toHaveValue(
    'Write(docs/*)'
  );
  await appPage.getByTestId('permission-always-allow-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'Write(docs/*)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-save-folder-allow-2',
    toolName: 'Write',
    input: { file_path: 'docs\\reference.md' },
    projectId,
    action: 'write.file',
    details: {
      file_path: 'docs\\reference.md',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-rule-preview')).toContainText(
    'A saved allow rule would auto-approve this request.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-covered-note')).toContainText(
    'This request is already covered by a saved allow rule.'
  );
  await expect(appPage.getByTestId('permission-rule-preview-matched-rule')).toContainText(
    'Write(docs/*)'
  );
  await expect(appPage.getByTestId('permission-covered-suggestion-note')).toContainText(
    'Write(docs/reference.md)'
  );
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific allow rule'
  );
  await expect(appPage.getByTestId('permission-allow-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-deny-review-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-allow-target-button')).toHaveCount(0);
  await expect(appPage.getByTestId('permission-always-deny-target-button')).toHaveCount(0);
});

test('reviews a more specific allow rule from a covered folder-scoped file permission', async ({
  appPage,
  userDataDir,
}) => {
  const { projectId, settingsPath } = await createAndActivateProject(
    appPage,
    userDataDir,
    'rules-review-workspace-folder-allow',
    'E2E Rules Review Folder Allow'
  );

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-review-folder-allow-1',
    toolName: 'Write',
    input: { file_path: 'docs\\guide.md' },
    projectId,
    action: 'write.file',
    details: {
      file_path: 'docs\\guide.md',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await appPage.getByTestId('permission-use-folder-rule-button').click();
  await appPage.getByTestId('permission-always-allow-target-button').click();
  await expect(appPage.getByTestId('permission-dialog')).toBeHidden();

  await expectSavedRule(settingsPath, 'Write(docs/*)');

  await injectPermissionRequest(appPage, {
    toolUseId: 'e2e-permission-review-folder-allow-2',
    toolName: 'Write',
    input: { file_path: 'docs\\reference.md' },
    projectId,
    action: 'write.file',
    details: {
      file_path: 'docs\\reference.md',
    },
  });

  await expect(appPage.getByTestId('permission-dialog')).toBeVisible();
  await expect(appPage.getByTestId('permission-review-covered-rule-button')).toContainText(
    'Review a more specific allow rule'
  );
  await appPage.getByTestId('permission-review-covered-rule-button').click();

  await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  await expect(appPage.getByTestId('settings-permission-rules')).toBeVisible();
  await expect(appPage.getByTestId('settings-rules-test-tool-input')).toHaveValue('Write');
  await expect(appPage.getByTestId('settings-rules-test-arg-input')).toHaveValue(
    'docs\\reference.md'
  );
  await expect(appPage.getByTestId('settings-rules-allow-input')).toHaveValue(
    'Write(docs/reference.md)'
  );
});
