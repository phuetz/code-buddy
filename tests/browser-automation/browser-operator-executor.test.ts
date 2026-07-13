import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  BrowserOperatorExecutor,
  BROWSER_OPERATOR_PROFILE_LOCK,
} from '../../src/browser-automation/browser-operator-executor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import type { BrowserOperatorSessionDraft } from '../../src/browser-automation/browser-operator-session.js';

let pageContentMock = '<html><body>normal page</body></html>';
let mockGoto = vi.fn();
let mockAct = vi.fn();
let mockScreenshot = vi.fn();
let mockClose = vi.fn();
let mockInit = vi.fn();
let mockEvaluate = vi.fn();
let mockWheel = vi.fn();
let mockPress = vi.fn();
let mockFill = vi.fn();
let mockClick = vi.fn();
let mockObserve = vi.fn();
let mockStagehandOptions: Record<string, unknown> | undefined;

vi.mock('@browserbasehq/stagehand', () => {
  return {
    Stagehand: class {
      constructor(options: Record<string, unknown>) {
        mockStagehandOptions = options;
      }
      init = mockInit;
      close = mockClose;
      page = {
        content: vi.fn().mockImplementation(() => Promise.resolve(pageContentMock)),
        goto: vi.fn().mockImplementation((...args) => mockGoto(...args)),
        act: vi.fn().mockImplementation((...args) => mockAct(...args)),
        screenshot: vi.fn().mockImplementation((...args) => mockScreenshot(...args)),
        evaluate: vi.fn().mockImplementation((...args) => mockEvaluate(...args)),
        observe: vi.fn().mockImplementation((...args) => mockObserve(...args)),
        mouse: { wheel: vi.fn().mockImplementation((...args) => mockWheel(...args)) },
        keyboard: { press: vi.fn().mockImplementation((...args) => mockPress(...args)) },
        locator: vi.fn().mockImplementation(() => ({
          fill: vi.fn().mockImplementation((...args) => mockFill(...args)),
          click: vi.fn().mockImplementation((...args) => mockClick(...args)),
        })),
        title: vi.fn().mockResolvedValue('Example title'),
        url: vi.fn().mockReturnValue('https://example.com/current'),
      };
    },
  };
});

