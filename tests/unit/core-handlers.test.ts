/**
 * Unit Tests for Core Handlers
 *
 * Tests cover:
 * - handleHelp - Display available commands
 * - handleYoloMode - Full auto-execution mode
 * - handleAutonomy - Set autonomy levels
 * - handlePipeline - Run agent workflows
 * - handleParallel - Run parallel subagents
 * - handleModelRouter - Configure dynamic model selection
 * - handleSkill - Manage specialized skills
 * - handleSaveConversation - Export chat to file
 */

import {
  handleHelp,
  handleYoloMode,
  handleAutonomy,
  handlePipeline,
  handleParallel,
  handleModelRouter,
  handleSkill,
  handleSaveConversation,
  CommandHandlerResult,
} from '../../src/commands/handlers/core-handlers';
import { getAutonomyManager, AutonomyLevel } from '../../src/utils/autonomy-manager';
import { getSlashCommandManager } from '../../src/commands/slash-commands';
import { getSkillManager } from '../../src/skills/skill-manager';
import { getConversationExporter } from '../../src/utils/conversation-export';
import { ChatEntry } from '../../src/agent/codebuddy-agent';

// Mock dependencies
jest.mock('../../src/utils/autonomy-manager', () => {
  const mockAutonomyManager = {
    enableYOLO: jest.fn(),
    disableYOLO: jest.fn(),
    updateYOLOConfig: jest.fn(),
    addToYOLOAllowList: jest.fn(),
    addToYOLODenyList: jest.fn(),
    formatYOLOStatus: jest.fn(),
    setLevel: jest.fn(),
    getLevel: jest.fn(),
  };

  return {
    getAutonomyManager: jest.fn(() => mockAutonomyManager),
    AutonomyLevel: {
      SUGGEST: 'suggest',
      CONFIRM: 'confirm',
      AUTO: 'auto',
      FULL: 'full',
      YOLO: 'yolo',
    },
  };
});

jest.mock('../../src/commands/slash-commands', () => {
  const mockSlashManager = {
    getAllCommands: jest.fn(),
  };

  return {
    getSlashCommandManager: jest.fn(() => mockSlashManager),
  };
});

jest.mock('../../src/skills/skill-manager', () => {
  const mockSkillManager = {
    getAvailableSkills: jest.fn(),
    getActiveSkill: jest.fn(),
    getSkill: jest.fn(),
    activateSkill: jest.fn(),
    deactivateSkill: jest.fn(),
  };

  return {
    getSkillManager: jest.fn(() => mockSkillManager),
  };
});

jest.mock('../../src/utils/conversation-export', () => {
  const mockExporter = {
    export: jest.fn(),
  };

  return {
    getConversationExporter: jest.fn(() => mockExporter),
  };
});

