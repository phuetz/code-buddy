/**
 * Unit tests for AgentRegistry
 *
 * Tests cover:
 * 1. Registry operations (register, unregister, get, getAll)
 * 2. Service registration and lifecycle
 * 3. Dependency resolution (findAgentForFile, findAgentForTask)
 * 4. Task execution
 * 5. Event emission
 * 6. Singleton pattern and cleanup
 */

import { EventEmitter } from 'events';

// Define MockAgent interface to avoid 'any' usage
interface MockAgent {
  getId: jest.Mock;
  getName: jest.Mock;
  getConfig: jest.Mock;
  canHandleExtension: jest.Mock;
  hasCapability: jest.Mock;
  getSupportedActions: jest.Mock;
  getActionHelp: jest.Mock;
  isReady: jest.Mock;
  initialize: jest.Mock;
  execute: jest.Mock;
  cleanup: jest.Mock;
}

// Mock the specialized agent modules
const mockPDFAgent = {
  getId: jest.fn().mockReturnValue('pdf-agent'),
  getName: jest.fn().mockReturnValue('PDF Agent'),
  getConfig: jest.fn().mockReturnValue({
    id: 'pdf-agent',
    name: 'PDF Agent',
    description: 'Extract text from PDF documents',
    capabilities: ['pdf-extract', 'pdf-analyze'],
    fileExtensions: ['pdf'],
  }),
  canHandleExtension: jest.fn().mockImplementation((ext: string) => ext === 'pdf'),
  hasCapability: jest.fn().mockImplementation((cap: string) =>
    ['pdf-extract', 'pdf-analyze'].includes(cap)
  ),
  getSupportedActions: jest.fn().mockReturnValue(['extract', 'metadata', 'analyze']),
  getActionHelp: jest.fn().mockImplementation((action: string) => `Help for ${action}`),
  isReady: jest.fn().mockReturnValue(false),
  initialize: jest.fn().mockResolvedValue(undefined),
  execute: jest.fn().mockResolvedValue({ success: true, output: 'PDF processed' }),
  cleanup: jest.fn().mockResolvedValue(undefined),
};

const mockExcelAgent = {
  getId: jest.fn().mockReturnValue('excel-agent'),
  getName: jest.fn().mockReturnValue('Excel Agent'),
  getConfig: jest.fn().mockReturnValue({
    id: 'excel-agent',
    name: 'Excel Agent',
    description: 'Manipulate Excel files',
    capabilities: ['excel-read', 'excel-write'],
    fileExtensions: ['xlsx', 'xls', 'csv'],
  }),
  canHandleExtension: jest.fn().mockImplementation((ext: string) =>
    ['xlsx', 'xls', 'csv'].includes(ext)
  ),
  hasCapability: jest.fn().mockImplementation((cap: string) =>
    ['excel-read', 'excel-write'].includes(cap)
  ),
  getSupportedActions: jest.fn().mockReturnValue(['read', 'write', 'convert']),
  getActionHelp: jest.fn().mockImplementation((action: string) => `Help for ${action}`),
  isReady: jest.fn().mockReturnValue(true),
  initialize: jest.fn().mockResolvedValue(undefined),
  execute: jest.fn().mockResolvedValue({ success: true, output: 'Excel processed' }),
  cleanup: jest.fn().mockResolvedValue(undefined),
};

const mockDataAnalysisAgent = {
  getId: jest.fn().mockReturnValue('data-analysis-agent'),
  getName: jest.fn().mockReturnValue('Data Analysis Agent'),
  getConfig: jest.fn().mockReturnValue({
    id: 'data-analysis-agent',
    name: 'Data Analysis Agent',
    description: 'Analyze data files',
    capabilities: ['data-transform', 'data-visualize'],
    fileExtensions: ['json', 'csv'],
  }),
  canHandleExtension: jest.fn().mockImplementation((ext: string) =>
    ['json', 'csv'].includes(ext)
  ),
  hasCapability: jest.fn().mockImplementation((cap: string) =>
    ['data-transform', 'data-visualize'].includes(cap)
  ),
  getSupportedActions: jest.fn().mockReturnValue(['analyze', 'transform', 'describe']),
  getActionHelp: jest.fn().mockImplementation((action: string) => `Help for ${action}`),
  isReady: jest.fn().mockReturnValue(true),
  initialize: jest.fn().mockResolvedValue(undefined),
  execute: jest.fn().mockResolvedValue({ success: true, output: 'Data analyzed' }),
  cleanup: jest.fn().mockResolvedValue(undefined),
};

