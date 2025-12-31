/**
 * Unit tests for MCP Configuration Management
 *
 * Tests for the Model Context Protocol configuration functions
 * including loading, saving, adding, removing servers, and
 * handling multiple configuration sources.
 */

import path from 'path';
import os from 'os';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Mock os
jest.mock('os', () => ({
  homedir: jest.fn(() => '/home/testuser'),
}));

// Mock settings manager
const mockLoadProjectSettings = jest.fn();
const mockUpdateProjectSetting = jest.fn();
jest.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: jest.fn(() => ({
    loadProjectSettings: mockLoadProjectSettings,
    updateProjectSetting: mockUpdateProjectSetting,
  })),
}));

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import fs from 'fs';
import {
  MCPConfig,
  loadMCPConfig,
  saveMCPConfig,
  addMCPServer,
  removeMCPServer,
  getMCPServer,
  PREDEFINED_SERVERS,
  saveProjectMCPConfig,
  createMCPConfigTemplate,
  hasProjectMCPConfig,
  getMCPConfigPaths,
} from '../../src/mcp/config';
import { MCPServerConfig } from '../../src/mcp/client';
import { logger } from '../../src/utils/logger';

describe('loadMCPConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readFileSync as jest.Mock).mockReturnValue('{}');
    mockLoadProjectSettings.mockReturnValue({});
  });

  describe('Priority Loading', () => {
    it('should return empty servers array when no configs exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockLoadProjectSettings.mockReturnValue({});

      const config = loadMCPConfig();

      expect(config.servers).toEqual([]);
    });

    it('should load project-level mcp.json with highest priority', () => {
      const projectConfig = {
        mcpServers: {
          'project-server': {
            transport: { type: 'stdio', command: 'node' },
          },
        },
      };

      // Match .codebuddy/mcp.json or .codebuddy\mcp.json but not in home directory
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        const isProjectMCP = p.includes('.codebuddy') && p.includes('mcp.json') && !p.includes('testuser');
        return isProjectMCP;
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(projectConfig));
      mockLoadProjectSettings.mockReturnValue({});

      const config = loadMCPConfig();

      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].name).toBe('project-server');
    });

    it('should support servers key in project mcp.json', () => {
      const projectConfig = {
        servers: {
          'alt-server': {
            transport: { type: 'http', url: 'http://localhost:3000' },
          },
        },
      };

      // Match .codebuddy/mcp.json or .codebuddy\mcp.json but not in home directory
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        const isProjectMCP = p.includes('.codebuddy') && p.includes('mcp.json') && !p.includes('testuser');
        return isProjectMCP;
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(projectConfig));
      mockLoadProjectSettings.mockReturnValue({});

      const config = loadMCPConfig();

      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].name).toBe('alt-server');
    });

    it('should load from project settings as second priority', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockLoadProjectSettings.mockReturnValue({
        mcpServers: {
          'settings-server': {
            name: 'settings-server',
            transport: { type: 'stdio', command: 'python' },
          },
        },
      });

      const config = loadMCPConfig();

      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].name).toBe('settings-server');
    });

    it('should load user-level mcp.json as lowest priority', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p.includes('testuser') && p.includes('.codebuddy') && p.includes('mcp.json');
      });

      const userConfig = {
        mcpServers: {
          'user-server': {
            transport: { type: 'stdio', command: 'node' },
          },
        },
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(userConfig));
      mockLoadProjectSettings.mockReturnValue({});

      const config = loadMCPConfig();

      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].name).toBe('user-server');
    });

    it('should merge configs from all sources without duplicates', () => {
      const projectMCPConfig = {
        mcpServers: {
          'project-server': { transport: { type: 'stdio', command: 'node' } },
          'shared-server': { transport: { type: 'stdio', command: 'node' } },
        },
      };

      const userMCPConfig = {
        mcpServers: {
          'user-server': { transport: { type: 'stdio', command: 'python' } },
          'shared-server': { transport: { type: 'http', url: 'http://old' } }, // Should be skipped
        },
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes('testuser')) {
          return JSON.stringify(userMCPConfig);
        }
        return JSON.stringify(projectMCPConfig);
      });
      mockLoadProjectSettings.mockReturnValue({});

      const config = loadMCPConfig();

      expect(config.servers).toHaveLength(3);
      const serverNames = config.servers.map((s) => s.name);
      expect(serverNames).toContain('project-server');
      expect(serverNames).toContain('shared-server');
      expect(serverNames).toContain('user-server');

      // shared-server should use project config (higher priority)
      const sharedServer = config.servers.find((s) => s.name === 'shared-server');
      expect(sharedServer?.transport?.type).toBe('stdio');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON in project mcp.json gracefully', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p.includes('.codebuddy') && p.includes('mcp.json') && !p.includes('testuser');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('{ invalid json }');
      mockLoadProjectSettings.mockReturnValue({});

      const config = loadMCPConfig();

      expect(config.servers).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to load project MCP config',
        expect.any(Object)
      );
    });

    it('should silently ignore user config errors', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p.includes('testuser') && p.includes('.codebuddy') && p.includes('mcp.json');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('{ bad json }');
      mockLoadProjectSettings.mockReturnValue({});

      const config = loadMCPConfig();

      expect(config.servers).toEqual([]);
      // User config errors should be silently ignored
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle file read errors gracefully', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p.includes('.codebuddy') && p.includes('mcp.json') && !p.includes('testuser');
      });
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });
      mockLoadProjectSettings.mockReturnValue({});

      const config = loadMCPConfig();

      expect(config.servers).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});