describe('Core Handlers', () => {
  let mockAutonomyManager: {
    enableYOLO: jest.Mock;
    disableYOLO: jest.Mock;
    updateYOLOConfig: jest.Mock;
    addToYOLOAllowList: jest.Mock;
    addToYOLODenyList: jest.Mock;
    formatYOLOStatus: jest.Mock;
    setLevel: jest.Mock;
    getLevel: jest.Mock;
  };

  let mockSlashManager: {
    getAllCommands: jest.Mock;
  };

  let mockSkillManager: {
    getAvailableSkills: jest.Mock;
    getActiveSkill: jest.Mock;
    getSkill: jest.Mock;
    activateSkill: jest.Mock;
    deactivateSkill: jest.Mock;
  };

  let mockExporter: {
    export: jest.Mock;
  };

  const sampleCommands = [
    { name: 'help', description: 'Show available commands', arguments: [] },
    { name: 'clear', description: 'Clear the chat history', arguments: [] },
    { name: 'model', description: 'Change the model', arguments: [{ name: 'model', description: 'Model name', required: false }] },
    { name: 'mode', description: 'Change the mode', arguments: [{ name: 'mode', description: 'Mode name', required: true }] },
    { name: 'review', description: 'Review code changes', arguments: [] },
    { name: 'commit', description: 'Create a commit', arguments: [] },
    { name: 'test', description: 'Run tests', arguments: [] },
    { name: 'memory', description: 'Show memory', arguments: [] },
    { name: 'save', description: 'Save conversation', arguments: [] },
    { name: 'theme', description: 'Change theme', arguments: [] },
    { name: 'yolo', description: 'YOLO mode', arguments: [] },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockAutonomyManager = (getAutonomyManager as jest.Mock)();
    mockSlashManager = (getSlashCommandManager as jest.Mock)();
    mockSkillManager = (getSkillManager as jest.Mock)();
    mockExporter = (getConversationExporter as jest.Mock)();

    mockAutonomyManager.formatYOLOStatus.mockReturnValue('YOLO Status: OFF');
    mockAutonomyManager.getLevel.mockReturnValue('confirm');
    mockSlashManager.getAllCommands.mockReturnValue(sampleCommands);
    mockSkillManager.getAvailableSkills.mockReturnValue([]);
    mockSkillManager.getActiveSkill.mockReturnValue(null);
    mockExporter.export.mockReturnValue({ success: true, filePath: '/tmp/conversation.md' });
  });

  // ============================================
  // handleHelp Tests
  // ============================================
  describe('handleHelp', () => {
    test('should return help content', async () => {
      const result = await handleHelp();

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
      expect(result.entry?.content).toContain('GROK CLI COMMANDS');
    });

    test('should categorize commands', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Core');
      expect(result.entry?.content).toContain('Code & Development');
      expect(result.entry?.content).toContain('Git & Version Control');
    });

    test('should include command names', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('/help');
      expect(result.entry?.content).toContain('/clear');
      expect(result.entry?.content).toContain('/model');
    });

    test('should show command arguments', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('<mode>');
      expect(result.entry?.content).toContain('[model]');
    });

    test('should include tips', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Tip:');
      expect(result.entry?.content).toContain('Ctrl+C');
    });

    test('should call getAllCommands', async () => {
      await handleHelp();

      expect(mockSlashManager.getAllCommands).toHaveBeenCalled();
    });
  });

  // ============================================
  // handleYoloMode Tests
  // ============================================
  describe('handleYoloMode', () => {
    test('should enable YOLO mode with "on"', () => {
      const result = handleYoloMode(['on']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('YOLO MODE: ENABLED');
      expect(mockAutonomyManager.enableYOLO).toHaveBeenCalledWith(false);
      expect(mockAutonomyManager.updateYOLOConfig).toHaveBeenCalledWith({
        maxAutoEdits: 50,
        maxAutoCommands: 100,
      });
    });

    test('should enable safe YOLO mode', () => {
      const result = handleYoloMode(['safe']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('YOLO MODE: SAFE');
      expect(mockAutonomyManager.enableYOLO).toHaveBeenCalledWith(true);
      expect(mockAutonomyManager.updateYOLOConfig).toHaveBeenCalledWith({
        maxAutoEdits: 20,
        maxAutoCommands: 30,
        allowedPaths: ['src/', 'test/', 'tests/'],
      });
    });

    test('should disable YOLO mode with "off"', () => {
      const result = handleYoloMode(['off']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('YOLO MODE: DISABLED');
      expect(mockAutonomyManager.disableYOLO).toHaveBeenCalled();
    });

    test('should add to allow list with "allow"', () => {
      const result = handleYoloMode(['allow', 'bash']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Added "bash" to YOLO allowed commands');
      expect(mockAutonomyManager.addToYOLOAllowList).toHaveBeenCalledWith('bash');
    });

    test('should show usage when allow has no command', () => {
      const result = handleYoloMode(['allow']);

      expect(result.entry?.content).toBe('Usage: /yolo allow <command>');
    });

    test('should add to deny list with "deny"', () => {
      const result = handleYoloMode(['deny', 'rm']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Added "rm" to YOLO denied commands');
      expect(mockAutonomyManager.addToYOLODenyList).toHaveBeenCalledWith('rm');
    });

    test('should show usage when deny has no command', () => {
      const result = handleYoloMode(['deny']);

      expect(result.entry?.content).toBe('Usage: /yolo deny <command>');
    });

    test('should show status with "status"', () => {
      mockAutonomyManager.formatYOLOStatus.mockReturnValue('YOLO Status Details');

      const result = handleYoloMode(['status']);

      expect(result.entry?.content).toBe('YOLO Status Details');
    });

    test('should show status by default with no args', () => {
      const result = handleYoloMode([]);

      expect(mockAutonomyManager.formatYOLOStatus).toHaveBeenCalled();
    });

    test('should handle case insensitive actions', () => {
      handleYoloMode(['ON']);
      expect(mockAutonomyManager.enableYOLO).toHaveBeenCalled();

      handleYoloMode(['OFF']);
      expect(mockAutonomyManager.disableYOLO).toHaveBeenCalled();

      handleYoloMode(['SAFE']);
      expect(mockAutonomyManager.enableYOLO).toHaveBeenCalledWith(true);
    });
  });

  // ============================================
  // handleAutonomy Tests
  // ============================================
  describe('handleAutonomy', () => {
    test('should set autonomy level to suggest', () => {
      const result = handleAutonomy(['suggest']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Autonomy Level: SUGGEST');
      expect(result.entry?.content).toContain('Suggests changes, you approve each one');
      expect(mockAutonomyManager.setLevel).toHaveBeenCalledWith('suggest');
    });

    test('should set autonomy level to confirm', () => {
      const result = handleAutonomy(['confirm']);

      expect(result.entry?.content).toContain('Autonomy Level: CONFIRM');
      expect(mockAutonomyManager.setLevel).toHaveBeenCalledWith('confirm');
    });

    test('should set autonomy level to auto', () => {
      const result = handleAutonomy(['auto']);

      expect(result.entry?.content).toContain('Autonomy Level: AUTO');
      expect(mockAutonomyManager.setLevel).toHaveBeenCalledWith('auto');
    });

    test('should set autonomy level to full', () => {
      const result = handleAutonomy(['full']);

      expect(result.entry?.content).toContain('Autonomy Level: FULL');
      expect(mockAutonomyManager.setLevel).toHaveBeenCalledWith('full');
    });

    test('should set autonomy level to yolo', () => {
      const result = handleAutonomy(['yolo']);

      expect(result.entry?.content).toContain('Autonomy Level: YOLO');
      expect(mockAutonomyManager.setLevel).toHaveBeenCalledWith('yolo');
    });

    test('should show current level and options with no args', () => {
      mockAutonomyManager.getLevel.mockReturnValue('confirm');

      const result = handleAutonomy([]);

      expect(result.entry?.content).toContain('Autonomy Settings');
      expect(result.entry?.content).toContain('Current: CONFIRM');
      expect(result.entry?.content).toContain('suggest');
      expect(result.entry?.content).toContain('confirm');
      expect(result.entry?.content).toContain('auto');
      expect(result.entry?.content).toContain('full');
      expect(result.entry?.content).toContain('yolo');
    });

    test('should show usage help with no args', () => {
      const result = handleAutonomy([]);

      expect(result.entry?.content).toContain('Usage: /autonomy <level>');
    });

    test('should handle case insensitive levels', () => {
      handleAutonomy(['SUGGEST']);
      expect(mockAutonomyManager.setLevel).toHaveBeenCalledWith('suggest');

      handleAutonomy(['Auto']);
      expect(mockAutonomyManager.setLevel).toHaveBeenCalledWith('auto');
    });

    test('should show current level for invalid level', () => {
      mockAutonomyManager.getLevel.mockReturnValue('auto');

      const result = handleAutonomy(['invalid']);

      expect(result.entry?.content).toContain('Current: AUTO');
    });
  });

  // ============================================
  // handlePipeline Tests
  // ============================================
  describe('handlePipeline', () => {
    test('should list pipelines with no args', () => {
      const result = handlePipeline([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Pipelines');
      expect(result.entry?.content).toContain('code-review');
      expect(result.entry?.content).toContain('bug-fix');
      expect(result.entry?.content).toContain('feature-development');
      expect(result.entry?.content).toContain('security-audit');
      expect(result.entry?.content).toContain('documentation');
    });

    test('should show usage example', () => {
      const result = handlePipeline([]);

      expect(result.entry?.content).toContain('Usage: /pipeline <name>');
      expect(result.entry?.content).toContain('Example:');
    });

    test('should run code-review pipeline', () => {
      const result = handlePipeline(['code-review', 'src/utils.ts']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('code-review pipeline');
      expect(result.prompt).toContain('src/utils.ts');
      expect(result.prompt).toContain('Analyze code structure');
    });

    test('should run bug-fix pipeline', () => {
      const result = handlePipeline(['bug-fix']);

      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('bug-fix pipeline');
      expect(result.prompt).toContain('Reproduce the issue');
      expect(result.prompt).toContain('Implement fix');
    });

    test('should run feature-development pipeline', () => {
      const result = handlePipeline(['feature-development']);

      expect(result.prompt).toContain('feature-development pipeline');
      expect(result.prompt).toContain('Understand requirements');
    });

    test('should run security-audit pipeline', () => {
      const result = handlePipeline(['security-audit']);

      expect(result.prompt).toContain('security-audit pipeline');
      expect(result.prompt).toContain('vulnerabilities');
    });

    test('should run documentation pipeline', () => {
      const result = handlePipeline(['documentation']);

      expect(result.prompt).toContain('documentation pipeline');
      expect(result.prompt).toContain('API documentation');
    });

    test('should use cwd as default target', () => {
      const result = handlePipeline(['code-review']);

      expect(result.prompt).toContain(process.cwd());
    });

    test('should handle unknown pipeline', () => {
      const result = handlePipeline(['unknown-pipeline']);

      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('unknown-pipeline pipeline');
      expect(result.prompt).toContain('Execute the pipeline steps');
    });
  });

  // ============================================
  // handleParallel Tests
  // ============================================
  describe('handleParallel', () => {
    test('should show usage with no args', () => {
      const result = handleParallel([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Parallel Subagent Runner');
      expect(result.entry?.content).toContain('Usage: /parallel <task description>');
      expect(result.entry?.content).toContain('Example:');
    });

    test('should pass task to AI', () => {
      const result = handleParallel(['analyze', 'all', 'TypeScript', 'files']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('analyze all TypeScript files');
    });

    test('should include parallelization hints', () => {
      const result = handleParallel(['process', 'files']);

      expect(result.prompt).toContain('parallel subagents');
      expect(result.prompt).toContain('Independent file analysis');
      expect(result.prompt).toContain('Multiple search queries');
      expect(result.prompt).toContain('Concurrent API calls');
    });
  });

  // ============================================
  // handleModelRouter Tests
  // ============================================
  describe('handleModelRouter', () => {
    test('should enable auto mode', () => {
      const result = handleModelRouter(['auto']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Model Router: AUTO MODE');
      expect(result.entry?.content).toContain('selected automatically');
    });

    test('should show task types in auto mode', () => {
      const result = handleModelRouter(['auto']);

      expect(result.entry?.content).toContain('search');
      expect(result.entry?.content).toContain('planning');
      expect(result.entry?.content).toContain('coding');
      expect(result.entry?.content).toContain('review');
      expect(result.entry?.content).toContain('debug');
    });

    test('should enable manual mode', () => {
      const result = handleModelRouter(['manual']);

      expect(result.entry?.content).toContain('Model Router: MANUAL MODE');
      expect(result.entry?.content).toContain('/model');
    });

    test('should show status by default', () => {
      const result = handleModelRouter([]);

      expect(result.entry?.content).toContain('Model Router Status');
      expect(result.entry?.content).toContain('Mode: Manual');
    });

    test('should show status with "status" action', () => {
      const result = handleModelRouter(['status']);

      expect(result.entry?.content).toContain('Model Router Status');
    });

    test('should show task-to-model mapping', () => {
      const result = handleModelRouter(['status']);

      expect(result.entry?.content).toContain('grok-code-fast-1');
      expect(result.entry?.content).toContain('grok-4-latest');
    });

    test('should show available commands in status', () => {
      const result = handleModelRouter(['status']);

      expect(result.entry?.content).toContain('/model-router auto');
      expect(result.entry?.content).toContain('/model-router manual');
    });

    test('should handle case insensitive actions', () => {
      const result = handleModelRouter(['AUTO']);

      expect(result.entry?.content).toContain('AUTO MODE');
    });
  });

  // ============================================
  // handleSkill Tests
  // ============================================
  describe('handleSkill', () => {
    beforeEach(() => {
      mockSkillManager.getAvailableSkills.mockReturnValue(['code-gen', 'testing', 'docs']);
      mockSkillManager.getSkill.mockImplementation((name: string) => ({
        name,
        description: `${name} skill description`,
      }));
    });

    test('should list skills with no args', () => {
      const result = handleSkill([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Skills');
      expect(mockSkillManager.getAvailableSkills).toHaveBeenCalled();
    });

    test('should list skills with "list" action', () => {
      const result = handleSkill(['list']);

      expect(result.entry?.content).toContain('Available Skills');
    });

    test('should show skill descriptions', () => {
      const result = handleSkill(['list']);

      expect(result.entry?.content).toContain('code-gen');
      expect(result.entry?.content).toContain('testing');
      expect(result.entry?.content).toContain('docs');
    });

    test('should indicate active skill', () => {
      mockSkillManager.getActiveSkill.mockReturnValue({ name: 'code-gen' });

      const result = handleSkill(['list']);

      // Active skill should have checkmark
      expect(result.entry?.content).toMatch(/[✅].*code-gen/);
    });

    test('should activate skill with "activate"', () => {
      mockSkillManager.activateSkill.mockReturnValue({
        name: 'testing',
        description: 'Testing skill',
      });

      const result = handleSkill(['activate', 'testing']);

      expect(result.entry?.content).toContain('Activated skill: testing');
      expect(mockSkillManager.activateSkill).toHaveBeenCalledWith('testing');
    });

    test('should show error for non-existent skill activation', () => {
      mockSkillManager.activateSkill.mockReturnValue(null);

      const result = handleSkill(['activate', 'nonexistent']);

      expect(result.entry?.content).toContain('Skill not found: nonexistent');
    });

    test('should deactivate skill', () => {
      const result = handleSkill(['deactivate']);

      expect(result.entry?.content).toContain('Skill deactivated');
      expect(mockSkillManager.deactivateSkill).toHaveBeenCalled();
    });

    test('should activate by skill name directly', () => {
      mockSkillManager.activateSkill.mockReturnValue({
        name: 'docs',
        description: 'Documentation skill',
      });

      const result = handleSkill(['docs']);

      expect(result.entry?.content).toContain('Activated skill: docs');
    });

    test('should show error for unknown action/skill', () => {
      mockSkillManager.activateSkill.mockReturnValue(null);

      const result = handleSkill(['unknown']);

      expect(result.entry?.content).toContain('Unknown skill: unknown');
      expect(result.entry?.content).toContain('/skill list');
    });

    test('should show commands help in list', () => {
      const result = handleSkill(['list']);

      expect(result.entry?.content).toContain('/skill list');
      expect(result.entry?.content).toContain('/skill activate');
      expect(result.entry?.content).toContain('/skill deactivate');
    });
  });

  // ============================================
  // handleSaveConversation Tests
  // ============================================
  describe('handleSaveConversation', () => {
    const sampleHistory: ChatEntry[] = [
      { type: 'user', content: 'Hello', timestamp: new Date() },
      { type: 'assistant', content: 'Hi there!', timestamp: new Date() },
    ];

    test('should save conversation successfully', () => {
      mockExporter.export.mockReturnValue({
        success: true,
        filePath: '/tmp/conversation.md',
      });

      const result = handleSaveConversation([], sampleHistory);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Conversation saved');
      expect(result.entry?.content).toContain('/tmp/conversation.md');
    });

    test('should use custom filename when provided', () => {
      handleSaveConversation(['my-chat.md'], sampleHistory);

      expect(mockExporter.export).toHaveBeenCalledWith(
        sampleHistory,
        expect.objectContaining({
          outputPath: 'my-chat.md',
        })
      );
    });

    test('should join multi-word filename', () => {
      handleSaveConversation(['my', 'chat', 'file.md'], sampleHistory);

      expect(mockExporter.export).toHaveBeenCalledWith(
        sampleHistory,
        expect.objectContaining({
          outputPath: 'my chat file.md',
        })
      );
    });

    test('should pass correct export options', () => {
      handleSaveConversation([], sampleHistory);

      expect(mockExporter.export).toHaveBeenCalledWith(
        sampleHistory,
        expect.objectContaining({
          format: 'markdown',
          includeToolResults: true,
          includeTimestamps: true,
        })
      );
    });

    test('should handle export failure', () => {
      mockExporter.export.mockReturnValue({
        success: false,
        error: 'Permission denied',
      });

      const result = handleSaveConversation([], sampleHistory);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Failed to save conversation');
      expect(result.entry?.content).toContain('Permission denied');
    });

    test('should handle empty history', () => {
      mockExporter.export.mockReturnValue({
        success: true,
        filePath: '/tmp/empty.md',
      });

      const result = handleSaveConversation([], []);

      expect(result.handled).toBe(true);
      expect(mockExporter.export).toHaveBeenCalledWith([], expect.any(Object));
    });
  });

  // ============================================
  // CommandHandlerResult Interface
  // ============================================
  describe('CommandHandlerResult Interface', () => {
    test('handleHelp should return correct async structure', async () => {
      const result = await handleHelp();

      expect(typeof result.handled).toBe('boolean');
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
      expect(typeof result.entry?.content).toBe('string');
      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });

    test('handleYoloMode should return correct structure', () => {
      const result = handleYoloMode(['on']);

      expect(typeof result.handled).toBe('boolean');
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
    });

    test('handlePipeline with args should have passToAI and prompt', () => {
      const result = handlePipeline(['code-review', 'file.ts']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(typeof result.prompt).toBe('string');
      expect(result.entry).toBeUndefined();
    });

    test('handleParallel with args should have passToAI and prompt', () => {
      const result = handleParallel(['do', 'something']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(typeof result.prompt).toBe('string');
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    test('handleYoloMode should handle undefined action', () => {
      const result = handleYoloMode([undefined as unknown as string]);

      expect(result.handled).toBe(true);
    });

    test('handleAutonomy should handle empty array', () => {
      const result = handleAutonomy([]);

      expect(result.handled).toBe(true);
    });

    test('handlePipeline should handle very long target path', () => {
      const longPath = 'a'.repeat(1000);
      const result = handlePipeline(['code-review', longPath]);

      expect(result.handled).toBe(true);
      expect(result.prompt).toContain(longPath);
    });

    test('handleSkill should handle empty skills list', () => {
      mockSkillManager.getAvailableSkills.mockReturnValue([]);

      const result = handleSkill(['list']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Skills');
    });

    test('handleSaveConversation should handle undefined filename', () => {
      handleSaveConversation([], []);

      expect(mockExporter.export).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          outputPath: undefined,
        })
      );
    });
  });
});
