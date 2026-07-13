import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserOperatorExecutor } from '../../src/browser-automation/browser-operator-executor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import type { BrowserOperatorSessionDraft } from '../../src/browser-automation/browser-operator-session.js';

vi.mock('@browserbasehq/stagehand', () => {
  return {
    Stagehand: class {
      init = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      page = {
        content: vi.fn().mockResolvedValue('<html><body>normal page</body></html>'),
        goto: vi.fn().mockResolvedValue(undefined),
        act: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({
          inspected: true,
          targetFound: true,
          url: 'https://example.com',
          documentTitle: 'Example',
          resolvedSelectors: ['#login'],
          contexts: [{
            text: 'Log in',
            ariaLabel: 'Log in',
            labels: '',
            neighborhood: 'Access the account sign-in screen',
            formAction: '',
            formText: '',
            role: 'button',
            inputType: 'button',
            name: 'login',
            href: '',
          }],
        }),
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockResolvedValue(undefined),
        }),
      };
    },
  };
});

describe('Browser Operator Consent Gate', () => {
  let sessionDraft: BrowserOperatorSessionDraft;
  let confirmSpy: any;
  let workspaceRoot: string;
  const executorOptions = { urlGuard: async () => ({ safe: true }) };

  beforeEach(async () => {
    vi.clearAllMocks();
    workspaceRoot = await mkdtemp(join(tmpdir(), 'browser-operator-consent-'));
    confirmSpy = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation');

    sessionDraft = {
      sessionId: 'test-session-123',
      query: 'https://example.com',
      goal: 'Test consent gate',
      mode: 'isolated',
      consent: {
        required: true,
        granted: true, // Initial session level consent is granted
        scopes: ['browser_interaction'], // required field consumed by buildBrowserOperatorHarnessBundle (scopes.join)
        reason: 'Test consent gate',
      },
      actionLog: [
        {
          id: 'step-1',
          sequence: 1,
          title: 'Navigate to site',
          tool: 'navigate',
          inputs: { url: 'https://example.com' },
          status: 'pending',
        },
        {
          id: 'step-2',
          sequence: 2,
          title: 'Click login button',
          tool: 'click',
          inputs: { ref: 42 },
          status: 'pending',
        },
      ],
      stopControl: {
        stopConditions: [],
      },
    };
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('navigates without prompting, but click prompts for confirmation', async () => {
    // Mock user approving click action
    confirmSpy.mockResolvedValue({ confirmed: true });

    const executor = new BrowserOperatorExecutor(sessionDraft, executorOptions);
    const result = await executor.execute(workspaceRoot);

    expect(result.success).toBe(true);

    // Check that requestConfirmation was called EXACTLY once (for the 'click' tool)
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith({
      operation: 'browser_write',
      filename: 'click',
      content: 'Execute browser action: click on element 42',
      forcePrompt: true,
    });
  });

  it('stops execution and throws error if operator rejects consent for click', async () => {
    // Mock user rejecting click action
    confirmSpy.mockResolvedValue({ confirmed: false });

    const executor = new BrowserOperatorExecutor(sessionDraft, executorOptions);

    await expect(executor.execute(workspaceRoot)).rejects.toThrow('BrowserOperatorConsentDenied');

    // Confirm execution status updated correctly on the second step
    expect(sessionDraft.actionLog[0]?.status).toBe('completed'); // navigate worked
    expect(sessionDraft.actionLog[1]?.status).toBe('stopped'); // click stopped
    expect(sessionDraft.actionLog[1]?.evidence).toBe('Consent denied by operator.');
  });
});
