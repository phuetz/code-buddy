import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserOperatorExecutor, SecurityCheckpointDetected } from '../../src/browser-automation/browser-operator-executor.js';

let pageContentMock = '<html><body>normal page</body></html>';
let gotoPromiseFactory = () => Promise.resolve();

vi.mock('@browserbasehq/stagehand', () => {
  return {
    Stagehand: class {
      init = vi.fn();
      close = vi.fn();
      page = {
        content: vi.fn().mockImplementation(() => Promise.resolve(pageContentMock)),
        goto: vi.fn().mockImplementation(() => gotoPromiseFactory()),
        act: vi.fn(),
        extract: vi.fn(),
        screenshot: vi.fn().mockResolvedValue(Buffer.from([]))
      };
    }
  };
});

vi.mock('../../src/utils/confirmation-service.js', () => {
  return {
    ConfirmationService: {
      getInstance: vi.fn().mockReturnValue({
        requestConfirmation: vi.fn().mockResolvedValue({ confirmed: true })
      })
    }
  };
});

describe('Browser Operator Watchdog', () => {
  const executorOptions = { urlGuard: async () => ({ safe: true }) };
  beforeEach(() => {
    pageContentMock = '<html><body>normal page</body></html>';
    gotoPromiseFactory = () => Promise.resolve();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute actions successfully when no bot checkpoint is present', async () => {
    const session: any = {
      sessionId: 'session_123',
      goal: 'test goal',
      mode: 'headless',
      query: 'https://example.com',
      consent: {
        // `scopes` is a required field on BrowserOperatorConsentState; the real
        // session factory always populates it (browser-operator-session.ts:104).
        scopes: ['public_web_read'],
        granted: true,
        grantedBy: 'human',
        grantedAt: new Date().toISOString()
      },
      actionLog: [
        {
          id: 'action_1',
          sequence: 1,
          tool: 'navigate',
          title: 'Navigate to page',
          inputs: { url: 'https://example.com' },
          status: 'pending'
        }
      ],
      stopControl: {
        stopConditions: []
      }
    };

    const executor = new BrowserOperatorExecutor(session, executorOptions);
    const result = await executor.execute();

    expect(result.success).toBe(true);
    expect(result.stopped).toBe(false);
  });

  it('should abort execution and throw SecurityCheckpointDetected when anti-bot triggers are met', async () => {
    // Set mock content to trigger the anti-bot check
    pageContentMock = '<html><body>Please verify you are human (Cloudflare cf-challenge)</body></html>';

    let resolveGoto: any;
    const gotoPromise = new Promise<void>((resolve) => {
      resolveGoto = resolve;
    });
    gotoPromiseFactory = () => gotoPromise;

    const session: any = {
      sessionId: 'session_456',
      goal: 'test goal',
      mode: 'headless',
      query: 'https://example.com',
      consent: {
        scopes: ['public_web_read'],
        granted: true,
        grantedBy: 'human',
        grantedAt: new Date().toISOString()
      },
      actionLog: [
        {
          id: 'action_1',
          sequence: 1,
          tool: 'navigate',
          title: 'Navigate to page',
          inputs: { url: 'https://example.com' },
          status: 'pending'
        },
        {
          id: 'action_2',
          sequence: 2,
          tool: 'click',
          title: 'Click button',
          status: 'pending'
        }
      ],
      stopControl: {
        stopConditions: []
      }
    };

    const executor = new BrowserOperatorExecutor(session, executorOptions);

    // We expect the execution loop to throw SecurityCheckpointDetected once the watchdog runs and sets the checkpointDetected flag.
    // Since the watchdog runs on a 3-second interval, we can speed up the test by manually triggering the interval if needed,
    // or since it's an integration check, let's wrap it in a promise that waits for it.
    // Wait, to make this test deterministic and fast, we can mock setInterval to run immediately!
    vi.useFakeTimers();

    const executePromise = executor.execute();
    const rejection = expect(executePromise).rejects.toThrow(SecurityCheckpointDetected);

    // Advance timers by 3 seconds to trigger the watchdog
    await vi.advanceTimersByTimeAsync(3500);

    // Resolve the goto promise so the loop can check checkpointDetected
    resolveGoto();

    await rejection;

  });

  it('should interrupt a long-running action as soon as the watchdog detects a checkpoint', async () => {
    pageContentMock = '<html><body>Cloudflare security checkpoint</body></html>';
    gotoPromiseFactory = () => new Promise<void>(() => {});

    const session: any = {
      sessionId: 'session_789',
      goal: 'test goal',
      mode: 'headless',
      query: 'https://example.com',
      consent: {
        scopes: ['public_web_read'],
        granted: true,
        grantedBy: 'human',
        grantedAt: new Date().toISOString()
      },
      actionLog: [
        {
          id: 'action_1',
          sequence: 1,
          tool: 'navigate',
          title: 'Navigate to page',
          inputs: { url: 'https://example.com' },
          status: 'pending'
        }
      ],
      stopControl: {
        stopConditions: []
      }
    };

    vi.useFakeTimers();

    const executor = new BrowserOperatorExecutor(session, executorOptions);
    const executePromise = executor.execute();
    const rejection = expect(executePromise).rejects.toThrow(SecurityCheckpointDetected);
    await vi.advanceTimersByTimeAsync(3500);

    await rejection;
  });
});
