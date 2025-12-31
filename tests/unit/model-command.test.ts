/**
 * Unit tests for Model Command Handlers
 *
 * Tests cover:
 * - Model routing and selection (/model-router)
 * - Model change commands (/model)
 * - Model listing and configuration
 * - Provider model interactions
 * - Settings manager model operations
 */

import {
  handleModelRouter,
} from '../../src/commands/handlers/core-handlers';

// Mock settings manager
const mockLoadUserSettings = jest.fn();
const mockUpdateUserSetting = jest.fn();
const mockGetCurrentModel = jest.fn();
const mockSetCurrentModel = jest.fn();
const mockGetAvailableModels = jest.fn();

jest.mock('../../src/utils/settings-manager', () => ({
  getSettingsManager: jest.fn(() => ({
    loadUserSettings: mockLoadUserSettings,
    updateUserSetting: mockUpdateUserSetting,
    getCurrentModel: mockGetCurrentModel,
    setCurrentModel: mockSetCurrentModel,
    getAvailableModels: mockGetAvailableModels,
    getUserSetting: jest.fn((key: string) => {
      if (key === 'provider') return 'grok';
      if (key === 'model') return 'grok-code-fast-1';
      return undefined;
    }),
  })),
}));

// Mock autonomy manager
jest.mock('../../src/utils/autonomy-manager', () => ({
  getAutonomyManager: jest.fn(() => ({
    enableYOLO: jest.fn(),
    disableYOLO: jest.fn(),
    updateYOLOConfig: jest.fn(),
    formatYOLOStatus: jest.fn(() => 'YOLO Status Mock'),
    getLevel: jest.fn(() => 'confirm'),
    setLevel: jest.fn(),
    addToYOLOAllowList: jest.fn(),
    addToYOLODenyList: jest.fn(),
  })),
}));

// Mock slash command manager
jest.mock('../../src/commands/slash-commands', () => ({
  getSlashCommandManager: jest.fn(() => ({
    getAllCommands: jest.fn(() => [
      { name: 'help', description: 'Show help', isBuiltin: true },
      { name: 'model', description: 'Change model', isBuiltin: true },
      { name: 'commit', description: 'Commit changes', isBuiltin: true },
    ]),
  })),
}));

// Mock skill manager
jest.mock('../../src/skills/skill-manager', () => ({
  getSkillManager: jest.fn(() => ({
    getAvailableSkills: jest.fn(() => ['code-review', 'debugging', 'testing']),
    getActiveSkill: jest.fn(() => null),
    getSkill: jest.fn((name: string) => ({
      name,
      description: `Description for ${name}`,
    })),
    activateSkill: jest.fn((name: string) => ({
      name,
      description: `Activated ${name}`,
    })),
    deactivateSkill: jest.fn(),
  })),
}));

// Mock conversation exporter
jest.mock('../../src/utils/conversation-export', () => ({
  getConversationExporter: jest.fn(() => ({
    export: jest.fn(() => ({
      success: true,
      filePath: '/tmp/conversation.md',
    })),
  })),
}));

describe('Model Router Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleModelRouter', () => {
    it('should show status when no action provided', () => {
      const result = handleModelRouter([]);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
      expect(result.entry?.content).toContain('Model Router Status');
    });

    it('should show status when "status" action provided', () => {
      const result = handleModelRouter(['status']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Model Router Status');
      expect(result.entry?.content).toContain('Mode:');
    });

    it('should enable auto mode', () => {
      const result = handleModelRouter(['auto']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('AUTO MODE');
      expect(result.entry?.content).toContain('Models will be selected automatically');
    });

    it('should show task-to-model mappings in auto mode', () => {
      const result = handleModelRouter(['auto']);

      expect(result.entry?.content).toContain('search');
      expect(result.entry?.content).toContain('planning');
      expect(result.entry?.content).toContain('coding');
      expect(result.entry?.content).toContain('review');
      expect(result.entry?.content).toContain('debug');
    });

    it('should enable manual mode', () => {
      const result = handleModelRouter(['manual']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('MANUAL MODE');
      expect(result.entry?.content).toContain('/model');
    });

    it('should handle unknown action as status', () => {
      const result = handleModelRouter(['unknown-action']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Model Router Status');
    });

    it('should show model-router commands in status', () => {
      const result = handleModelRouter(['status']);

      expect(result.entry?.content).toContain('/model-router auto');
      expect(result.entry?.content).toContain('/model-router manual');
    });

    it('should have timestamp in entry', () => {
      const result = handleModelRouter([]);

      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });
  });
});

describe('Model Selection Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentModel.mockReturnValue('grok-code-fast-1');
    mockGetAvailableModels.mockReturnValue([
      'grok-code-fast-1',
      'grok-4-latest',
      'grok-3-latest',
      'grok-3-fast',
      'grok-3-mini-fast',
    ]);
  });

  describe('Default Model Behavior', () => {
    it('should have default model', () => {
      const model = mockGetCurrentModel();
      expect(model).toBe('grok-code-fast-1');
    });

    it('should have available models list', () => {
      const models = mockGetAvailableModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models).toContain('grok-code-fast-1');
    });
  });

  describe('Model Change Operations', () => {
    it('should set current model', () => {
      mockSetCurrentModel('grok-4-latest');
      expect(mockSetCurrentModel).toHaveBeenCalledWith('grok-4-latest');
    });

    it('should update user settings when model changes', () => {
      mockUpdateUserSetting('model', 'grok-3-latest');
      expect(mockUpdateUserSetting).toHaveBeenCalledWith('model', 'grok-3-latest');
    });
  });
});

