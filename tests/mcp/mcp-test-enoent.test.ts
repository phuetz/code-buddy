import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMCPCommand } from '../../src/commands/mcp.js';
import { getMCPManager } from '../../src/codebuddy/tools.js';
import * as mcpConfig from '../../src/mcp/config.js';
import { logger } from '../../src/utils/logger.js';

// Mock everything needed for CLI tests
vi.mock('../../src/mcp/config.js');
vi.mock('../../src/codebuddy/tools.js');
vi.mock('../../src/utils/logger.js');

describe('mcp test <name>', () => {
  let mockExit: any;
  let mockManager: any;

  beforeEach(() => {
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    mockManager = {
      addServer: vi.fn(),
      getTools: vi.fn().mockReturnValue([]),
      removeServer: vi.fn()
    };

    vi.mocked(getMCPManager).mockReturnValue(mockManager as any);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.error).mockClear();
  });

  it('provides actionable message for ENOENT on code-explorer', async () => {
    const error = new Error('spawn code-explorer ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';

    mockManager.addServer.mockRejectedValue(error);

    vi.mocked(mcpConfig.loadMCPConfig).mockReturnValue({
      servers: [{
        name: 'code-explorer',
        transport: { type: 'stdio', command: 'code-explorer' }
      }]
    });

    const cmd = createMCPCommand();
    await cmd.parseAsync(['node', 'test', 'test', 'code-explorer']);

    expect(mockExit).toHaveBeenCalledWith(1);

    // Check logger.error calls
    const calls = vi.mocked(logger.error).mock.calls;
    const msg = calls[0]?.[0];

    expect(msg).toContain('command "code-explorer" not found in PATH');
    expect(msg).toContain('docs/code-explorer-integration.md');
    expect(msg).not.toContain('spawn code-explorer ENOENT');
  });

  it('provides actionable message for ENOENT on generic server', async () => {
    const error = new Error('spawn definitely-not-a-binary-xyz ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';

    mockManager.addServer.mockRejectedValue(error);

    vi.mocked(mcpConfig.loadMCPConfig).mockReturnValue({
      servers: [{
        name: 'test-server',
        transport: { type: 'stdio', command: 'definitely-not-a-binary-xyz' }
      }]
    });

    const cmd = createMCPCommand();
    await cmd.parseAsync(['node', 'test', 'test', 'test-server']);

    expect(mockExit).toHaveBeenCalledWith(1);

    // Check logger.error calls
    const calls = vi.mocked(logger.error).mock.calls;
    const msg = calls[0]?.[0];

    expect(msg).toContain('command "definitely-not-a-binary-xyz" not found in PATH');
    expect(msg).not.toContain('spawn definitely-not-a-binary-xyz ENOENT');
  });
});