const mockSQLAgent = {
  getId: jest.fn().mockReturnValue('sql-agent'),
  getName: jest.fn().mockReturnValue('SQL Agent'),
  getConfig: jest.fn().mockReturnValue({
    id: 'sql-agent',
    name: 'SQL Agent',
    description: 'Execute SQL queries',
    capabilities: ['sql-query'],
    fileExtensions: ['db', 'sqlite'],
  }),
  canHandleExtension: jest.fn().mockImplementation((ext: string) =>
    ['db', 'sqlite'].includes(ext)
  ),
  hasCapability: jest.fn().mockImplementation((cap: string) => cap === 'sql-query'),
  getSupportedActions: jest.fn().mockReturnValue(['query', 'tables', 'schema']),
  getActionHelp: jest.fn().mockImplementation((action: string) => `Help for ${action}`),
  isReady: jest.fn().mockReturnValue(true),
  initialize: jest.fn().mockResolvedValue(undefined),
  execute: jest.fn().mockResolvedValue({ success: true, output: 'Query executed' }),
  cleanup: jest.fn().mockResolvedValue(undefined),
};

const mockArchiveAgent = {
  getId: jest.fn().mockReturnValue('archive-agent'),
  getName: jest.fn().mockReturnValue('Archive Agent'),
  getConfig: jest.fn().mockReturnValue({
    id: 'archive-agent',
    name: 'Archive Agent',
    description: 'Manage archives',
    capabilities: ['archive-extract', 'archive-create'],
    fileExtensions: ['zip', 'tar', 'gz'],
  }),
  canHandleExtension: jest.fn().mockImplementation((ext: string) =>
    ['zip', 'tar', 'gz'].includes(ext)
  ),
  hasCapability: jest.fn().mockImplementation((cap: string) =>
    ['archive-extract', 'archive-create'].includes(cap)
  ),
  getSupportedActions: jest.fn().mockReturnValue(['extract', 'create', 'list']),
  getActionHelp: jest.fn().mockImplementation((action: string) => `Help for ${action}`),
  isReady: jest.fn().mockReturnValue(true),
  initialize: jest.fn().mockResolvedValue(undefined),
  execute: jest.fn().mockResolvedValue({ success: true, output: 'Archive processed' }),
  cleanup: jest.fn().mockResolvedValue(undefined),
};

const mockCodeGuardianAgent = {
  getId: jest.fn().mockReturnValue('code-guardian-agent'),
  getName: jest.fn().mockReturnValue('Code Guardian Agent'),
  getConfig: jest.fn().mockReturnValue({
    id: 'code-guardian-agent',
    name: 'Code Guardian Agent',
    description: 'Code analysis and review',
    capabilities: ['code-analyze', 'code-review', 'code-refactor', 'code-security'],
    fileExtensions: ['ts', 'js', 'py'],
  }),
  canHandleExtension: jest.fn().mockImplementation((ext: string) =>
    ['ts', 'js', 'py'].includes(ext)
  ),
  hasCapability: jest.fn().mockImplementation((cap: string) =>
    ['code-analyze', 'code-review', 'code-refactor', 'code-security'].includes(cap)
  ),
  getSupportedActions: jest.fn().mockReturnValue(['analyze', 'review', 'refactor', 'security-scan']),
  getActionHelp: jest.fn().mockImplementation((action: string) => `Help for ${action}`),
  isReady: jest.fn().mockReturnValue(true),
  initialize: jest.fn().mockResolvedValue(undefined),
  execute: jest.fn().mockResolvedValue({ success: true, output: 'Code reviewed' }),
  cleanup: jest.fn().mockResolvedValue(undefined),
};

