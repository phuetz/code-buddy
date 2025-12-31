/**
 * Unit tests for Help Command Handlers
 *
 * Tests cover:
 * - Help command handler (handleHelp)
 * - Command categorization
 * - Dynamic command loading from SlashCommandManager
 * - Help text formatting
 * - Command signature display
 * - Parameter documentation
 * - YOLO mode handler
 * - Autonomy handler
 * - Pipeline handler
 * - Parallel handler
 * - Skill handler
 * - Save conversation handler
 */

import {
  handleHelp,
  handleYoloMode,
  handleAutonomy,
  handlePipeline,
  handleParallel,
  handleSkill,
  handleSaveConversation,
} from '../../src/commands/handlers/core-handlers';

// Mock slash command manager
const mockGetAllCommands = jest.fn();
const mockGetSlashCommandManager = jest.fn(() => ({
  getAllCommands: mockGetAllCommands,
}));

jest.mock('../../src/commands/slash-commands', () => ({
  getSlashCommandManager: () => mockGetSlashCommandManager(),
}));

// Mock autonomy manager
const mockEnableYOLO = jest.fn();
const mockDisableYOLO = jest.fn();
const mockUpdateYOLOConfig = jest.fn();
const mockFormatYOLOStatus = jest.fn();
const mockGetLevel = jest.fn();
const mockSetLevel = jest.fn();
const mockAddToYOLOAllowList = jest.fn();
const mockAddToYOLODenyList = jest.fn();

jest.mock('../../src/utils/autonomy-manager', () => ({
  getAutonomyManager: jest.fn(() => ({
    enableYOLO: mockEnableYOLO,
    disableYOLO: mockDisableYOLO,
    updateYOLOConfig: mockUpdateYOLOConfig,
    formatYOLOStatus: mockFormatYOLOStatus,
    getLevel: mockGetLevel,
    setLevel: mockSetLevel,
    addToYOLOAllowList: mockAddToYOLOAllowList,
    addToYOLODenyList: mockAddToYOLODenyList,
  })),
  AutonomyLevel: {
    suggest: 'suggest',
    confirm: 'confirm',
    auto: 'auto',
    full: 'full',
    yolo: 'yolo',
  },
}));

// Mock skill manager
const mockGetAvailableSkills = jest.fn();
const mockGetActiveSkill = jest.fn();
const mockGetSkill = jest.fn();
const mockActivateSkill = jest.fn();
const mockDeactivateSkill = jest.fn();

jest.mock('../../src/skills/skill-manager', () => ({
  getSkillManager: jest.fn(() => ({
    getAvailableSkills: mockGetAvailableSkills,
    getActiveSkill: mockGetActiveSkill,
    getSkill: mockGetSkill,
    activateSkill: mockActivateSkill,
    deactivateSkill: mockDeactivateSkill,
  })),
}));

// Mock conversation exporter
const mockExport = jest.fn();

jest.mock('../../src/utils/conversation-export', () => ({
  getConversationExporter: jest.fn(() => ({
    export: mockExport,
  })),
}));

