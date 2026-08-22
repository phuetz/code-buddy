import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InfrastructureFacade } from '../../src/agent/facades/infrastructure-facade.js';
import { HooksManager } from '../../src/hooks/lifecycle-hooks.js';
import { ToolHandler } from '../../src/agent/tool-handler.js';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Extensible Lifecycle Hooks (Axe 4)', () => {
  let tempDir: string;
  let hooksManager: HooksManager;
  let facade: InfrastructureFacade;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
    hooksManager = new HooksManager(tempDir);
    facade = new InfrastructureFacade({
      mcpClient: {} as any,
      sandboxManager: {} as any,
      hooksManager,
      promptCacheManager: {} as any,
      marketplace: {} as any,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    vi.restoreAllMocks();
  });

  describe('InfrastructureFacade Interface', () => {
    it('executes beforeToolCall hooks and correctly modifies arguments or aborts', async () => {
      hooksManager.registerHook({
        name: 'test-before-tool',
        type: 'before-tool-call',
        enabled: true,
        timeout: 5000,
        failOnError: true,
        handler: async (ctx) => {
          return {
            success: true,
            duration: 10,
            modified: {
              toolArgs: {
                ...ctx.toolArgs,
                injectedArg: 'modified-value',
              },
            },
          };
        },
      });

      const { abort, modifiedArgs } = await facade.beforeToolCall('some_tool', { base: 'value' });
      expect(abort).toBe(false);
      expect(modifiedArgs).toEqual({ base: 'value', injectedArg: 'modified-value' });
    });

    it('can abort tool call through beforeToolCall', async () => {
      hooksManager.registerHook({
        name: 'abort-tool',
        type: 'before-tool-call',
        enabled: true,
        timeout: 5000,
        failOnError: true,
        handler: async () => {
          return {
            success: true,
            duration: 10,
            abort: true,
          };
        },
      });

      const { abort } = await facade.beforeToolCall('some_tool', {});
      expect(abort).toBe(true);
    });

    it('executes beforeMemoryWrite and can abort or modify memory content', async () => {
      hooksManager.registerHook({
        name: 'test-before-memory',
        type: 'before-memory-write',
        enabled: true,
        timeout: 5000,
        failOnError: true,
        handler: async (ctx) => {
          return {
            success: true,
            duration: 10,
            modified: {
              content: ctx.content + '\n# Modified by Hook',
            },
          };
        },
      });

      const { abort, modifiedContent } = await facade.beforeMemoryWrite('file.md', '# Initial Content');
      expect(abort).toBe(false);
      expect(modifiedContent).toBe('# Initial Content\n# Modified by Hook');
    });
  });

  describe('ToolHandler Integration', () => {
    it('triggers before-tool-call and after-tool-call during executeTool', async () => {
      const executeHooksSpy = vi.spyOn(hooksManager, 'executeHooks');

      const handler = new ToolHandler({
        checkpointManager: {
          checkpointBeforeCreate: vi.fn(),
          checkpointBeforeEdit: vi.fn(),
        } as never,
        hooksManager,
        marketplace: {
          executeTool: vi.fn(),
        } as never,
        repairCoordinator: {
          isRepairEnabled: vi.fn(() => false),
        } as never,
      });

      // Stub executeRegistryTool to avoid running actual side effects
      vi.spyOn(handler as any, 'executeRegistryTool').mockResolvedValue({
        success: true,
        output: 'Tool Executed Successfully',
      });

      // Register the tool with the registry mock if needed, or target a registered tool
      (handler as any).registry.has = () => true;

      const result = await handler.executeTool({
        id: 'test-tool-call-1',
        type: 'function',
        function: {
          name: 'view_file',
          arguments: JSON.stringify({ path: 'dummy.txt' }),
        },
      });

      expect(result.success).toBe(true);

      // Verify before-tool-call hook was executed
      expect(executeHooksSpy).toHaveBeenCalledWith('before-tool-call', expect.objectContaining({
        toolName: 'view_file',
        toolArgs: expect.objectContaining({ path: 'dummy.txt' }),
      }));

      // Verify after-tool-call hook was executed
      expect(executeHooksSpy).toHaveBeenCalledWith('after-tool-call', expect.objectContaining({
        toolName: 'view_file',
        output: 'Tool Executed Successfully',
      }));
    });
  });

  describe('PersistentMemoryManager Integration', () => {
    it('triggers before-memory-write hook before saving memory to disk', async () => {
      const { getHooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
      const activeHooksManager = getHooksManager();

      const projectMemFile = path.join(tempDir, 'project-memory.md');
      const userMemFile = path.join(tempDir, 'user-memory.md');

      const memoryManager = new PersistentMemoryManager({
        projectMemoryPath: projectMemFile,
        userMemoryPath: userMemFile,
        autoCapture: false,
      });

      // Register hook that modifies memory content
      activeHooksManager.registerHook({
        name: 'memory-modifier',
        type: 'before-memory-write',
        enabled: true,
        timeout: 5000,
        failOnError: true,
        handler: async (ctx) => {
          return {
            success: true,
            duration: 10,
            modified: {
              content: ctx.content + '\n# Modified memory block',
            },
          };
        },
      });

      try {
        await memoryManager.initialize();
        await memoryManager.remember('myKey', 'myValue', { scope: 'project' });

        // Check on-disk content
        const diskContent = fs.readFileSync(projectMemFile, 'utf-8');
        expect(diskContent).toContain('# Modified memory block');
      } finally {
        activeHooksManager.unregisterHook('memory-modifier');
      }
    });
  });
});