// Mock the agent factory functions
jest.mock('../../src/agent/specialized/pdf-agent.js', () => ({
  getPDFAgent: jest.fn().mockReturnValue(mockPDFAgent),
}));

jest.mock('../../src/agent/specialized/excel-agent.js', () => ({
  getExcelAgent: jest.fn().mockReturnValue(mockExcelAgent),
}));

jest.mock('../../src/agent/specialized/data-analysis-agent.js', () => ({
  getDataAnalysisAgent: jest.fn().mockReturnValue(mockDataAnalysisAgent),
}));

jest.mock('../../src/agent/specialized/sql-agent.js', () => ({
  getSQLAgent: jest.fn().mockReturnValue(mockSQLAgent),
}));

jest.mock('../../src/agent/specialized/archive-agent.js', () => ({
  getArchiveAgent: jest.fn().mockReturnValue(mockArchiveAgent),
}));

jest.mock('../../src/agent/specialized/code-guardian-agent.js', () => ({
  getCodeGuardianAgent: jest.fn().mockReturnValue(mockCodeGuardianAgent),
}));

// Mock getErrorMessage
jest.mock('../../src/types/index.js', () => ({
  getErrorMessage: jest.fn().mockImplementation((error: unknown) => {
    if (error instanceof Error) return error.message;
    return String(error);
  }),
}));