describe('Help Command Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllCommands.mockReturnValue([
      { name: 'help', description: 'Show available commands', isBuiltin: true },
      { name: 'clear', description: 'Clear the chat history', isBuiltin: true },
      { name: 'model', description: 'Change the AI model', isBuiltin: true, arguments: [{ name: 'model', required: false, description: 'Model name' }] },
      { name: 'mode', description: 'Change agent mode', isBuiltin: true, arguments: [{ name: 'mode', required: true, description: 'Mode to switch to' }] },
      { name: 'commit', description: 'Generate commit message', isBuiltin: true },
      { name: 'review', description: 'Review code changes', isBuiltin: true },
      { name: 'test', description: 'Run tests', isBuiltin: true },
      { name: 'lint', description: 'Run linter', isBuiltin: true },
      { name: 'memory', description: 'Manage persistent memory', isBuiltin: true },
      { name: 'context', description: 'View loaded context', isBuiltin: true },
      { name: 'checkpoints', description: 'List checkpoints', isBuiltin: true },
      { name: 'restore', description: 'Restore checkpoint', isBuiltin: true },
      { name: 'save', description: 'Save conversation', isBuiltin: true },
      { name: 'theme', description: 'Change UI theme', isBuiltin: true },
      { name: 'voice', description: 'Voice input control', isBuiltin: true },
      { name: 'yolo', description: 'Toggle YOLO mode', isBuiltin: true },
    ]);
  });

  describe('handleHelp', () => {
    it('should return a handled result', async () => {
      const result = await handleHelp();

      expect(result.handled).toBe(true);
    });

    it('should include assistant entry', async () => {
      const result = await handleHelp();

      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
    });

    it('should have title header', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('GROK CLI COMMANDS');
    });

    it('should include Core category', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Core');
    });

    it('should list help command', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('/help');
    });

    it('should list clear command', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('/clear');
    });

    it('should list model command', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('/model');
    });

    it('should show command descriptions', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Show available commands');
      expect(result.entry?.content).toContain('Clear the chat history');
    });

    it('should show required arguments', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('<mode>');
    });

    it('should show optional arguments', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('[model]');
    });

    it('should include Code & Development category', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Code & Development');
    });

    it('should include Git & Version Control category', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Git & Version Control');
    });

    it('should include Context & Memory category', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Context & Memory');
    });

    it('should include Settings & UI category', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Settings & UI');
    });

    it('should include usage tip', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Tip:');
    });

    it('should mention exit command', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('exit');
    });

    it('should have timestamp in entry', async () => {
      const result = await handleHelp();

      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });

    it('should categorize commands correctly', async () => {
      mockGetAllCommands.mockReturnValue([
        { name: 'review', description: 'Review code', isBuiltin: true },
        { name: 'commit', description: 'Git commit', isBuiltin: true },
        { name: 'memory', description: 'Memory management', isBuiltin: true },
        { name: 'save', description: 'Save session', isBuiltin: true },
        { name: 'theme', description: 'UI theme', isBuiltin: true },
        { name: 'custom', description: 'Custom command', isBuiltin: true },
      ]);

      const result = await handleHelp();

      // review should be in Code & Development
      // commit should be in Git & Version Control
      // memory should be in Context & Memory
      // save should be in Session & Export
      // theme should be in Settings & UI
      // custom should be in Advanced
      expect(result.entry?.content).toContain('Code & Development');
      expect(result.entry?.content).toContain('Git & Version Control');
    });

    it('should show parameter details for commands with arguments', async () => {
      mockGetAllCommands.mockReturnValue([
        {
          name: 'mode',
          description: 'Change mode',
          isBuiltin: true,
          arguments: [
            { name: 'mode', required: true, description: 'Mode to switch to' },
          ],
        },
      ]);

      const result = await handleHelp();

      expect(result.entry?.content).toContain('mode');
      expect(result.entry?.content).toContain('(required)');
    });
  });
});

