import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserOperatorExecutor } from '../../src/browser-automation/browser-operator-executor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import type { BrowserOperatorSessionDraft } from '../../src/browser-automation/browser-operator-session.js';

let gotoImpl: (url: string) => Promise<unknown> = async () => undefined;
let gotoMock = vi.fn((url: string) => gotoImpl(url));
let initMock = vi.fn(async () => undefined);
let closeMock = vi.fn(async () => undefined);
let fillMock = vi.fn(async () => undefined);
let clickImpl: () => Promise<unknown> = async () => undefined;
let actImpl: () => Promise<unknown> = async () => undefined;
let currentPageUrl = 'about:blank';
let navigationRouteHandler: ((route: Record<string, unknown>, request: Record<string, unknown>) => Promise<void>) | undefined;
let targetInspectionImpl: (input?: { selectorGroups?: string[][] }) => Promise<unknown> = async () => neutralTargetInspection();

function neutralTargetInspection(input?: { selectorGroups?: string[][] }): Record<string, unknown> {
  const serializedSelectors = JSON.stringify(input?.selectorGroups ?? []);
  const passwordTarget = serializedSelectors.includes('password');
  return {
    inspected: true,
    targetFound: true,
    url: currentPageUrl,
    documentTitle: 'Public example',
    resolvedSelectors: ['#safe-target'],
    contexts: [{
      text: passwordTarget ? '' : 'Open details',
      ariaLabel: passwordTarget ? 'Password' : 'Open details',
      labels: passwordTarget ? 'Password' : 'Details',
      neighborhood: passwordTarget ? 'Sign in securely' : 'Public account details',
      formAction: passwordTarget ? '/login' : '',
      formText: passwordTarget ? 'Sign in securely' : '',
      role: passwordTarget ? 'input' : 'button',
      inputType: passwordTarget ? 'password' : 'button',
      name: passwordTarget ? 'password' : 'details',
      href: '',
    }],
  };
}

async function dispatchNavigation(url: string): Promise<void> {
  let aborted = false;
  const request = {
    url: () => url,
    isNavigationRequest: () => true,
    resourceType: () => 'document',
  };
  if (navigationRouteHandler) {
    await navigationRouteHandler({
      request: () => request,
      continue: async () => undefined,
      abort: async () => {
        aborted = true;
      },
    }, request);
  }
  if (aborted) throw new Error('net::ERR_BLOCKED_BY_CLIENT');
  currentPageUrl = url;
}

vi.mock('@browserbasehq/stagehand', () => ({
  Stagehand: class {
    init = (...args: unknown[]) => initMock(...args);
    close = (...args: unknown[]) => closeMock(...args);
    page = {
      content: vi.fn(async () => '<html><body>public</body></html>'),
      route: vi.fn(async (_pattern: string, handler: typeof navigationRouteHandler) => {
        navigationRouteHandler = handler;
      }),
      unroute: vi.fn(async () => {
        navigationRouteHandler = undefined;
      }),
      context: () => ({
        route: async (_pattern: string, handler: typeof navigationRouteHandler) => {
          navigationRouteHandler = handler;
        },
        unroute: async () => {
          navigationRouteHandler = undefined;
        },
      }),
      goto: async (url: string) => {
        await dispatchNavigation(url);
        return gotoMock(url);
      },
      act: async () => actImpl(),
      evaluate: async (_fn: unknown, input?: { selectorGroups?: string[][] }) => targetInspectionImpl(input),
      locator: vi.fn(() => ({
        fill: (...args: unknown[]) => fillMock(...args),
        click: () => clickImpl(),
      })),
      url: vi.fn(() => currentPageUrl),
      title: vi.fn(async () => 'Example'),
    };
  },
}));

const tempDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'browser-operator-security-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

beforeEach(() => {
  gotoImpl = async () => undefined;
  gotoMock = vi.fn((url: string) => gotoImpl(url));
  initMock = vi.fn(async () => undefined);
  closeMock = vi.fn(async () => undefined);
  fillMock = vi.fn(async () => undefined);
  clickImpl = async () => undefined;
  actImpl = async () => undefined;
  currentPageUrl = 'about:blank';
  navigationRouteHandler = undefined;
  targetInspectionImpl = async (input) => neutralTargetInspection(input);
  vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation')
    .mockResolvedValue({ confirmed: true });
});