import {
  AgentRegistry,
  getAgentRegistry,
  initializeAgentRegistry,
  resetAgentRegistry,
  executeSpecializedTask,
  findAgentForFile,
  getAvailableAgents,
  AgentMatch,
} from '../../src/agent/specialized/agent-registry';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    // Reset the singleton
    await resetAgentRegistry();

    // Clear all mock calls
    jest.clearAllMocks();

    // Reset mock states
    mockPDFAgent.isReady.mockReturnValue(false);
    mockExcelAgent.isReady.mockReturnValue(true);
    mockDataAnalysisAgent.isReady.mockReturnValue(true);
    mockSQLAgent.isReady.mockReturnValue(true);
    mockArchiveAgent.isReady.mockReturnValue(true);
    mockCodeGuardianAgent.isReady.mockReturnValue(true);

    // Create a fresh registry instance
    registry = new AgentRegistry();
  });

  afterEach(async () => {
    if (registry) {
      await registry.dispose();
    }
    await resetAgentRegistry();
  });

  describe('Constructor and Configuration', () => {
    it('should create registry with default configuration', () => {
      const reg = new AgentRegistry();
      expect(reg).toBeInstanceOf(AgentRegistry);
      expect(reg).toBeInstanceOf(EventEmitter);
    });

    it('should create registry with custom configuration', () => {
      const reg = new AgentRegistry({
        autoInitialize: false,
        cacheAgents: false,
      });
      expect(reg).toBeInstanceOf(AgentRegistry);
    });

    it('should merge custom config with defaults', () => {
      const reg = new AgentRegistry({ autoInitialize: false });
      expect(reg.getAll()).toHaveLength(0);
    });
  });

  describe('register()', () => {
    it('should register an agent', () => {
      registry.register(mockPDFAgent as unknown as any);
      expect(registry.get('pdf-agent')).toBe(mockPDFAgent);
    });

    it('should emit agent:registered event', () => {
      const handler = jest.fn();
      registry.on('agent:registered', handler);

      registry.register(mockPDFAgent as unknown as any);

      expect(handler).toHaveBeenCalledWith({
        id: 'pdf-agent',
        name: 'PDF Agent',
      });
    });

    it('should allow registering multiple agents', () => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
      registry.register(mockSQLAgent as unknown as any);

      expect(registry.getAll()).toHaveLength(3);
    });

    it('should overwrite existing agent with same ID', () => {
      const updatedAgent = {
        ...mockPDFAgent,
        getName: jest.fn().mockReturnValue('Updated PDF Agent'),
      };

      registry.register(mockPDFAgent as unknown as any);
      registry.register(updatedAgent as unknown as any);

      expect(registry.getAll()).toHaveLength(1);
      expect(registry.get('pdf-agent')?.getName()).toBe('Updated PDF Agent');
    });
  });

  describe('unregister()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
    });

    it('should unregister an agent', () => {
      const result = registry.unregister('pdf-agent');

      expect(result).toBe(true);
      expect(registry.get('pdf-agent')).toBeUndefined();
    });

    it('should emit agent:unregistered event', () => {
      const handler = jest.fn();
      registry.on('agent:unregistered', handler);

      registry.unregister('pdf-agent');

      expect(handler).toHaveBeenCalledWith({ id: 'pdf-agent' });
    });

    it('should return false for non-existent agent', () => {
      const result = registry.unregister('non-existent');
      expect(result).toBe(false);
    });

    it('should not emit event for non-existent agent', () => {
      const handler = jest.fn();
      registry.on('agent:unregistered', handler);

      registry.unregister('non-existent');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('get()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
    });

    it('should return agent by ID', () => {
      const agent = registry.get('pdf-agent');
      expect(agent).toBe(mockPDFAgent);
    });

    it('should return undefined for non-existent ID', () => {
      const agent = registry.get('non-existent');
      expect(agent).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    it('should return empty array when no agents registered', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('should return all registered agents', () => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
      registry.register(mockSQLAgent as unknown as any);

      const agents = registry.getAll();
      expect(agents).toHaveLength(3);
      expect(agents).toContain(mockPDFAgent);
      expect(agents).toContain(mockExcelAgent);
      expect(agents).toContain(mockSQLAgent);
    });

    it('should return a new array each time', () => {
      registry.register(mockPDFAgent as unknown as any);

      const agents1 = registry.getAll();
      const agents2 = registry.getAll();

      expect(agents1).not.toBe(agents2);
      expect(agents1).toEqual(agents2);
    });
  });

  describe('registerBuiltInAgents()', () => {
    it('should register all built-in agents', async () => {
      await registry.registerBuiltInAgents();

      expect(registry.getAll().length).toBe(6);
    });

    it('should emit agents:registered event', async () => {
      const handler = jest.fn();
      registry.on('agents:registered', handler);

      await registry.registerBuiltInAgents();

      expect(handler).toHaveBeenCalledWith({ count: 6 });
    });
  });

  describe('findAgentForFile()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
      registry.register(mockArchiveAgent as unknown as any);
    });

    it('should find agent for PDF file', () => {
      const match = registry.findAgentForFile('/path/to/document.pdf');

      expect(match).not.toBeNull();
      expect(match?.agent).toBe(mockPDFAgent);
      expect(match?.score).toBe(100);
      expect(match?.reason).toContain('pdf');
    });

    it('should find agent for Excel file', () => {
      const match = registry.findAgentForFile('/path/to/spreadsheet.xlsx');

      expect(match).not.toBeNull();
      expect(match?.agent).toBe(mockExcelAgent);
    });

    it('should find agent for CSV file', () => {
      const match = registry.findAgentForFile('/path/to/data.csv');

      expect(match).not.toBeNull();
      expect(match?.agent).toBe(mockExcelAgent);
    });

    it('should find agent for ZIP file', () => {
      const match = registry.findAgentForFile('/path/to/archive.zip');

      expect(match).not.toBeNull();
      expect(match?.agent).toBe(mockArchiveAgent);
    });

    it('should return null for unknown file type', () => {
      const match = registry.findAgentForFile('/path/to/unknown.xyz');
      expect(match).toBeNull();
    });

    it('should handle files without extension', () => {
      const match = registry.findAgentForFile('/path/to/Makefile');
      expect(match).toBeNull();
    });

    it('should handle uppercase extensions', () => {
      // The extension is normalized to lowercase
      const match = registry.findAgentForFile('/path/to/document.PDF');

      expect(match).not.toBeNull();
      expect(match?.agent).toBe(mockPDFAgent);
    });
  });

  describe('findAgentsWithCapability()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
      registry.register(mockCodeGuardianAgent as unknown as any);
    });

    it('should find agents with pdf-extract capability', () => {
      const agents = registry.findAgentsWithCapability('pdf-extract');

      expect(agents).toHaveLength(1);
      expect(agents[0]).toBe(mockPDFAgent);
    });

    it('should find agents with excel-read capability', () => {
      const agents = registry.findAgentsWithCapability('excel-read');

      expect(agents).toHaveLength(1);
      expect(agents[0]).toBe(mockExcelAgent);
    });

    it('should find agents with code-analyze capability', () => {
      const agents = registry.findAgentsWithCapability('code-analyze');

      expect(agents).toHaveLength(1);
      expect(agents[0]).toBe(mockCodeGuardianAgent);
    });

    it('should return empty array for unknown capability', () => {
      const agents = registry.findAgentsWithCapability('unknown-capability' as unknown as any);
      expect(agents).toHaveLength(0);
    });
  });

  describe('findAgentForTask()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
    });

    it('should find agent by input file', () => {
      const match = registry.findAgentForTask({
        action: 'extract',
        inputFiles: ['/path/to/document.pdf'],
      });

      expect(match).not.toBeNull();
      expect(match?.agent).toBe(mockPDFAgent);
    });

    it('should find agent by action when no files', () => {
      const match = registry.findAgentForTask({
        action: 'extract',
      });

      expect(match).not.toBeNull();
      expect(match?.score).toBe(50);
    });

    it('should return null when no matching agent', () => {
      const match = registry.findAgentForTask({
        action: 'unknown-action',
      });

      expect(match).toBeNull();
    });

    it('should prioritize file-based matching over action', () => {
      // Both agents support similar actions, but file type should determine match
      const match = registry.findAgentForTask({
        action: 'read',
        inputFiles: ['/path/to/data.xlsx'],
      });

      expect(match?.agent).toBe(mockExcelAgent);
    });
  });

  describe('execute()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
    });

    it('should execute task on matching agent', async () => {
      mockPDFAgent.isReady.mockReturnValue(true);

      const result = await registry.execute({
        action: 'extract',
        inputFiles: ['/path/to/document.pdf'],
      });

      expect(result.success).toBe(true);
      expect(mockPDFAgent.execute).toHaveBeenCalled();
    });

    it('should auto-initialize agent if not ready', async () => {
      mockPDFAgent.isReady.mockReturnValue(false);

      await registry.execute({
        action: 'extract',
        inputFiles: ['/path/to/document.pdf'],
      });

      expect(mockPDFAgent.initialize).toHaveBeenCalled();
    });

    it('should emit task:start event', async () => {
      mockPDFAgent.isReady.mockReturnValue(true);
      const handler = jest.fn();
      registry.on('task:start', handler);

      await registry.execute({
        action: 'extract',
        inputFiles: ['/path/to/document.pdf'],
      });

      expect(handler).toHaveBeenCalledWith({
        agentId: 'pdf-agent',
        task: 'extract',
      });
    });

    it('should emit task:complete event on success', async () => {
      mockPDFAgent.isReady.mockReturnValue(true);
      const handler = jest.fn();
      registry.on('task:complete', handler);

      await registry.execute({
        action: 'extract',
        inputFiles: ['/path/to/document.pdf'],
      });

      expect(handler).toHaveBeenCalledWith({
        agentId: 'pdf-agent',
        task: 'extract',
        success: true,
      });
    });

    it('should emit task:error event on failure', async () => {
      mockPDFAgent.isReady.mockReturnValue(true);
      mockPDFAgent.execute.mockRejectedValueOnce(new Error('Execution failed'));
      const handler = jest.fn();
      registry.on('task:error', handler);

      await registry.execute({
        action: 'extract',
        inputFiles: ['/path/to/document.pdf'],
      });

      expect(handler).toHaveBeenCalledWith({
        agentId: 'pdf-agent',
        task: 'extract',
        error: 'Execution failed',
      });
    });

    it('should return error when no agent found', async () => {
      const result = await registry.execute({
        action: 'unknown-action',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No agent found');
    });

    it('should return error when agent not ready after initialization', async () => {
      mockPDFAgent.isReady.mockReturnValue(false);

      const result = await registry.execute({
        action: 'extract',
        inputFiles: ['/path/to/document.pdf'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not ready');
    });
  });

  describe('executeOn()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
    });

    it('should execute task on specific agent', async () => {
      mockExcelAgent.isReady.mockReturnValue(true);

      const result = await registry.executeOn('excel-agent', {
        action: 'read',
        inputFiles: ['/path/to/spreadsheet.xlsx'],
      });

      expect(result.success).toBe(true);
      expect(mockExcelAgent.execute).toHaveBeenCalled();
    });

    it('should return error for non-existent agent', async () => {
      const result = await registry.executeOn('non-existent', {
        action: 'read',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent not found');
    });

    it('should auto-initialize if needed', async () => {
      mockExcelAgent.isReady.mockReturnValue(false);

      await registry.executeOn('excel-agent', {
        action: 'read',
      });

      expect(mockExcelAgent.initialize).toHaveBeenCalled();
    });
  });

  describe('initializeAll()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
      registry.register(mockSQLAgent as unknown as any);
    });

    it('should initialize all agents', async () => {
      const results = await registry.initializeAll();

      expect(results.get('pdf-agent')).toBe(true);
      expect(results.get('excel-agent')).toBe(true);
      expect(results.get('sql-agent')).toBe(true);
    });

    it('should handle initialization failures', async () => {
      mockPDFAgent.initialize.mockRejectedValueOnce(new Error('Init failed'));

      const results = await registry.initializeAll();

      expect(results.get('pdf-agent')).toBe(false);
      expect(results.get('excel-agent')).toBe(true);
    });
  });

  describe('getSummary()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
    });

    it('should return formatted summary', () => {
      const summary = registry.getSummary();

      expect(summary).toContain('SPECIALIZED AGENTS');
      expect(summary).toContain('PDF Agent');
      expect(summary).toContain('Excel Agent');
    });

    it('should show agent status', () => {
      mockPDFAgent.isReady.mockReturnValue(false);
      mockExcelAgent.isReady.mockReturnValue(true);

      const summary = registry.getSummary();

      // Should contain status indicators
      expect(summary).toMatch(/[○✓]/);
    });
  });

  describe('getAgentHelp()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
    });

    it('should return help for existing agent', () => {
      const help = registry.getAgentHelp('pdf-agent');

      expect(help).not.toBeNull();
      expect(help).toContain('PDF Agent');
      expect(help).toContain('pdf');
      expect(help).toContain('extract');
    });

    it('should return null for non-existent agent', () => {
      const help = registry.getAgentHelp('non-existent');
      expect(help).toBeNull();
    });
  });

  describe('cleanup()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
      registry.register(mockExcelAgent as unknown as any);
    });

    it('should cleanup all agents', async () => {
      await registry.cleanup();

      expect(mockPDFAgent.cleanup).toHaveBeenCalled();
      expect(mockExcelAgent.cleanup).toHaveBeenCalled();
    });

    it('should clear agents map', async () => {
      await registry.cleanup();
      expect(registry.getAll()).toHaveLength(0);
    });

    it('should emit cleanup event', async () => {
      const handler = jest.fn();
      registry.on('cleanup', handler);

      await registry.cleanup();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    beforeEach(() => {
      registry.register(mockPDFAgent as unknown as any);
    });

    it('should cleanup and remove all listeners', async () => {
      const handler = jest.fn();
      registry.on('agent:registered', handler);

      await registry.dispose();

      expect(mockPDFAgent.cleanup).toHaveBeenCalled();
      expect(registry.listenerCount('agent:registered')).toBe(0);
    });
  });
});