describe('YOLO Mode Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFormatYOLOStatus.mockReturnValue('YOLO Status: DISABLED');
  });

  describe('handleYoloMode', () => {
    it('should show status when no action provided', () => {
      const result = handleYoloMode([]);

      expect(result.handled).toBe(true);
      expect(mockFormatYOLOStatus).toHaveBeenCalled();
    });

    it('should show status with "status" action', () => {
      handleYoloMode(['status']);

      expect(mockFormatYOLOStatus).toHaveBeenCalled();
    });

    it('should enable with "on" action', () => {
      const result = handleYoloMode(['on']);

      expect(mockEnableYOLO).toHaveBeenCalledWith(false);
      expect(mockUpdateYOLOConfig).toHaveBeenCalledWith({
        maxAutoEdits: 50,
        maxAutoCommands: 100,
      });
      expect(result.entry?.content).toContain('YOLO MODE: ENABLED');
    });

    it('should enable safe mode with "safe" action', () => {
      const result = handleYoloMode(['safe']);

      expect(mockEnableYOLO).toHaveBeenCalledWith(true);
      expect(mockUpdateYOLOConfig).toHaveBeenCalledWith({
        maxAutoEdits: 20,
        maxAutoCommands: 30,
        allowedPaths: ['src/', 'test/', 'tests/'],
      });
      expect(result.entry?.content).toContain('YOLO MODE: SAFE');
    });

    it('should disable with "off" action', () => {
      const result = handleYoloMode(['off']);

      expect(mockDisableYOLO).toHaveBeenCalled();
      expect(result.entry?.content).toContain('YOLO MODE: DISABLED');
    });

    it('should add to allow list with "allow" action', () => {
      const result = handleYoloMode(['allow', 'git']);

      expect(mockAddToYOLOAllowList).toHaveBeenCalledWith('git');
      expect(result.entry?.content).toContain('allowed');
    });

    it('should show usage when allow without command', () => {
      const result = handleYoloMode(['allow']);

      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/yolo allow');
    });

    it('should add to deny list with "deny" action', () => {
      const result = handleYoloMode(['deny', 'rm']);

      expect(mockAddToYOLODenyList).toHaveBeenCalledWith('rm');
      expect(result.entry?.content).toContain('denied');
    });

    it('should show usage when deny without command', () => {
      const result = handleYoloMode(['deny']);

      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/yolo deny');
    });

    it('should be case insensitive', () => {
      handleYoloMode(['ON']);

      expect(mockEnableYOLO).toHaveBeenCalled();
    });

    it('should show guardrails in enabled message', () => {
      const result = handleYoloMode(['on']);

      expect(result.entry?.content).toContain('50');
      expect(result.entry?.content).toContain('100');
    });

    it('should show restrictions in safe message', () => {
      const result = handleYoloMode(['safe']);

      expect(result.entry?.content).toContain('20');
      expect(result.entry?.content).toContain('30');
      expect(result.entry?.content).toContain('src/');
    });
  });
});

describe('Autonomy Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLevel.mockReturnValue('confirm');
  });

  describe('handleAutonomy', () => {
    it('should show current level when no action provided', () => {
      const result = handleAutonomy([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Autonomy Settings');
      expect(mockGetLevel).toHaveBeenCalled();
    });

    it('should set level to suggest', () => {
      const result = handleAutonomy(['suggest']);

      expect(mockSetLevel).toHaveBeenCalledWith('suggest');
      expect(result.entry?.content).toContain('SUGGEST');
    });

    it('should set level to confirm', () => {
      const result = handleAutonomy(['confirm']);

      expect(mockSetLevel).toHaveBeenCalledWith('confirm');
      expect(result.entry?.content).toContain('CONFIRM');
    });

    it('should set level to auto', () => {
      const result = handleAutonomy(['auto']);

      expect(mockSetLevel).toHaveBeenCalledWith('auto');
      expect(result.entry?.content).toContain('AUTO');
    });

    it('should set level to full', () => {
      const result = handleAutonomy(['full']);

      expect(mockSetLevel).toHaveBeenCalledWith('full');
      expect(result.entry?.content).toContain('FULL');
    });

    it('should set level to yolo', () => {
      const result = handleAutonomy(['yolo']);

      expect(mockSetLevel).toHaveBeenCalledWith('yolo');
      expect(result.entry?.content).toContain('YOLO');
    });

    it('should show all levels in status', () => {
      const result = handleAutonomy([]);

      expect(result.entry?.content).toContain('suggest');
      expect(result.entry?.content).toContain('confirm');
      expect(result.entry?.content).toContain('auto');
      expect(result.entry?.content).toContain('full');
      expect(result.entry?.content).toContain('yolo');
    });

    it('should show current level in status', () => {
      mockGetLevel.mockReturnValue('auto');

      const result = handleAutonomy([]);

      expect(result.entry?.content).toContain('Current:');
      expect(result.entry?.content).toContain('AUTO');
    });

    it('should show description for each level', () => {
      const result = handleAutonomy(['confirm']);

      expect(result.entry?.content).toContain('confirmation');
    });

    it('should handle invalid level', () => {
      const result = handleAutonomy(['invalid']);

      expect(mockSetLevel).not.toHaveBeenCalled();
      expect(result.entry?.content).toContain('Autonomy Settings');
    });

    it('should be case insensitive', () => {
      handleAutonomy(['SUGGEST']);

      expect(mockSetLevel).toHaveBeenCalledWith('suggest');
    });
  });
});