describe('saveMCPConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should convert servers array to object and save', () => {
    const config: MCPConfig = {
      servers: [
        {
          name: 'server1',
          transport: { type: 'stdio', command: 'node' },
        } as MCPServerConfig,
        {
          name: 'server2',
          transport: { type: 'http', url: 'http://localhost:3000' },
        } as MCPServerConfig,
      ],
    };

    saveMCPConfig(config);

    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {
      server1: expect.objectContaining({ name: 'server1' }),
      server2: expect.objectContaining({ name: 'server2' }),
    });
  });

  it('should handle empty servers array', () => {
    const config: MCPConfig = {
      servers: [],
    };

    saveMCPConfig(config);

    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {});
  });
});

describe('addMCPServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadProjectSettings.mockReturnValue({});
  });

  it('should add new server to existing config', () => {
    mockLoadProjectSettings.mockReturnValue({
      mcpServers: {
        existing: { name: 'existing', transport: { type: 'stdio', command: 'node' } },
      },
    });

    const newServer: MCPServerConfig = {
      name: 'new-server',
      transport: { type: 'http', url: 'http://localhost:8080' },
    };

    addMCPServer(newServer);

    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {
      existing: expect.any(Object),
      'new-server': newServer,
    });
  });

  it('should create mcpServers if not exists', () => {
    mockLoadProjectSettings.mockReturnValue({});

    const newServer: MCPServerConfig = {
      name: 'first-server',
      transport: { type: 'stdio', command: 'python' },
    };

    addMCPServer(newServer);

    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {
      'first-server': newServer,
    });
  });

  it('should overwrite existing server with same name', () => {
    mockLoadProjectSettings.mockReturnValue({
      mcpServers: {
        'overwrite-me': { name: 'overwrite-me', transport: { type: 'stdio', command: 'old' } },
      },
    });

    const updatedServer: MCPServerConfig = {
      name: 'overwrite-me',
      transport: { type: 'http', url: 'http://new-url' },
    };

    addMCPServer(updatedServer);

    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {
      'overwrite-me': updatedServer,
    });
  });
});

describe('removeMCPServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should remove server from config', () => {
    mockLoadProjectSettings.mockReturnValue({
      mcpServers: {
        'keep-me': { name: 'keep-me', transport: { type: 'stdio', command: 'node' } },
        'remove-me': { name: 'remove-me', transport: { type: 'http', url: 'http://localhost' } },
      },
    });

    removeMCPServer('remove-me');

    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {
      'keep-me': expect.any(Object),
    });
  });

  it('should handle removing non-existent server', () => {
    mockLoadProjectSettings.mockReturnValue({
      mcpServers: {
        'existing': { name: 'existing', transport: { type: 'stdio', command: 'node' } },
      },
    });

    removeMCPServer('non-existent');

    // Should still call update but with same config
    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {
      'existing': expect.any(Object),
    });
  });

  it('should handle empty mcpServers', () => {
    mockLoadProjectSettings.mockReturnValue({});

    removeMCPServer('any-server');

    // Should not call update if mcpServers is undefined
    expect(mockUpdateProjectSetting).not.toHaveBeenCalled();
  });
});

describe('getMCPServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return server config by name', () => {
    const serverConfig = {
      name: 'my-server',
      transport: { type: 'stdio', command: 'node', args: ['server.js'] },
    };

    mockLoadProjectSettings.mockReturnValue({
      mcpServers: {
        'my-server': serverConfig,
      },
    });

    const result = getMCPServer('my-server');

    expect(result).toEqual(serverConfig);
  });

  it('should return undefined for non-existent server', () => {
    mockLoadProjectSettings.mockReturnValue({
      mcpServers: {
        'other-server': { name: 'other-server' },
      },
    });

    const result = getMCPServer('non-existent');

    expect(result).toBeUndefined();
  });

  it('should return undefined when mcpServers is undefined', () => {
    mockLoadProjectSettings.mockReturnValue({});

    const result = getMCPServer('any-server');

    expect(result).toBeUndefined();
  });
});