describe('Singleton Functions', () => {
  beforeEach(async () => {
    await resetAgentRegistry();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await resetAgentRegistry();
  });

  describe('getAgentRegistry()', () => {
    it('should return AgentRegistry instance', () => {
      const registry = getAgentRegistry();
      expect(registry).toBeInstanceOf(AgentRegistry);
    });

    it('should return same instance on multiple calls', () => {
      const registry1 = getAgentRegistry();
      const registry2 = getAgentRegistry();
      expect(registry1).toBe(registry2);
    });
  });

  describe('initializeAgentRegistry()', () => {
    it('should initialize and return registry', async () => {
      const registry = await initializeAgentRegistry();

      expect(registry).toBeInstanceOf(AgentRegistry);
      expect(registry.getAll().length).toBeGreaterThan(0);
    });

    it('should register built-in agents', async () => {
      const registry = await initializeAgentRegistry();

      // Should have all 6 built-in agents
      expect(registry.getAll().length).toBe(6);
    });
  });

  describe('resetAgentRegistry()', () => {
    it('should reset the singleton', async () => {
      const registry1 = getAgentRegistry();
      await resetAgentRegistry();
      const registry2 = getAgentRegistry();

      expect(registry1).not.toBe(registry2);
    });

    it('should dispose existing registry', async () => {
      const registry = getAgentRegistry();
      registry.register(mockPDFAgent as unknown as any);

      await resetAgentRegistry();

      expect(mockPDFAgent.cleanup).toHaveBeenCalled();
    });
  });
});