function session(actionLog: BrowserOperatorSessionDraft['actionLog'], sessionId = 'runtime-safe-1'): BrowserOperatorSessionDraft {
  return {
    schemaVersion: 1,
    sessionId,
    generatedAt: '2026-07-12T00:00:00.000Z',
    goal: 'Reviewed browser task',
    query: 'https://example.com',
    sourceUrl: 'https://example.com',
    mode: 'isolated',
    intent: 'research',
    dedicatedTab: { label: 'Reviewed task', reason: 'Dedicated visible tab' },
    consent: {
      required: true,
      granted: true,
      scopes: ['public_web_read'],
      reason: 'Reviewed',
      grantedBy: 'Patrice',
    },
    stopControl: { enabled: true, label: 'Stop', stopConditions: [] },
    actionLog,
    proofExport: { artifactName: `${sessionId}.browser-operator.json`, includes: ['action log'] },
  };
}

function action(
  tool: string,
  inputs: Record<string, unknown>,
  overrides: Partial<BrowserOperatorSessionDraft['actionLog'][number]> = {},
): BrowserOperatorSessionDraft['actionLog'][number] {
  return {
    id: 'action-1',
    sequence: 1,
    status: 'planned',
    tool,
    stage: 'interact',
    title: tool,
    evidence: 'user-action',
    requiresConsent: tool !== 'navigate',
    expectedArtifact: 'browser-action-log.jsonl',
    reason: 'Reviewed action',
    inputs,
    ...overrides,
  };
}