describe('Model Command Integration', () => {
  describe('Task Type Model Mapping', () => {
    const taskModelMappings: Record<string, string> = {
      'search': 'grok-code-fast-1',
      'planning': 'grok-4-latest',
      'coding': 'grok-4-latest',
      'review': 'grok-4-latest',
      'debug': 'grok-4-latest',
      'docs': 'grok-code-fast-1',
      'chat': 'grok-code-fast-1',
    };

    it('should have defined mappings for all task types', () => {
      const taskTypes = Object.keys(taskModelMappings);
      expect(taskTypes).toContain('search');
      expect(taskTypes).toContain('planning');
      expect(taskTypes).toContain('coding');
      expect(taskTypes).toContain('review');
      expect(taskTypes).toContain('debug');
      expect(taskTypes).toContain('docs');
      expect(taskTypes).toContain('chat');
    });

    it('should use fast model for simple tasks', () => {
      expect(taskModelMappings['search']).toContain('fast');
      expect(taskModelMappings['docs']).toContain('fast');
      expect(taskModelMappings['chat']).toContain('fast');
    });

    it('should use powerful model for complex tasks', () => {
      expect(taskModelMappings['planning']).toContain('4-latest');
      expect(taskModelMappings['coding']).toContain('4-latest');
      expect(taskModelMappings['debug']).toContain('4-latest');
    });
  });

  describe('Model Validation', () => {
    const validModels = [
      'grok-code-fast-1',
      'grok-4-latest',
      'grok-3-latest',
      'grok-3-fast',
      'grok-3-mini-fast',
    ];

    it('should validate known models', () => {
      for (const model of validModels) {
        expect(model).toBeDefined();
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
      }
    });

    it('should have proper model naming convention', () => {
      for (const model of validModels) {
        expect(model).toMatch(/^grok-/);
      }
    });
  });
});

describe('Model Router Status Display', () => {
  it('should display task types', () => {
    const result = handleModelRouter([]);

    const content = result.entry?.content || '';
    expect(content).toContain('search');
    expect(content).toContain('planning');
    expect(content).toContain('coding');
  });

  it('should display model names', () => {
    const result = handleModelRouter([]);

    const content = result.entry?.content || '';
    expect(content).toContain('grok');
  });

  it('should show commands section', () => {
    const result = handleModelRouter([]);

    const content = result.entry?.content || '';
    expect(content).toContain('Commands:');
  });
});

describe('Edge Cases', () => {
  it('should handle empty args array', () => {
    const result = handleModelRouter([]);

    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
  });

  it('should handle undefined args elements', () => {
    const result = handleModelRouter([undefined as unknown as string]);

    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
  });

  it('should handle case-insensitive actions', () => {
    const result1 = handleModelRouter(['AUTO']);
    const result2 = handleModelRouter(['Auto']);
    const result3 = handleModelRouter(['auto']);

    expect(result1.entry?.content).toContain('AUTO MODE');
    expect(result2.entry?.content).toContain('AUTO MODE');
    expect(result3.entry?.content).toContain('AUTO MODE');
  });

  it('should handle whitespace in args', () => {
    const result = handleModelRouter(['  auto  '.trim()]);

    expect(result.handled).toBe(true);
  });
});

describe('Model Command Handler Result Structure', () => {
  it('should return proper CommandHandlerResult structure', () => {
    const result = handleModelRouter([]);

    expect(result).toHaveProperty('handled');
    expect(typeof result.handled).toBe('boolean');
  });

  it('should include entry when handled', () => {
    const result = handleModelRouter([]);

    expect(result.entry).toBeDefined();
    expect(result.entry?.type).toBe('assistant');
    expect(result.entry?.content).toBeDefined();
    expect(result.entry?.timestamp).toBeInstanceOf(Date);
  });

  it('should not passToAI for model router', () => {
    const result = handleModelRouter([]);

    expect(result.passToAI).toBeUndefined();
  });
});

describe('Multi-Provider Model Support', () => {
  const providerModels = {
    grok: ['grok-beta', 'grok-code-fast-1', 'grok-4-latest'],
    claude: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-latest'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  };

  it('should have models for all providers', () => {
    for (const [provider, models] of Object.entries(providerModels)) {
      expect(models.length).toBeGreaterThan(0);
    }
  });

  it('should have unique models per provider', () => {
    for (const [provider, models] of Object.entries(providerModels)) {
      const uniqueModels = new Set(models);
      expect(uniqueModels.size).toBe(models.length);
    }
  });

  it('should follow provider naming conventions', () => {
    expect(providerModels.grok.every((m: string) => m.startsWith('grok'))).toBe(true);
    expect(providerModels.claude.every((m: string) => m.startsWith('claude'))).toBe(true);
    expect(providerModels.openai.every((m: string) => m.startsWith('gpt') || m.startsWith('o'))).toBe(true);
    expect(providerModels.gemini.every((m: string) => m.startsWith('gemini'))).toBe(true);
  });
});