describe('Convenience Functions', () => {
  beforeEach(async () => {
    await resetAgentRegistry();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await resetAgentRegistry();
  });

  describe('executeSpecializedTask()', () => {
    it('should execute task using global registry', async () => {
      mockExcelAgent.isReady.mockReturnValue(true);

      const result = await executeSpecializedTask({
        action: 'read',
        inputFiles: ['/path/to/spreadsheet.xlsx'],
      });

      expect(result.success).toBe(true);
    });

    it('should auto-register built-in agents if needed', async () => {
      const registry = getAgentRegistry();
      expect(registry.getAll()).toHaveLength(0);

      await executeSpecializedTask({
        action: 'read',
        inputFiles: ['/path/to/spreadsheet.xlsx'],
      });

      expect(registry.getAll().length).toBeGreaterThan(0);
    });
  });

  describe('findAgentForFile()', () => {
    it('should find agent for file using global registry', async () => {
      await initializeAgentRegistry();

      const agent = findAgentForFile('/path/to/document.pdf');

      expect(agent).not.toBeNull();
      expect(agent?.getId()).toBe('pdf-agent');
    });

    it('should return null when no agent matches', async () => {
      await initializeAgentRegistry();

      const agent = findAgentForFile('/path/to/unknown.xyz');
      expect(agent).toBeNull();
    });
  });

  describe('getAvailableAgents()', () => {
    it('should return list of available agents', async () => {
      await initializeAgentRegistry();

      const agents = getAvailableAgents();

      expect(agents.length).toBe(6);
      expect(agents[0]).toHaveProperty('id');
      expect(agents[0]).toHaveProperty('name');
      expect(agents[0]).toHaveProperty('description');
      expect(agents[0]).toHaveProperty('extensions');
      expect(agents[0]).toHaveProperty('capabilities');
    });

    it('should return empty array when no agents registered', () => {
      const agents = getAvailableAgents();
      expect(agents).toEqual([]);
    });
  });
});

