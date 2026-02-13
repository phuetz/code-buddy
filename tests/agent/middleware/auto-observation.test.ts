import {
  MiddlewarePipeline,
  MiddlewareContext,
  AutoObservationMiddleware,
} from '../../../src/agent/middleware/index.js';

// Mock desktop-automation
const mockTakeSnapshot = jest.fn();
const mockCompareTo = jest.fn();
const mockToTextRepresentation = jest.fn();

jest.mock('../../../src/desktop-automation/index.js', () => ({
  getSmartSnapshotManager: () => ({
    takeSnapshot: mockTakeSnapshot,
    compareTo: mockCompareTo,
    toTextRepresentation: mockToTextRepresentation,
  }),
}));

// Mock browser-automation
const mockBrowserTakeSnapshot = jest.fn();

jest.mock('../../../src/browser-automation/index.js', () => ({
  getBrowserManager: () => ({
    takeSnapshot: mockBrowserTakeSnapshot,
  }),
}));

function makeContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    toolRound: 0,
    maxToolRounds: 80,
    sessionCost: 0,
    sessionCostLimit: 10,
    inputTokens: 100,
    outputTokens: 50,
    history: [],
    messages: [],
    isStreaming: true,
    ...overrides,
  };
}

function makeToolCallMessage(toolName: string, action: string) {
  return {
    role: 'assistant' as const,
    content: '',
    tool_calls: [{
      id: 'tc_1',
      type: 'function' as const,
      function: {
        name: toolName,
        arguments: JSON.stringify({ action }),
      },
    }],
  };
}