describe('PREDEFINED_SERVERS', () => {
  it('should be an empty object by default', () => {
    expect(PREDEFINED_SERVERS).toEqual({});
  });

  it('should be a Record type', () => {
    expect(typeof PREDEFINED_SERVERS).toBe('object');
  });
});

describe('saveProjectMCPConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('should create directory if not exists', () => {
    const servers: Record<string, MCPServerConfig> = {
      'test-server': {
        name: 'test-server',
        transport: { type: 'stdio', command: 'node' },
      },
    };

    saveProjectMCPConfig(servers);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.codebuddy'),
      { recursive: true }
    );
  });

  it('should not create directory if exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const servers: Record<string, MCPServerConfig> = {};

    saveProjectMCPConfig(servers);

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it('should write config with mcpServers key', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const servers: Record<string, MCPServerConfig> = {
      'my-server': {
        name: 'my-server',
        transport: { type: 'http', url: 'http://localhost:3000' },
      },
    };

    saveProjectMCPConfig(servers);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('mcp.json'),
      expect.stringContaining('"mcpServers"')
    );
  });

  it('should return the config path', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = saveProjectMCPConfig({});

    expect(result).toContain('.codebuddy');
    expect(result).toContain('mcp.json');
  });

  it('should format JSON with 2-space indentation', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const servers: Record<string, MCPServerConfig> = {
      'server': { name: 'server', transport: { type: 'stdio', command: 'node' } },
    };

    saveProjectMCPConfig(servers);

    const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
    expect(writtenContent).toContain('  '); // 2-space indent
    expect(writtenContent).toContain('\n');
  });
});

describe('createMCPConfigTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('should create directory if not exists', () => {
    createMCPConfigTemplate();

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.codebuddy'),
      { recursive: true }
    );
  });

  it('should create template with $schema', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    createMCPConfigTemplate();

    const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
    expect(writtenContent).toContain('"$schema"');
    expect(writtenContent).toContain('json-schema.org');
  });

  it('should create template with description', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    createMCPConfigTemplate();

    const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
    expect(writtenContent).toContain('"description"');
    expect(writtenContent).toContain('MCP server configuration');
  });

  it('should include example-stdio server template', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    createMCPConfigTemplate();

    const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
    expect(writtenContent).toContain('"example-stdio"');
    expect(writtenContent).toContain('"type": "stdio"');
    expect(writtenContent).toContain('"command": "npx"');
    expect(writtenContent).toContain('@example/mcp-server');
  });

  it('should include example-http server template', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    createMCPConfigTemplate();

    const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
    expect(writtenContent).toContain('"example-http"');
    expect(writtenContent).toContain('"type": "http"');
    expect(writtenContent).toContain('"url": "http://localhost:3000/mcp"');
  });

  it('should set example servers as disabled by default', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    createMCPConfigTemplate();

    const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
    const config = JSON.parse(writtenContent);

    expect(config.mcpServers['example-stdio'].enabled).toBe(false);
    expect(config.mcpServers['example-http'].enabled).toBe(false);
  });

  it('should return the config path', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = createMCPConfigTemplate();

    expect(result).toContain('.codebuddy');
    expect(result).toContain('mcp.json');
  });
});

describe('hasProjectMCPConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return true when config exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = hasProjectMCPConfig();

    expect(result).toBe(true);
    expect(fs.existsSync).toHaveBeenCalledWith(
      expect.stringContaining('mcp.json')
    );
  });

  it('should return false when config does not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const result = hasProjectMCPConfig();

    expect(result).toBe(false);
  });

  it('should check the correct path', () => {
    hasProjectMCPConfig();

    expect(fs.existsSync).toHaveBeenCalledWith(
      expect.stringContaining('mcp.json')
    );
  });
});

describe('getMCPConfigPaths', () => {
  it('should return project and user paths', () => {
    const paths = getMCPConfigPaths();

    expect(paths).toHaveProperty('project');
    expect(paths).toHaveProperty('user');
  });

  it('should return project path in cwd', () => {
    const paths = getMCPConfigPaths();

    expect(paths.project).toContain('.codebuddy');
    expect(paths.project).toContain('mcp.json');
  });

  it('should return user path in homedir', () => {
    const paths = getMCPConfigPaths();

    expect(paths.user).toContain('testuser');
    expect(paths.user).toContain('.codebuddy');
    expect(paths.user).toContain('mcp.json');
  });
});