describe('Event Handling', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await resetAgentRegistry();
    jest.clearAllMocks();
    registry = new AgentRegistry();
  });

  afterEach(async () => {
    await registry.dispose();
  });

  it('should support multiple listeners for same event', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    registry.on('agent:registered', handler1);
    registry.on('agent:registered', handler2);

    registry.register(mockPDFAgent as unknown as any);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('should allow removing listeners', () => {
    const handler = jest.fn();

    registry.on('agent:registered', handler);
    registry.off('agent:registered', handler);

    registry.register(mockPDFAgent as unknown as any);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support once listeners', () => {
    const handler = jest.fn();

    registry.once('agent:registered', handler);

    registry.register(mockPDFAgent as unknown as any);
    registry.register(mockExcelAgent as unknown as any);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('Edge Cases', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await resetAgentRegistry();
    jest.clearAllMocks();
    registry = new AgentRegistry();
  });

  afterEach(async () => {
    await registry.dispose();
  });

  it('should handle empty file path', () => {
    registry.register(mockPDFAgent as unknown as any);

    const match = registry.findAgentForFile('');
    expect(match).toBeNull();
  });

  it('should handle path with multiple dots', () => {
    registry.register(mockArchiveAgent as unknown as any);

    const match = registry.findAgentForFile('/path/to/file.backup.tar.gz');
    // Should match based on last extension 'gz'
    expect(match).not.toBeNull();
    expect(match?.agent).toBe(mockArchiveAgent);
  });

  it('should handle agent with execution error', async () => {
    registry.register(mockPDFAgent as unknown as any);
    mockPDFAgent.isReady.mockReturnValue(true);
    mockPDFAgent.execute.mockRejectedValueOnce(new Error('Processing failed'));

    const result = await registry.execute({
      action: 'extract',
      inputFiles: ['/path/to/document.pdf'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent error');
  });

  it('should handle rapid registration and unregistration', () => {
    for (let i = 0; i < 100; i++) {
      registry.register(mockPDFAgent as unknown as any);
      registry.unregister('pdf-agent');
    }

    expect(registry.getAll()).toHaveLength(0);
  });

  it('should handle task with empty inputFiles array', () => {
    registry.register(mockPDFAgent as unknown as any);

    const match = registry.findAgentForTask({
      action: 'extract',
      inputFiles: [],
    });

    // Should fall back to action-based matching
    expect(match).not.toBeNull();
    expect(match?.score).toBe(50);
  });

  it('should handle concurrent task executions', async () => {
    registry.register(mockExcelAgent as unknown as any);
    mockExcelAgent.isReady.mockReturnValue(true);

    const tasks = Array(10).fill(null).map((_, i) =>
      registry.execute({
        action: 'read',
        inputFiles: [`/path/to/file${i}.xlsx`],
      })
    );

    const results = await Promise.all(tasks);

    expect(results.every(r => r.success)).toBe(true);
    expect(mockExcelAgent.execute).toHaveBeenCalledTimes(10);
  });

  it('should handle agent with no supported actions', () => {
    const emptyAgent = {
      ...mockPDFAgent,
      getId: () => 'empty-agent',
      getSupportedActions: () => [],
    };

    registry.register(emptyAgent as unknown as any);

    const match = registry.findAgentForTask({
      action: 'some-action',
    });

    expect(match).toBeNull();
  });
});

describe('Configuration Options', () => {
  it('should respect autoInitialize: false', async () => {
    const registry = new AgentRegistry({ autoInitialize: false });
    registry.register(mockPDFAgent as unknown as any);
    mockPDFAgent.isReady.mockReturnValue(false);

    const result = await registry.execute({
      action: 'extract',
      inputFiles: ['/path/to/document.pdf'],
    });

    // Should not auto-initialize
    expect(mockPDFAgent.initialize).not.toHaveBeenCalled();
    expect(result.success).toBe(false);

    await registry.dispose();
  });

  it('should auto-initialize with default config', async () => {
    const registry = new AgentRegistry(); // Default config
    registry.register(mockPDFAgent as unknown as any);
    mockPDFAgent.isReady.mockReturnValue(false);

    await registry.execute({
      action: 'extract',
      inputFiles: ['/path/to/document.pdf'],
    });

    // Should auto-initialize
    expect(mockPDFAgent.initialize).toHaveBeenCalled();

    await registry.dispose();
  });
});