describe('AutoObservationMiddleware', () => {
  let middleware: AutoObservationMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new AutoObservationMiddleware({
      stabilizationMs: 0, // No delay in tests
      maxObservationsPerTurn: 3,
    });
  });

  describe('constructor', () => {
    it('should have correct name and priority', () => {
      expect(middleware.name).toBe('auto-observation');
      expect(middleware.priority).toBe(50);
    });
  });

  describe('beforeTurn', () => {
    it('should reset observation counter and return continue', () => {
      const ctx = makeContext();
      const result = middleware.beforeTurn(ctx);
      expect(result.action).toBe('continue');
    });
  });

  describe('afterTurn', () => {
    it('should return continue when no state-changing actions detected', async () => {
      const ctx = makeContext({
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      });

      const result = await middleware.afterTurn(ctx);
      expect(result.action).toBe('continue');
      expect(mockTakeSnapshot).not.toHaveBeenCalled();
    });

    it('should detect desktop state-changing actions and take snapshot', async () => {
      mockTakeSnapshot.mockResolvedValue({
        id: 'snap-1',
        elements: [{ ref: 1, name: 'Button', role: 'button' }],
        elementMap: new Map(),
        valid: true,
      });
      mockToTextRepresentation.mockReturnValue('# UI Snapshot\n[1] Button');

      const ctx = makeContext({
        messages: [
          makeToolCallMessage('computer_control', 'click'),
        ],
      });

      const result = await middleware.afterTurn(ctx);
      expect(result.action).toBe('continue');
      expect(mockTakeSnapshot).toHaveBeenCalled();

      // Should have injected a verification message
      const injected = ctx.messages.find(m =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('[Auto-Observation]')
      );
      expect(injected).toBeDefined();
    });

    it('should detect browser state-changing actions and take snapshot', async () => {
      mockBrowserTakeSnapshot.mockResolvedValue({
        id: 'websnap-1',
        url: 'https://example.com',
        title: 'Example',
        elements: [{ ref: 1, name: 'Submit', role: 'button', value: undefined }],
        valid: true,
      });

      const ctx = makeContext({
        messages: [
          makeToolCallMessage('browser', 'navigate'),
        ],
      });

      const result = await middleware.afterTurn(ctx);
      expect(result.action).toBe('continue');
      expect(mockBrowserTakeSnapshot).toHaveBeenCalled();

      const injected = ctx.messages.find(m =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('Browser Verification')
      );
      expect(injected).toBeDefined();
    });

    it('should not detect non-state-changing actions', async () => {
      const ctx = makeContext({
        messages: [
          makeToolCallMessage('computer_control', 'snapshot'),
          makeToolCallMessage('browser', 'get_url'),
        ],
      });

      const result = await middleware.afterTurn(ctx);
      expect(result.action).toBe('continue');
      expect(mockTakeSnapshot).not.toHaveBeenCalled();
      expect(mockBrowserTakeSnapshot).not.toHaveBeenCalled();
    });

    it('should cap observations at maxObservationsPerTurn', async () => {
      const mw = new AutoObservationMiddleware({
        stabilizationMs: 0,
        maxObservationsPerTurn: 2,
      });

      mockTakeSnapshot.mockResolvedValue({
        id: 'snap-cap',
        elements: [],
        elementMap: new Map(),
        valid: true,
      });
      mockToTextRepresentation.mockReturnValue('# UI Snapshot');
      mockCompareTo.mockReturnValue({
        hasChanges: false,
        changedRegions: [],
        newElements: [],
        removedElements: [],
        similarity: 1,
      });

      let snapshotCallCount = 0;
      mockTakeSnapshot.mockImplementation(async () => {
        snapshotCallCount++;
        return {
          id: `snap-${snapshotCallCount}`,
          elements: [],
          elementMap: new Map(),
          valid: true,
        };
      });

      // Simulate 3 afterTurn calls within same turn (no beforeTurn reset)
      for (let i = 0; i < 3; i++) {
        const ctx = makeContext({
          messages: [makeToolCallMessage('computer_control', 'click')],
        });
        await mw.afterTurn(ctx);
      }

      // Should only take 2 snapshots (capped at maxObservationsPerTurn)
      expect(snapshotCallCount).toBe(2);
    });

    it('should reset observation counter on beforeTurn', async () => {
      mockTakeSnapshot.mockResolvedValue({
        id: 'snap-1',
        elements: [],
        elementMap: new Map(),
        valid: true,
      });
      mockToTextRepresentation.mockReturnValue('# UI Snapshot');

      const mw = new AutoObservationMiddleware({
        stabilizationMs: 0,
        maxObservationsPerTurn: 1,
      });

      // First turn: 1 observation
      const ctx1 = makeContext({
        messages: [makeToolCallMessage('computer_control', 'click')],
      });
      await mw.afterTurn(ctx1);
      expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);

      // Cap reached, next should be skipped
      const ctx2 = makeContext({
        messages: [makeToolCallMessage('computer_control', 'type')],
      });
      await mw.afterTurn(ctx2);
      expect(mockTakeSnapshot).toHaveBeenCalledTimes(1); // Still 1

      // Reset via beforeTurn
      mw.beforeTurn(makeContext());

      // Now should work again
      const ctx3 = makeContext({
        messages: [makeToolCallMessage('computer_control', 'key')],
      });
      await mw.afterTurn(ctx3);
      expect(mockTakeSnapshot).toHaveBeenCalledTimes(2); // Now 2
    });

    it('should handle snapshot errors gracefully', async () => {
      mockTakeSnapshot.mockRejectedValue(new Error('Snapshot failed'));

      const ctx = makeContext({
        messages: [makeToolCallMessage('computer_control', 'click')],
      });

      // Should not throw
      const result = await middleware.afterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('should handle browser snapshot errors gracefully', async () => {
      mockBrowserTakeSnapshot.mockRejectedValue(new Error('Browser not connected'));

      const ctx = makeContext({
        messages: [makeToolCallMessage('browser', 'click')],
      });

      // Should not throw
      const result = await middleware.afterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('should include diff information when previous snapshot exists', async () => {
      // First snapshot
      const firstSnapshot = {
        id: 'snap-1',
        elements: [{ ref: 1, name: 'OldButton', role: 'button' }],
        elementMap: new Map(),
        valid: true,
      };
      mockTakeSnapshot.mockResolvedValueOnce(firstSnapshot);
      mockToTextRepresentation.mockReturnValueOnce('# Snapshot 1');

      const ctx1 = makeContext({
        messages: [makeToolCallMessage('computer_control', 'click')],
      });
      await middleware.afterTurn(ctx1);

      // Reset turn counter
      middleware.beforeTurn(makeContext());

      // Second snapshot with diff
      const secondSnapshot = {
        id: 'snap-2',
        elements: [{ ref: 2, name: 'NewButton', role: 'button' }],
        elementMap: new Map(),
        valid: true,
      };
      mockTakeSnapshot.mockResolvedValueOnce(secondSnapshot);
      mockCompareTo.mockReturnValueOnce({
        hasChanges: true,
        similarity: 0.5,
        newElements: [{ ref: 2, name: 'NewButton', role: 'button' }],
        removedElements: [{ ref: 1, name: 'OldButton', role: 'button' }],
        changedRegions: [],
      });
      mockToTextRepresentation.mockReturnValueOnce('# Snapshot 2');

      const ctx2 = makeContext({
        messages: [makeToolCallMessage('computer_control', 'click')],
      });
      await middleware.afterTurn(ctx2);

      expect(mockCompareTo).toHaveBeenCalled();

      const injected = ctx2.messages.find(m =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('Changes detected')
      );
      expect(injected).toBeDefined();
    });
  });

  describe('integration with pipeline', () => {
    it('should work correctly in a MiddlewarePipeline', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(middleware);

      expect(pipeline.getMiddlewareNames()).toContain('auto-observation');

      const ctx = makeContext();
      const result = await pipeline.runAfterTurn(ctx);
      expect(result.action).toBe('continue');
    });

    it('should respect priority ordering in pipeline', () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use(middleware); // priority 50
      pipeline.use({
        name: 'low-priority',
        priority: 100,
        afterTurn: () => ({ action: 'continue' as const }),
      });
      pipeline.use({
        name: 'high-priority',
        priority: 10,
        afterTurn: () => ({ action: 'continue' as const }),
      });

      const names = pipeline.getMiddlewareNames();
      expect(names.indexOf('high-priority')).toBeLessThan(names.indexOf('auto-observation'));
      expect(names.indexOf('auto-observation')).toBeLessThan(names.indexOf('low-priority'));
    });
  });

  describe('state-changing action detection', () => {
    const desktopStateActions = [
      'click', 'double_click', 'right_click',
      'type', 'key', 'hotkey',
      'drag', 'scroll',
      'focus_window', 'close_window',
    ];

    const browserStateActions = [
      'navigate', 'click', 'double_click', 'right_click',
      'fill', 'submit', 'select', 'hover', 'scroll',
      'go_back', 'go_forward', 'reload',
      'evaluate', 'type', 'press',
    ];

    const nonStateDesktopActions = [
      'snapshot', 'get_element', 'find_elements',
      'get_windows', 'get_volume', 'system_info',
    ];

    const nonStateBrowserActions = [
      'snapshot', 'get_element', 'find_elements',
      'tabs', 'get_cookies', 'get_url', 'get_title',
    ];

    for (const action of desktopStateActions) {
      it(`should detect desktop action '${action}' as state-changing`, async () => {
        mockTakeSnapshot.mockResolvedValue({
          id: 'snap-1', elements: [], elementMap: new Map(), valid: true,
        });
        mockToTextRepresentation.mockReturnValue('# Snap');

        const mw = new AutoObservationMiddleware({ stabilizationMs: 0 });
        const ctx = makeContext({
          messages: [makeToolCallMessage('computer_control', action)],
        });
        await mw.afterTurn(ctx);
        expect(mockTakeSnapshot).toHaveBeenCalled();
        mockTakeSnapshot.mockClear();
      });
    }

    for (const action of browserStateActions) {
      it(`should detect browser action '${action}' as state-changing`, async () => {
        mockBrowserTakeSnapshot.mockResolvedValue({
          id: 'websnap-1', url: 'https://test.com', title: 'Test',
          elements: [], valid: true,
        });

        const mw = new AutoObservationMiddleware({ stabilizationMs: 0 });
        const ctx = makeContext({
          messages: [makeToolCallMessage('browser', action)],
        });
        await mw.afterTurn(ctx);
        expect(mockBrowserTakeSnapshot).toHaveBeenCalled();
        mockBrowserTakeSnapshot.mockClear();
      });
    }

    for (const action of nonStateDesktopActions) {
      it(`should NOT detect desktop action '${action}' as state-changing`, async () => {
        const mw = new AutoObservationMiddleware({ stabilizationMs: 0 });
        const ctx = makeContext({
          messages: [makeToolCallMessage('computer_control', action)],
        });
        await mw.afterTurn(ctx);
        expect(mockTakeSnapshot).not.toHaveBeenCalled();
      });
    }

    for (const action of nonStateBrowserActions) {
      it(`should NOT detect browser action '${action}' as state-changing`, async () => {
        const mw = new AutoObservationMiddleware({ stabilizationMs: 0 });
        const ctx = makeContext({
          messages: [makeToolCallMessage('browser', action)],
        });
        await mw.afterTurn(ctx);
        expect(mockBrowserTakeSnapshot).not.toHaveBeenCalled();
      });
    }
  });
});