describe('BrowserOperatorExecutor', () => {
  let tempDir: string;
  let sampleDraft: BrowserOperatorSessionDraft;
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  const executorOptions = { urlGuard: async () => ({ safe: true }) };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-executor-'));
    confirmSpy = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation');
    confirmSpy.mockResolvedValue({ confirmed: true });
    
    sampleDraft = {
      schemaVersion: 1,
      sessionId: 'session-123',
      goal: 'test goal',
      mode: 'local',
      query: 'https://example.com',
      consent: {
        required: true,
        granted: false,
        scopes: ['local_browser'],
      },
      dedicatedTab: {
        required: true,
        reason: 'dedicated tab for testing',
      },
      stopControl: {
        enabled: true,
        label: 'Stop',
        stopConditions: ['success text', 'done'],
      },
      actionLog: [
        {
          id: 'action-1',
          sequence: 1,
          tool: 'navigate',
          title: 'Navigate to target',
          requiresConsent: true,
          status: 'planned',
          inputs: { url: 'https://example.com/target' },
        },
        {
          id: 'action-2',
          sequence: 2,
          tool: 'type',
          title: 'Type search query',
          requiresConsent: true,
          status: 'planned',
          inputs: { ref: 42, text: 'hello' },
        },
        {
          id: 'action-3',
          sequence: 3,
          tool: 'click',
          title: 'Click search button',
          requiresConsent: true,
          status: 'planned',
          inputs: { ref: 123 },
        },
      ],
      proofExport: ['action log'],
    };

    pageContentMock = '<html><body>normal page</body></html>';
    mockGoto = vi.fn().mockResolvedValue(undefined);
    mockAct = vi.fn().mockResolvedValue(undefined);
    mockScreenshot = vi.fn().mockResolvedValue(Buffer.from('fake-png'));
    mockClose = vi.fn().mockResolvedValue(undefined);
    mockInit = vi.fn().mockResolvedValue(undefined);
    mockEvaluate = vi.fn().mockImplementation(async (...args: unknown[]) => {
      const input = args[1] as { selectorGroups?: unknown } | undefined;
      if (Array.isArray(input?.selectorGroups)) {
        return {
          inspected: true,
          targetFound: true,
          url: 'https://example.com/current',
          documentTitle: 'Example title',
          resolvedSelectors: ['#search'],
          contexts: [{
            text: 'Search',
            ariaLabel: 'Search',
            labels: 'Search field',
            neighborhood: 'Search public documentation',
            formAction: '/search',
            formText: 'Search public documentation',
            role: 'button',
            inputType: 'text',
            name: 'search',
            href: '',
          }],
        };
      }
      return {
        url: 'https://example.com/current',
        title: 'Example title',
        text: 'Example text',
        headings: [],
        actions: [],
        fields: [],
        links: [],
      };
    });
    mockWheel = vi.fn().mockResolvedValue(undefined);
    mockPress = vi.fn().mockResolvedValue(undefined);
    mockFill = vi.fn().mockResolvedValue(undefined);
    mockClick = vi.fn().mockResolvedValue(undefined);
    mockObserve = vi.fn().mockResolvedValue([]);
    mockStagehandOptions = undefined;
  });

  afterEach(async () => {
    confirmSpy.mockRestore();
    await fs.remove(tempDir);
  });

  it('should block execution if consent is required but not granted', async () => {
    const executor = new BrowserOperatorExecutor(sampleDraft, executorOptions);
    await expect(executor.execute(tempDir)).rejects.toThrow(/consent/i);
  });

  it('should run successfully when consent is granted', async () => {
    const executor = new BrowserOperatorExecutor(sampleDraft, executorOptions);
    executor.grantConsent('test-operator');

    const result = await executor.execute(tempDir);

    expect(result.success).toBe(true);
    expect(result.stopped).toBe(false);
    expect(mockInit).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();

    // Verify all actions completed
    expect(result.actionLog.every(a => a.status === 'completed')).toBe(true);

    expect(mockGoto).toHaveBeenCalledWith('https://example.com/target', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    expect(mockFill).toHaveBeenCalledWith('hello');
    expect(mockClick).toHaveBeenCalledWith({ button: 'left', clickCount: 1 });
    expect(mockAct).not.toHaveBeenCalled();

    // Verify proof artifact was written
    const proofPath = path.join(tempDir, '.codebuddy', 'runs', 'session-123', 'artifacts', 'session-123.browser-operator.json');
    expect(await fs.pathExists(proofPath)).toBe(true);
    const proof = await fs.readJson(proofPath);
    expect(proof.success).toBe(true);
    expect(proof.consent.grantedBy).toBe('test-operator');
    expect(proof.harness.run.kind).toBe('run');
    expect(proof.harness.run.status).toBe('completed');
    expect(proof.harness.proof.kind).toBe('proof');
    expect(proof.harness.proof.ref).toBe('session-123.browser-operator.json');
    expect(proof.harness.sensitiveAction).toMatchObject({
      kind: 'sensitive-action',
      id: 'codebuddy.browser_operator.execute',
      defaultDryRun: true,
      requires: 'approval-required',
    });
    expect(proof.harness.approval).toMatchObject({
      kind: 'approval',
      decision: 'approved',
      reviewer: 'test-operator',
    });
    expect(proof.harness.capabilities.map((cap: { id: string }) => cap.id)).toContain('codebuddy.browser_operator.live_control');
  });

  it('forces local mode to a persistent private profile even when Browserbase is configured', async () => {
    const oldBrowserbaseKey = process.env.BROWSERBASE_API_KEY;
    const oldProfile = process.env.CODEBUDDY_BROWSER_OPERATOR_PROFILE_DIR;
    process.env.BROWSERBASE_API_KEY = 'cloud-key-must-not-switch-local-mode';
    process.env.CODEBUDDY_BROWSER_OPERATOR_PROFILE_DIR = path.join(tempDir, 'persistent-profile');
    try {
      const lockPath = path.join(process.env.CODEBUDDY_BROWSER_OPERATOR_PROFILE_DIR, BROWSER_OPERATOR_PROFILE_LOCK);
      let lockHeldDuringInit = false;
      let lockHeldDuringClose = false;
      mockInit.mockImplementation(async () => {
        lockHeldDuringInit = await fs.pathExists(lockPath);
      });
      mockClose.mockImplementation(async () => {
        lockHeldDuringClose = await fs.pathExists(lockPath);
      });
      const executor = new BrowserOperatorExecutor(sampleDraft, executorOptions);
      executor.grantConsent('test-operator');
      await executor.execute(tempDir);

      expect(mockStagehandOptions?.env).toBe('LOCAL');
      expect(mockStagehandOptions?.localBrowserLaunchOptions).toMatchObject({
        headless: false,
        userDataDir: path.join(tempDir, 'persistent-profile'),
        preserveUserDataDir: true,
      });
      expect(lockHeldDuringInit).toBe(true);
      expect(lockHeldDuringClose).toBe(true);
      expect(await fs.pathExists(lockPath)).toBe(false);
    } finally {
      if (oldBrowserbaseKey === undefined) delete process.env.BROWSERBASE_API_KEY;
      else process.env.BROWSERBASE_API_KEY = oldBrowserbaseKey;
      if (oldProfile === undefined) delete process.env.CODEBUDDY_BROWSER_OPERATOR_PROFILE_DIR;
      else process.env.CODEBUDDY_BROWSER_OPERATOR_PROFILE_DIR = oldProfile;
    }
  });

  it('should stop mid-run if stop() is called', async () => {
    let executor: BrowserOperatorExecutor;
    mockGoto.mockImplementation(async () => {
      executor.stop();
    });

    executor = new BrowserOperatorExecutor(sampleDraft, executorOptions);
    executor.grantConsent();

    const result = await executor.execute(tempDir);

    expect(result.success).toBe(false);
    expect(result.stopped).toBe(true);
    expect(result.actionLog[0]!.status).toBe('stopped');
    expect(result.actionLog[1]!.status).toBe('stopped');
  });

  it('should stop and set status to stopped when a stop condition is met', async () => {
    sampleDraft.stopControl.stopConditions = ['target'];

    const executor = new BrowserOperatorExecutor(sampleDraft, executorOptions);
    executor.grantConsent();

    const result = await executor.execute(tempDir);

    expect(result.stopped).toBe(true);
    expect(result.actionLog[0]!.status).toBe('stopped');
  });

  it('should pilot deterministic selectors, keyboard, scroll, extraction and screenshots', async () => {
    sampleDraft.actionLog = [
      {
        id: 'open',
        sequence: 1,
        tool: 'navigate',
        title: 'Open app',
        requiresConsent: false,
        status: 'planned',
        inputs: { url: 'https://example.com/app' },
      },
      {
        id: 'fill-email',
        sequence: 2,
        tool: 'fill',
        title: 'Fill email',
        requiresConsent: true,
        status: 'planned',
        inputs: { selector: '#email', value: 'patrice@example.com' },
      },
      {
        id: 'press-enter',
        sequence: 3,
        tool: 'press',
        title: 'Apply search filter',
        requiresConsent: true,
        status: 'planned',
        inputs: { key: 'Enter' },
      },
      {
        id: 'scroll',
        sequence: 4,
        tool: 'scroll',
        title: 'Scroll down',
        requiresConsent: false,
        status: 'planned',
        inputs: { direction: 'down', amount: 480 },
      },
      {
        id: 'extract',
        sequence: 5,
        tool: 'browser',
        action: 'extract',
        title: 'Extract DOM',
        requiresConsent: false,
        status: 'planned',
        inputs: {},
      },
      {
        id: 'screen',
        sequence: 6,
        tool: 'screenshot',
        title: 'Capture proof',
        requiresConsent: false,
        status: 'planned',
        inputs: {},
      },
    ];

    const executor = new BrowserOperatorExecutor(sampleDraft, executorOptions);
    executor.grantConsent();

    const result = await executor.execute(tempDir);

    expect(result.success).toBe(true);
    expect(mockFill).toHaveBeenCalledWith('patrice@example.com');
    expect(mockPress).toHaveBeenCalledWith('Enter');
    expect(mockWheel).toHaveBeenCalledWith(0, 480);
    expect(mockEvaluate).toHaveBeenCalled();
    expect(mockScreenshot).toHaveBeenCalled();
    expect(await fs.pathExists(path.join(tempDir, '.codebuddy', 'runs', 'session-123', 'artifacts', 'evidence_screen.png'))).toBe(true);
  });

  it('should bind a semantic target locally before acting deterministically', async () => {
    mockEvaluate.mockResolvedValue({
      inspected: true,
      targetFound: true,
      url: 'https://example.com/app',
      documentTitle: 'App',
      resolvedSelectors: ['#save-primary'],
      contexts: [{
        text: 'Save',
        ariaLabel: 'Save',
        labels: 'Primary save button',
        neighborhood: 'Edit profile details',
        formAction: '/profile/draft',
        formText: 'Edit profile details',
        role: 'button',
        inputType: 'button',
        name: 'save-primary',
        href: '',
      }],
    });
    mockObserve.mockResolvedValue([
      {
        selector: '#secondary',
        description: 'Secondary cancel button',
        method: 'click',
      },
      {
        selector: '#save-primary',
        description: 'Primary save button for the current form',
        method: 'click',
      },
    ]);
    sampleDraft.actionLog = [
      {
        id: 'open',
        sequence: 1,
        tool: 'navigate',
        title: 'Open app',
        requiresConsent: false,
        status: 'planned',
        inputs: { url: 'https://example.com/app' },
      },
      {
        id: 'save',
        sequence: 2,
        tool: 'click',
        title: 'Save form',
        requiresConsent: true,
        status: 'planned',
        inputs: { target: 'primary save button' },
      },
    ];

    const executor = new BrowserOperatorExecutor(sampleDraft, executorOptions);
    executor.grantConsent();

    const result = await executor.execute(tempDir);

    expect(result.success).toBe(true);
    expect(mockObserve).not.toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalledWith({ button: 'left', clickCount: 1 });
    expect(result.actionLog[1]!.evidence).toContain('#save-primary');
    expect(result.actionLog[1]!.evidence).toContain('target inspected locally');
  });
});