describe('Pipeline Handler', () => {
  describe('handlePipeline', () => {
    it('should show available pipelines when no name provided', () => {
      const result = handlePipeline([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Pipelines');
    });

    it('should list pipeline types', () => {
      const result = handlePipeline([]);

      expect(result.entry?.content).toContain('code-review');
      expect(result.entry?.content).toContain('bug-fix');
      expect(result.entry?.content).toContain('feature-development');
      expect(result.entry?.content).toContain('security-audit');
      expect(result.entry?.content).toContain('documentation');
    });

    it('should show usage example', () => {
      const result = handlePipeline([]);

      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/pipeline');
    });

    it('should pass to AI with pipeline name', () => {
      const result = handlePipeline(['code-review']);

      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('code-review');
    });

    it('should include steps for code-review pipeline', () => {
      const result = handlePipeline(['code-review']);

      expect(result.prompt).toContain('Analyze code structure');
      expect(result.prompt).toContain('code smells');
    });

    it('should include steps for bug-fix pipeline', () => {
      const result = handlePipeline(['bug-fix']);

      expect(result.prompt).toContain('Reproduce');
      expect(result.prompt).toContain('root cause');
    });

    it('should include steps for feature-development pipeline', () => {
      const result = handlePipeline(['feature-development']);

      expect(result.prompt).toContain('requirements');
      expect(result.prompt).toContain('Implement');
    });

    it('should include steps for security-audit pipeline', () => {
      const result = handlePipeline(['security-audit']);

      expect(result.prompt).toContain('vulnerabilities');
      expect(result.prompt).toContain('authentication');
    });

    it('should include steps for documentation pipeline', () => {
      const result = handlePipeline(['documentation']);

      expect(result.prompt).toContain('API documentation');
      expect(result.prompt).toContain('README');
    });

    it('should use cwd as default target', () => {
      const result = handlePipeline(['code-review']);

      expect(result.prompt).toContain('on:');
    });

    it('should use provided target', () => {
      const result = handlePipeline(['code-review', 'src/utils.ts']);

      expect(result.prompt).toContain('src/utils.ts');
    });

    it('should handle unknown pipeline gracefully', () => {
      const result = handlePipeline(['unknown-pipeline']);

      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('unknown-pipeline');
    });
  });
});

describe('Parallel Handler', () => {
  describe('handleParallel', () => {
    it('should show usage when no task provided', () => {
      const result = handleParallel([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Parallel Subagent Runner');
    });

    it('should show example', () => {
      const result = handleParallel([]);

      expect(result.entry?.content).toContain('Example:');
      expect(result.entry?.content).toContain('/parallel');
    });

    it('should pass to AI with task', () => {
      const result = handleParallel(['analyze', 'all', 'files']);

      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('analyze all files');
    });

    it('should include parallel guidance in prompt', () => {
      const result = handleParallel(['analyze', 'files']);

      expect(result.prompt).toContain('parallel');
      expect(result.prompt).toContain('Independent file analysis');
      expect(result.prompt).toContain('Multiple search queries');
      expect(result.prompt).toContain('Concurrent API calls');
    });
  });
});

describe('Skill Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvailableSkills.mockReturnValue(['code-review', 'debugging', 'testing']);
    mockGetActiveSkill.mockReturnValue(null);
    mockGetSkill.mockImplementation((name: string) => ({
      name,
      description: `${name} skill description`,
    }));
  });

  describe('handleSkill', () => {
    it('should list skills when no action provided', () => {
      const result = handleSkill([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Skills');
    });

    it('should list skills with "list" action', () => {
      handleSkill(['list']);

      expect(mockGetAvailableSkills).toHaveBeenCalled();
    });

    it('should show all available skills', () => {
      const result = handleSkill([]);

      expect(result.entry?.content).toContain('code-review');
      expect(result.entry?.content).toContain('debugging');
      expect(result.entry?.content).toContain('testing');
    });

    it('should show skill descriptions', () => {
      const result = handleSkill([]);

      expect(mockGetSkill).toHaveBeenCalled();
    });

    it('should mark active skill', () => {
      mockGetActiveSkill.mockReturnValue({ name: 'debugging' });

      const result = handleSkill([]);

      expect(result.entry?.content).toContain('debugging');
    });

    it('should activate skill with "activate" action', () => {
      mockActivateSkill.mockReturnValue({
        name: 'code-review',
        description: 'Code review skill',
      });

      const result = handleSkill(['activate', 'code-review']);

      expect(mockActivateSkill).toHaveBeenCalledWith('code-review');
      expect(result.entry?.content).toContain('Activated');
    });

    it('should show error when skill not found', () => {
      mockActivateSkill.mockReturnValue(null);

      const result = handleSkill(['activate', 'unknown-skill']);

      expect(result.entry?.content).toContain('not found');
    });

    it('should deactivate skill with "deactivate" action', () => {
      const result = handleSkill(['deactivate']);

      expect(mockDeactivateSkill).toHaveBeenCalled();
      expect(result.entry?.content).toContain('deactivated');
    });

    it('should activate by skill name directly', () => {
      mockActivateSkill.mockReturnValue({
        name: 'testing',
        description: 'Testing skill',
      });

      const result = handleSkill(['testing']);

      expect(mockActivateSkill).toHaveBeenCalledWith('testing');
      expect(result.entry?.content).toContain('Activated');
    });

    it('should show error for unknown skill name', () => {
      mockActivateSkill.mockReturnValue(null);

      const result = handleSkill(['unknown']);

      expect(result.entry?.content).toContain('Unknown skill');
      expect(result.entry?.content).toContain('/skill list');
    });

    it('should show commands help', () => {
      const result = handleSkill([]);

      expect(result.entry?.content).toContain('/skill list');
      expect(result.entry?.content).toContain('/skill activate');
      expect(result.entry?.content).toContain('/skill deactivate');
    });
  });
});

describe('Save Conversation Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleSaveConversation', () => {
    it('should export conversation successfully', () => {
      mockExport.mockReturnValue({
        success: true,
        filePath: '/tmp/conversation-2024-01-15.md',
      });

      const history = [
        { type: 'user', content: 'Hello', timestamp: new Date() },
        { type: 'assistant', content: 'Hi!', timestamp: new Date() },
      ];

      const result = handleSaveConversation([], history as any);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Conversation saved');
      expect(result.entry?.content).toContain('/tmp/conversation-2024-01-15.md');
    });

    it('should use provided filename', () => {
      mockExport.mockReturnValue({
        success: true,
        filePath: '/tmp/my-session.md',
      });

      const history = [{ type: 'user', content: 'Hello', timestamp: new Date() }];

      handleSaveConversation(['my-session.md'], history as any);

      expect(mockExport).toHaveBeenCalledWith(
        history,
        expect.objectContaining({
          outputPath: 'my-session.md',
        })
      );
    });

    it('should handle filename with spaces', () => {
      mockExport.mockReturnValue({
        success: true,
        filePath: '/tmp/my session file.md',
      });

      const history = [{ type: 'user', content: 'Hello', timestamp: new Date() }];

      handleSaveConversation(['my', 'session', 'file.md'], history as any);

      expect(mockExport).toHaveBeenCalledWith(
        history,
        expect.objectContaining({
          outputPath: 'my session file.md',
        })
      );
    });

    it('should use markdown format', () => {
      mockExport.mockReturnValue({ success: true, filePath: '/tmp/test.md' });

      const history = [{ type: 'user', content: 'Hello', timestamp: new Date() }];

      handleSaveConversation([], history as any);

      expect(mockExport).toHaveBeenCalledWith(
        history,
        expect.objectContaining({
          format: 'markdown',
        })
      );
    });

    it('should include tool results', () => {
      mockExport.mockReturnValue({ success: true, filePath: '/tmp/test.md' });

      const history = [{ type: 'user', content: 'Hello', timestamp: new Date() }];

      handleSaveConversation([], history as any);

      expect(mockExport).toHaveBeenCalledWith(
        history,
        expect.objectContaining({
          includeToolResults: true,
        })
      );
    });

    it('should include timestamps', () => {
      mockExport.mockReturnValue({ success: true, filePath: '/tmp/test.md' });

      const history = [{ type: 'user', content: 'Hello', timestamp: new Date() }];

      handleSaveConversation([], history as any);

      expect(mockExport).toHaveBeenCalledWith(
        history,
        expect.objectContaining({
          includeTimestamps: true,
        })
      );
    });

    it('should handle export failure', () => {
      mockExport.mockReturnValue({
        success: false,
        error: 'Permission denied',
      });

      const history = [{ type: 'user', content: 'Hello', timestamp: new Date() }];

      const result = handleSaveConversation([], history as any);

      expect(result.entry?.content).toContain('Failed to save');
      expect(result.entry?.content).toContain('Permission denied');
    });

    it('should handle empty history', () => {
      mockExport.mockReturnValue({
        success: true,
        filePath: '/tmp/empty.md',
      });

      const result = handleSaveConversation([], []);

      expect(result.handled).toBe(true);
    });
  });
});

describe('Edge Cases', () => {
  it('should handle empty args for all handlers', () => {
    expect(() => handleYoloMode([])).not.toThrow();
    expect(() => handleAutonomy([])).not.toThrow();
    expect(() => handlePipeline([])).not.toThrow();
    expect(() => handleParallel([])).not.toThrow();
    expect(() => handleSkill([])).not.toThrow();
  });

  it('should handle undefined in args', () => {
    expect(() => handleYoloMode([undefined as unknown as string])).not.toThrow();
    expect(() => handleAutonomy([undefined as unknown as string])).not.toThrow();
  });

  it('should have timestamp in all entries', () => {
    const results = [
      handleYoloMode([]),
      handleAutonomy([]),
      handlePipeline([]),
      handleParallel([]),
      handleSkill([]),
    ];

    for (const result of results) {
      if (result.entry) {
        expect(result.entry.timestamp).toBeInstanceOf(Date);
      }
    }
  });

  it('should have correct entry type for all handlers', () => {
    const results = [
      handleYoloMode([]),
      handleAutonomy([]),
      handlePipeline([]),
      handleParallel([]),
      handleSkill([]),
    ];

    for (const result of results) {
      if (result.entry) {
        expect(result.entry.type).toBe('assistant');
      }
    }
  });
});

describe('CommandHandlerResult Structure', () => {
  it('should always have handled property', async () => {
    const result = await handleHelp();

    expect(result).toHaveProperty('handled');
    expect(typeof result.handled).toBe('boolean');
  });

  it('should have entry when not passing to AI', () => {
    const result = handleYoloMode([]);

    expect(result.entry).toBeDefined();
    expect(result.passToAI).toBeUndefined();
  });

  it('should have prompt when passing to AI', () => {
    const result = handlePipeline(['code-review']);

    expect(result.passToAI).toBe(true);
    expect(result.prompt).toBeDefined();
    expect(typeof result.prompt).toBe('string');
  });
});
