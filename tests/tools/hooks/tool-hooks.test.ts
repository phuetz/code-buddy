/**
 * Tool Lifecycle Hooks Tests
 */

import {
  ToolHooksManager,
  getToolHooksManager,
  resetToolHooksManager,
  DEFAULT_TOOL_HOOKS_CONFIG,
  type ToolHookContext,
  type ToolHookResult,
} from '../../../src/tools/hooks/index.js';

describe('ToolHooksManager', () => {
  let manager: ToolHooksManager;

  const createContext = (overrides: Partial<ToolHookContext> = {}): ToolHookContext => ({
    toolName: 'test_tool',
    originalArgs: { foo: 'bar' },
    args: { foo: 'bar' },
    toolCallId: 'call_123',
    timestamp: Date.now(),
    ...overrides,
  });

  const createResult = (overrides: Partial<ToolHookResult> = {}): ToolHookResult => ({
    success: true,
    output: 'test output',
    ...overrides,
  });

  beforeEach(() => {
    manager = new ToolHooksManager();
  });

  afterEach(() => {
    manager.clearAll();
  });

  describe('hook registration', () => {
    it('should register before hook', () => {
      manager.registerBeforeHook('test-hook', async (ctx) => ctx);

      const counts = manager.getHookCounts();
      expect(counts.before_tool_call).toBe(1);
    });

    it('should register after hook', () => {
      manager.registerAfterHook('test-hook', async (_ctx, result) => result);

      const counts = manager.getHookCounts();
      expect(counts.after_tool_call).toBe(1);
    });

    it('should register persist hook', () => {
      manager.registerPersistHook('test-hook', (_ctx, result) => result);

      const counts = manager.getHookCounts();
      expect(counts.tool_result_persist).toBe(1);
    });

    it('should register error hook', () => {
      manager.registerErrorHook('test-hook', async () => {});

      const counts = manager.getHookCounts();
      expect(counts.tool_error).toBe(1);
    });

    it('should register with priority', () => {
      manager.registerBeforeHook('low', async (ctx) => ctx, { priority: 10 });
      manager.registerBeforeHook('high', async (ctx) => ctx, { priority: 100 });

      const hooks = manager.getRegisteredHooks();
      const beforeHooks = hooks.filter(h => h.stage === 'before_tool_call');

      // Check both hooks are registered with correct priorities
      const lowHook = beforeHooks.find(h => h.id === 'low');
      const highHook = beforeHooks.find(h => h.id === 'high');

      expect(lowHook?.priority).toBe(10);
      expect(highHook?.priority).toBe(100);
    });

    it('should register with plugin prefix', () => {
      manager.registerBeforeHook('test', async (ctx) => ctx, { pluginId: 'my-plugin' });

      const hooks = manager.getRegisteredHooks();
      expect(hooks[0].id).toBe('plugin:my-plugin:test');
      expect(hooks[0].pluginId).toBe('my-plugin');
    });

    it('should unregister hook', () => {
      manager.registerBeforeHook('test-hook', async (ctx) => ctx);
      expect(manager.getHookCounts().before_tool_call).toBe(1);

      const result = manager.unregisterHook('before_tool_call', 'test-hook');
      expect(result).toBe(true);
      expect(manager.getHookCounts().before_tool_call).toBe(0);
    });

    it('should unregister all plugin hooks', () => {
      manager.registerBeforeHook('hook1', async (ctx) => ctx, { pluginId: 'plugin-a' });
      manager.registerAfterHook('hook2', async (_ctx, r) => r, { pluginId: 'plugin-a' });
      manager.registerBeforeHook('hook3', async (ctx) => ctx, { pluginId: 'plugin-b' });

      const count = manager.unregisterPluginHooks('plugin-a');
      expect(count).toBe(2);

      const hooks = manager.getRegisteredHooks();
      expect(hooks.length).toBe(1);
      expect(hooks[0].pluginId).toBe('plugin-b');
    });

    it('should enable/disable hooks', () => {
      manager.registerBeforeHook('test-hook', async (ctx) => ctx);

      manager.setHookEnabled('before_tool_call', 'test-hook', false);

      const hooks = manager.getRegisteredHooks();
      expect(hooks[0].enabled).toBe(false);

      manager.setHookEnabled('before_tool_call', 'test-hook', true);

      const hooks2 = manager.getRegisteredHooks();
      expect(hooks2[0].enabled).toBe(true);
    });
  });

  describe('before hook execution', () => {
    it('should execute before hooks', async () => {
      const executed: string[] = [];

      manager.registerBeforeHook('hook1', async (ctx) => {
        executed.push('hook1');
        return ctx;
      });

      manager.registerBeforeHook('hook2', async (ctx) => {
        executed.push('hook2');
        return ctx;
      });

      const context = createContext();
      await manager.executeBeforeHooks(context);

      expect(executed).toEqual(['hook1', 'hook2']);
    });

    it('should modify context in before hooks', async () => {
      manager.registerBeforeHook('modifier', async (ctx) => ({
        ...ctx,
        args: { ...ctx.args, modified: true },
      }));

      const context = createContext();
      const result = await manager.executeBeforeHooks(context);

      expect(result.args.modified).toBe(true);
      expect(result.args.foo).toBe('bar');
    });

    it('should execute hooks in priority order', async () => {
      const order: number[] = [];

      manager.registerBeforeHook('low', async (ctx) => {
        order.push(10);
        return ctx;
      }, { priority: 10 });

      manager.registerBeforeHook('high', async (ctx) => {
        order.push(100);
        return ctx;
      }, { priority: 100 });

      manager.registerBeforeHook('medium', async (ctx) => {
        order.push(50);
        return ctx;
      }, { priority: 50 });

      await manager.executeBeforeHooks(createContext());

      expect(order).toEqual([100, 50, 10]);
    });

    it('should skip disabled hooks', async () => {
      const executed: string[] = [];

      manager.registerBeforeHook('enabled', async (ctx) => {
        executed.push('enabled');
        return ctx;
      });

      manager.registerBeforeHook('disabled', async (ctx) => {
        executed.push('disabled');
        return ctx;
      });

      manager.setHookEnabled('before_tool_call', 'disabled', false);

      await manager.executeBeforeHooks(createContext());

      expect(executed).toEqual(['enabled']);
    });

    it('should continue on error when configured', async () => {
      const executed: string[] = [];

      manager.registerBeforeHook('failing', async () => {
        throw new Error('Hook failed');
      }, { priority: 100 });

      manager.registerBeforeHook('succeeding', async (ctx) => {
        executed.push('succeeding');
        return ctx;
      }, { priority: 50 });

      await manager.executeBeforeHooks(createContext());

      expect(executed).toEqual(['succeeding']);
    });
  });

  describe('after hook execution', () => {
    it('should execute after hooks', async () => {
      const executed: string[] = [];

      manager.registerAfterHook('hook1', async (_ctx, result) => {
        executed.push('hook1');
        return result;
      });

      const context = createContext();
      const result = createResult();

      await manager.executeAfterHooks(context, result);

      expect(executed).toEqual(['hook1']);
    });

    it('should modify result in after hooks', async () => {
      manager.registerAfterHook('modifier', async (_ctx, result) => ({
        ...result,
        output: result.output + ' [modified]',
      }));

      const context = createContext();
      const result = createResult({ output: 'original' });

      const modified = await manager.executeAfterHooks(context, result);

      expect(modified.output).toBe('original [modified]');
      expect(modified.modified).toBe(true);
    });

    it('should chain after hooks', async () => {
      manager.registerAfterHook('first', async (_ctx, result) => ({
        ...result,
        output: result.output + ' [first]',
      }), { priority: 100 });

      manager.registerAfterHook('second', async (_ctx, result) => ({
        ...result,
        output: result.output + ' [second]',
      }), { priority: 50 });

      const modified = await manager.executeAfterHooks(
        createContext(),
        createResult({ output: 'start' })
      );

      expect(modified.output).toBe('start [first] [second]');
    });
  });

  describe('persist hook execution', () => {
    it('should execute persist hooks synchronously', () => {
      manager.registerPersistHook('truncate', (_ctx, result) => ({
        ...result,
        output: result.output?.slice(0, 10),
      }));

      const result = manager.executePersistHooks(
        createContext(),
        createResult({ output: 'this is a very long output' })
      );

      expect(result.output).toBe('this is a ');
    });
  });

  describe('error hooks', () => {
    it('should execute error hooks', async () => {
      const errors: Error[] = [];

      manager.registerErrorHook('logger', async (_ctx, error) => {
        errors.push(error);
      });

      const error = new Error('Test error');
      await manager.executeErrorHooks(createContext(), error);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Test error');
    });
  });

  describe('metrics', () => {
    it('should track execution metrics', async () => {
      manager.registerBeforeHook('tracked', async (ctx) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return ctx;
      });

      await manager.executeBeforeHooks(createContext());
      await manager.executeBeforeHooks(createContext());

      const metrics = manager.getHookMetrics('tracked');

      expect(metrics).toBeDefined();
      expect(metrics!.executions).toBe(2);
      expect(metrics!.avgExecutionTimeMs).toBeGreaterThan(0);
    });
  });

  describe('events', () => {
    it('should emit hook:registered event', () => {
      const handler = jest.fn();
      manager.on('hook:registered', handler);

      manager.registerBeforeHook('test', async (ctx) => ctx);

      expect(handler).toHaveBeenCalledWith('before_tool_call', 'test');
    });

    it('should emit hook:executed event', async () => {
      const handler = jest.fn();
      manager.on('hook:executed', handler);

      manager.registerBeforeHook('test', async (ctx) => ctx);
      await manager.executeBeforeHooks(createContext());

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toBe('before_tool_call');
      expect(handler.mock.calls[0][1]).toBe('test');
    });

    it('should emit hook:error event on failure', async () => {
      const handler = jest.fn();
      manager.on('hook:error', handler);

      manager.registerBeforeHook('failing', async () => {
        throw new Error('Hook failed');
      });

      await manager.executeBeforeHooks(createContext());

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    afterEach(() => {
      resetToolHooksManager();
    });

    it('should return same instance', () => {
      const instance1 = getToolHooksManager();
      const instance2 = getToolHooksManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = getToolHooksManager();
      instance1.registerBeforeHook('test', async (ctx) => ctx);

      resetToolHooksManager();

      const instance2 = getToolHooksManager();
      expect(instance2).not.toBe(instance1);
      expect(instance2.getHookCounts().before_tool_call).toBe(0);
    });
  });
});
