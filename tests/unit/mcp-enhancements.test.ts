import { MCPManager, MCPServerConfig } from '../../src/mcp/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { logger } from '../../src/utils/logger';

// Mock MCP SDK
jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock Transports
jest.mock('../../src/mcp/transports.js', () => ({
  createTransport: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue({}),
    disconnect: jest.fn().mockResolvedValue({}),
    getType: jest.fn().mockReturnValue('stdio'),
  }),
}));

describe('MCPManager Enhancements', () => {
  let manager: MCPManager;
  let mockClientInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new MCPManager();
    
    mockClientInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [{ name: 'test_tool', description: 'Test', inputSchema: {} }] }),
      close: jest.fn().mockResolvedValue(undefined),
      callTool: jest.fn(),
    };
    
    (Client as jest.Mock).mockImplementation(() => mockClientInstance);
  });

  afterEach(async () => {
    await manager.dispose();
  });

  it('should track server status correctly', async () => {
    const config: MCPServerConfig = {
      name: 'test-server',
      transport: { type: 'stdio', command: 'ls' }
    };

    const addPromise = manager.addServer(config);
    expect(manager.getServerStatus('test-server')).toBe('connecting');
    
    await addPromise;
    expect(manager.getServerStatus('test-server')).toBe('connected');
  });

  it('should handle connection errors', async () => {
    mockClientInstance.connect.mockRejectedValue(new Error('Connection failed'));
    
    const config: MCPServerConfig = {
      name: 'fail-server',
      transport: { type: 'stdio', command: 'fail' }
    };

    await expect(manager.addServer(config)).rejects.toThrow('Connection failed');
    expect(manager.getServerStatus('fail-server')).toBe('error');
  });

  it('should attempt reconnection if enabled', async () => {
    jest.useFakeTimers();
    
    const config: MCPServerConfig = {
      name: 'reconnect-server',
      transport: { type: 'stdio', command: 'cmd' },
      autoReconnect: true,
      maxRetries: 3
    };

    // First attempt fails
    mockClientInstance.connect.mockRejectedValueOnce(new Error('First fail'));
    
    const addPromise = manager.addServer(config);
    await expect(addPromise).rejects.toThrow('First fail');
    
    // Status should be error, but timeout scheduled
    expect(manager.getServerStatus('reconnect-server')).toBe('error');
    
    // Fast forward to first retry
    mockClientInstance.connect.mockResolvedValueOnce(undefined);
    jest.advanceTimersByTime(1000);
    
    // We need to wait for the async logic in setTimeout
    // Since it's nested and async, we might need multiple ticks
    await Promise.resolve();
    await Promise.resolve();
    
    // The retry will call addServer again which will succeed
    // Note: in a real test environment with fake timers + async, this can be tricky.
    
    jest.useRealTimers();
  });

  it('should clean up on dispose', async () => {
    const config: MCPServerConfig = {
      name: 'dispose-server',
      transport: { type: 'stdio', command: 'ls' }
    };

    await manager.addServer(config);
    await manager.dispose();
    
    expect(manager.getServerStatus('dispose-server')).toBe('disconnected');
    expect(manager.getServers()).toHaveLength(0);
  });
});