describe('BrowserOperatorExecutor security boundary', () => {
  it('does not require target inspection for simple navigation', async () => {
    const cwd = await workspace();
    targetInspectionImpl = async () => {
      throw new Error('DOM inspection should not run for navigation');
    };
    const executor = new BrowserOperatorExecutor(
      session([action('navigate', { url: 'https://example.com/public' })]),
      { urlGuard: async () => ({ safe: true }) },
    );

    const result = await executor.execute(cwd);

    expect(result.success).toBe(true);
    expect(result.actionLog[0]?.evidence).toContain('Semantic preflight: read');
  });

  it('fails closed before navigating to a private or loopback URL', async () => {
    const cwd = await workspace();
    const executor = new BrowserOperatorExecutor(
      session([action('navigate', { url: 'http://127.0.0.1:3000/admin' })]),
    );

    const result = await executor.execute(cwd);

    expect(result.success).toBe(false);
    expect(result.actionLog[0]).toMatchObject({ status: 'blocked' });
    expect(result.actionLog[0]?.evidence).toMatch(/Navigation blocked/i);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('blocks every unsafe redirect hop before the browser follows it', async () => {
    const cwd = await workspace();
    const urlGuard = vi.fn(async (url: string) => ({
      safe: !url.includes('169.254.169.254'),
      reason: 'link-local metadata address',
    }));
    gotoImpl = async () => {
      await dispatchNavigation('http://169.254.169.254/latest/meta-data');
    };
    const executor = new BrowserOperatorExecutor(
      session([action('navigate', { url: 'https://example.com/redirect' })]),
      { urlGuard },
    );

    const result = await executor.execute(cwd);

    expect(result.success).toBe(false);
    expect(result.actionLog[0]).toMatchObject({ status: 'blocked' });
    expect(result.actionLog[0]?.evidence).toMatch(/Navigation blocked/i);
    expect(urlGuard).toHaveBeenCalledWith('http://169.254.169.254/latest/meta-data');
  });

  it('verifies the effective URL after a redirect even if the backend hides the request event', async () => {
    const cwd = await workspace();
    const urlGuard = vi.fn(async (url: string) => ({
      safe: !url.includes('127.0.0.1'),
      reason: 'loopback address',
    }));
    gotoImpl = async () => {
      currentPageUrl = 'http://127.0.0.1:8080/internal';
    };
    const executor = new BrowserOperatorExecutor(
      session([action('navigate', { url: 'https://example.com/opaque-redirect' })]),
      { urlGuard },
    );

    const result = await executor.execute(cwd);

    expect(result.success).toBe(false);
    expect(result.actionLog[0]).toMatchObject({ status: 'blocked' });
    expect(result.actionLog[0]?.evidence).toMatch(/Navigation blocked/i);
    expect(urlGuard).toHaveBeenCalledWith('http://127.0.0.1:8080/internal');
  });

  it.each([
    ['click', () => {
      clickImpl = () => dispatchNavigation('http://169.254.169.254/click');
    }, { selector: '#open-private' }],
    ['act', () => {
      clickImpl = () => dispatchNavigation('http://169.254.169.254/act');
    }, { instruction: 'open the account details page' }],
  ])('blocks an unsafe navigation triggered by %s', async (tool, configure, inputs) => {
    const cwd = await workspace();
    configure();
    const urlGuard = vi.fn(async (url: string) => ({
      safe: !url.includes('169.254.169.254'),
      reason: 'link-local metadata address',
    }));
    const executor = new BrowserOperatorExecutor(
      session([
        action('navigate', { url: 'https://example.com' }, { id: 'navigate' }),
        action(tool, inputs, { id: tool, sequence: 2 }),
      ]),
      { urlGuard },
    );

    const result = await executor.execute(cwd);

    expect(result.success).toBe(false);
    expect(result.actionLog[0]?.status).toBe('completed');
    expect(result.actionLog[1]?.status).toBe('blocked');
    expect(result.actionLog[1]?.evidence).toMatch(/Navigation blocked/i);
  });

  it.each([
    [
      'payment context',
      'https://example.com/checkout/review',
      { neighborhood: 'Review the order total before continuing', formAction: '/checkout/complete', formText: 'Order total 49 EUR' },
    ],
    [
      'message submission context',
      'https://example.com/support',
      { neighborhood: 'Your message to customer support', formAction: '/messages/send', formText: 'Message preview' },
    ],
    [
      'destructive dialog context',
      'https://example.com/settings',
      { neighborhood: 'Delete this workspace permanently. This cannot be undone.', formAction: '', formText: '' },
    ],
  ])('blocks a neutral target label hidden inside %s before generic confirmation', async (_label, url, sensitiveContext) => {
    const cwd = await workspace();
    const clickSpy = vi.fn(async () => undefined);
    clickImpl = clickSpy;
    targetInspectionImpl = async () => ({
      inspected: true,
      targetFound: true,
      url,
      documentTitle: 'Settings',
      resolvedSelectors: ['#primary-action'],
      contexts: [{
        text: 'Continue',
        ariaLabel: 'Continue',
        labels: '',
        ...sensitiveContext,
        role: 'button',
        inputType: 'button',
        name: 'primary-action',
        href: '',
      }],
    });
    const executor = new BrowserOperatorExecutor(
      session([
        action('navigate', { url }, { id: 'navigate' }),
        action('click', { selector: '#primary-action' }, {
          id: 'neutral-action',
          sequence: 2,
          title: 'Continue',
          reason: 'Advance to the next view',
        }),
      ]),
      { urlGuard: async () => ({ safe: true }) },
    );

    const result = await executor.execute(cwd);

    expect(result.success).toBe(false);
    expect(result.actionLog[1]?.status).toBe('blocked');
    expect(result.actionLog[1]?.evidence).toMatch(/SensitiveEffectBlocked/);
    expect(result.actionLog[1]?.evidence).toMatch(/Generic browser confirmation never authorizes/i);
    expect(ConfirmationService.getInstance().requestConfirmation).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('fails closed before confirmation when a mutating target cannot be inspected locally', async () => {
    const cwd = await workspace();
    targetInspectionImpl = async () => ({
      inspected: true,
      targetFound: false,
      url: 'https://example.com/app',
      documentTitle: 'App',
      resolvedSelectors: [],
      contexts: [],
      error: 'selector did not resolve',
    });
    const executor = new BrowserOperatorExecutor(
      session([
        action('navigate', { url: 'https://example.com/app' }, { id: 'navigate' }),
        action('click', { selector: '#missing' }, { id: 'missing', sequence: 2, title: 'Open panel' }),
      ]),
      { urlGuard: async () => ({ safe: true }) },
    );

    const result = await executor.execute(cwd);

    expect(result.success).toBe(false);
    expect(result.actionLog[1]?.status).toBe('blocked');
    expect(result.actionLog[1]?.evidence).toMatch(/TargetInspectionRequired/);
    expect(ConfirmationService.getInstance().requestConfirmation).not.toHaveBeenCalled();
  });

  it('re-inspects after generic confirmation and blocks a target that changed to a destructive effect', async () => {
    const cwd = await workspace();
    let inspectionCount = 0;
    const clickSpy = vi.fn(async () => undefined);
    clickImpl = clickSpy;
    targetInspectionImpl = async () => {
      inspectionCount += 1;
      const destructive = inspectionCount > 1;
      return {
        inspected: true,
        targetFound: true,
        url: 'https://example.com/settings',
        documentTitle: 'Settings',
        resolvedSelectors: ['#primary-action'],
        contexts: [{
          text: destructive ? 'Confirm' : 'Open preferences',
          ariaLabel: destructive ? 'Confirm' : 'Open preferences',
          labels: '',
          neighborhood: destructive ? 'Delete workspace permanently. This cannot be undone.' : 'Display preferences',
          formAction: '',
          formText: '',
          role: 'button',
          inputType: 'button',
          name: 'primary-action',
          href: '',
        }],
      };
    };
    const executor = new BrowserOperatorExecutor(
      session([
        action('navigate', { url: 'https://example.com/settings' }, { id: 'navigate' }),
        action('click', { selector: '#primary-action' }, { id: 'changing', sequence: 2, title: 'Open preferences' }),
      ]),
      { urlGuard: async () => ({ safe: true }) },
    );

    const result = await executor.execute(cwd);

    expect(inspectionCount).toBe(2);
    expect(result.success).toBe(false);
    expect(result.actionLog[1]?.evidence).toMatch(/SensitiveEffectBlocked/);
    expect(ConfirmationService.getInstance().requestConfirmation).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('interrupts a hung browser action promptly when stop is requested', async () => {
    const cwd = await workspace();
    gotoImpl = () => new Promise(() => undefined);
    const executor = new BrowserOperatorExecutor(
      session([action('navigate', { url: 'https://example.com' })]),
      { urlGuard: async () => ({ safe: true }) },
    );

    const running = executor.execute(cwd);
    await vi.waitFor(() => expect(initMock).toHaveBeenCalled());
    executor.stop();

    const result = await Promise.race([
      running,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stop timed out')), 500)),
    ]);
    expect(result.stopped).toBe(true);
    expect(result.actionLog[0]?.status).toBe('stopped');
    expect(closeMock).toHaveBeenCalled();
  });

  it('writes a private proof artifact without credentials typed into password fields', async () => {
    const cwd = await workspace();
    await chmod(cwd, 0o700);
    const executor = new BrowserOperatorExecutor(
      session([
        action('navigate', { url: 'https://example.com/login' }, { id: 'navigate' }),
        action('fill', { selector: '#password', value: 'super-secret-password' }, { id: 'password', sequence: 2 }),
      ]),
      { urlGuard: async () => ({ safe: true }) },
    );

    const result = await executor.execute(cwd);
    expect(result.success).toBe(false);
    expect(result.actionLog[1]?.status).toBe('blocked');
    expect(result.actionLog[1]?.evidence).toMatch(/SensitiveEffectBlocked/i);
    expect(result.proofPath).toBeTruthy();
    const raw = await readFile(result.proofPath!, 'utf8');
    expect(raw).not.toContain('super-secret-password');
    expect(raw).toContain('[REDACTED]');
    if (process.platform !== 'win32') {
      expect((await stat(result.proofPath!)).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects model-controlled runtime ids that could escape the workspace', async () => {
    const cwd = await workspace();
    const executor = new BrowserOperatorExecutor(
      session([action('navigate', { url: 'https://example.com' })], '../../outside'),
      { urlGuard: async () => ({ safe: true }) },
    );

    await expect(executor.execute(cwd)).rejects.toThrow(/session id/i);
  });
});