describe('MCPConfig Interface', () => {
  it('should have servers array', () => {
    const config: MCPConfig = {
      servers: [],
    };

    expect(config.servers).toEqual([]);
  });

  it('should support MCPServerConfig items', () => {
    const config: MCPConfig = {
      servers: [
        {
          name: 'test',
          transport: { type: 'stdio', command: 'node' },
        } as MCPServerConfig,
      ],
    };

    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].name).toBe('test');
  });
});

describe('Integration Scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    mockLoadProjectSettings.mockReturnValue({});
  });

  describe('Full workflow', () => {
    it('should add, get, and remove server', () => {
      // Setup initial state
      let currentServers: Record<string, any> = {};
      mockLoadProjectSettings.mockImplementation(() => ({
        mcpServers: currentServers,
      }));
      mockUpdateProjectSetting.mockImplementation((key, value) => {
        if (key === 'mcpServers') {
          currentServers = value;
        }
      });

      // Add server
      const newServer: MCPServerConfig = {
        name: 'workflow-server',
        transport: { type: 'stdio', command: 'node' },
      };
      addMCPServer(newServer);

      // Get server
      const retrieved = getMCPServer('workflow-server');
      expect(retrieved).toEqual(newServer);

      // Remove server
      removeMCPServer('workflow-server');

      // Verify removed
      const afterRemoval = getMCPServer('workflow-server');
      expect(afterRemoval).toBeUndefined();
    });

    it('should handle config from multiple sources correctly', () => {
      // Project MCP config
      const projectMCP = {
        mcpServers: {
          'project-only': { transport: { type: 'stdio', command: 'proj' } },
        },
      };

      // Settings config
      const settingsServers = {
        'settings-only': {
          name: 'settings-only',
          transport: { type: 'http', url: 'http://settings' },
        },
      };

      // User MCP config
      const userMCP = {
        mcpServers: {
          'user-only': { transport: { type: 'stdio', command: 'user' } },
        },
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes('testuser')) {
          return JSON.stringify(userMCP);
        }
        return JSON.stringify(projectMCP);
      });
      mockLoadProjectSettings.mockReturnValue({ mcpServers: settingsServers });

      const config = loadMCPConfig();

      expect(config.servers).toHaveLength(3);
      expect(config.servers.map((s) => s.name)).toEqual([
        'project-only',
        'settings-only',
        'user-only',
      ]);
    });
  });

  describe('Template creation and detection', () => {
    it('should create template and detect its presence', () => {
      // Initially no config
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(hasProjectMCPConfig()).toBe(false);

      // Create template (mock writeFileSync to update existsSync behavior)
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        // After first write, return true for directory check
        return (fs.writeFileSync as jest.Mock).mock.calls.length > 0;
      });

      createMCPConfigTemplate();

      // Now detect config
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      expect(hasProjectMCPConfig()).toBe(true);
    });
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    mockLoadProjectSettings.mockReturnValue({});
  });

  it('should handle empty mcpServers object in project config', () => {
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      return p.includes('.codebuddy') && p.includes('mcp.json') && !p.includes('testuser');
    });
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
      mcpServers: {},
    }));

    const config = loadMCPConfig();

    expect(config.servers).toEqual([]);
  });

  it('should handle null mcpServers in project config', () => {
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      return p.includes('.codebuddy') && p.includes('mcp.json') && !p.includes('testuser');
    });
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
      mcpServers: null,
    }));

    const config = loadMCPConfig();

    expect(config.servers).toEqual([]);
  });

  it('should handle server config without name property', () => {
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      return p.includes('.codebuddy') && p.includes('mcp.json') && !p.includes('testuser');
    });
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
      mcpServers: {
        'named-from-key': {
          transport: { type: 'stdio', command: 'node' },
          // No name property - should use key
        },
      },
    }));

    const config = loadMCPConfig();

    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].name).toBe('named-from-key');
  });

  it('should handle very long server names', () => {
    const longName = 'a'.repeat(1000);
    const newServer: MCPServerConfig = {
      name: longName,
      transport: { type: 'stdio', command: 'node' },
    };

    mockLoadProjectSettings.mockReturnValue({});

    addMCPServer(newServer);

    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {
      [longName]: newServer,
    });
  });

  it('should handle special characters in server names', () => {
    const specialName = 'server-with_special.chars:123';
    const newServer: MCPServerConfig = {
      name: specialName,
      transport: { type: 'stdio', command: 'node' },
    };

    mockLoadProjectSettings.mockReturnValue({});

    addMCPServer(newServer);

    expect(mockUpdateProjectSetting).toHaveBeenCalledWith('mcpServers', {
      [specialName]: newServer,
    });
  });
});
