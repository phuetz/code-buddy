/**
 * Tests for Core Command Handlers
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
} from '../../src/commands/handlers/core-handlers.js';
import { ChatEntry } from '../../src/agent/codebuddy-agent.js';
import { getAutonomyManager } from '../../src/utils/autonomy-manager.js';
import { resetSkillManager } from '../../src/skills/skill-manager.js';

// Reset managers before each test
beforeEach(() => {
  // Reset autonomy to default state
  const manager = getAutonomyManager();
  manager.setLevel('suggest');
  manager.disableYOLO();

  resetSkillManager();
});

describe('Core Handlers', () => {
  describe('handleHelp', () => {
    it('should return help text with command categories', async () => {
      const result = await handleHelp();

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.content).toContain('GROK CLI COMMANDS');
      expect(result.entry?.content).toContain('Core');
    });

    it('should include multiple command categories', async () => {
      const result = await handleHelp();

      const content = result.entry?.content || '';
      expect(content).toContain('Code & Development');
      expect(content).toContain('Git & Version Control');
      expect(content).toContain('Context & Memory');
      expect(content).toContain('Session & Export');
      expect(content).toContain('Settings & UI');
    });

    it('should include tip about natural conversation', async () => {
      const result = await handleHelp();

      expect(result.entry?.content).toContain('Type naturally to chat');
      expect(result.entry?.content).toContain('Ctrl+C');
    });
  });

  describe('handleYoloMode', () => {
    it('should enable YOLO mode', () => {
      const result = handleYoloMode(['on']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('YOLO MODE');
      expect(result.entry?.content).toContain('ENABLED');
      expect(result.entry?.content).toContain('Auto-approval is ON');
    });

    it('should enable safe YOLO mode', () => {
      const result = handleYoloMode(['safe']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('YOLO MODE');
      expect(result.entry?.content).toContain('SAFE');
      expect(result.entry?.content).toContain('restrictions');
    });

    it('should disable YOLO mode', () => {
      // First enable
      handleYoloMode(['on']);

      // Then disable
      const result = handleYoloMode(['off']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('DISABLED');
      expect(result.entry?.content).toContain('Manual approval');
    });

    it('should add command to allow list', () => {
      handleYoloMode(['on']);
      const result = handleYoloMode(['allow', 'npm-install']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Added');
      expect(result.entry?.content).toContain('npm-install');
      expect(result.entry?.content).toContain('allowed');
    });

    it('should show usage for allow without command', () => {
      const result = handleYoloMode(['allow']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Usage:');
    });

    it('should add command to deny list', () => {
      handleYoloMode(['on']);
      const result = handleYoloMode(['deny', 'rm-rf']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Added');
      expect(result.entry?.content).toContain('rm-rf');
      expect(result.entry?.content).toContain('denied');
    });

    it('should show usage for deny without command', () => {
      const result = handleYoloMode(['deny']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Usage:');
    });

    it('should show status with explicit status command', () => {
      const result = handleYoloMode(['status']);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should show status by default with no args', () => {
      const result = handleYoloMode([]);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should handle unknown action as status', () => {
      const result = handleYoloMode(['unknown']);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });
  });

  describe('handleAutonomy', () => {
    it('should set suggest level', () => {
      const result = handleAutonomy(['suggest']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('SUGGEST');
      expect(result.entry?.content).toContain('Suggests changes');
    });

    it('should set confirm level', () => {
      const result = handleAutonomy(['confirm']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('CONFIRM');
    });

    it('should set auto level', () => {
      const result = handleAutonomy(['auto']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('AUTO');
      expect(result.entry?.content).toContain('Auto-approves safe operations');
    });

    it('should set full level', () => {
      const result = handleAutonomy(['full']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('FULL');
      expect(result.entry?.content).toContain('caution');
    });

    it('should set yolo level', () => {
      const result = handleAutonomy(['yolo']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('YOLO');
    });

    it('should show current level and options when no args', () => {
      const result = handleAutonomy([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Autonomy Settings');
      expect(result.entry?.content).toContain('Current:');
      expect(result.entry?.content).toContain('Levels:');
    });

    it('should show current level for invalid level', () => {
      const result = handleAutonomy(['invalid']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Autonomy Settings');
    });

    it('should handle case insensitivity', () => {
      const result = handleAutonomy(['CONFIRM']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('CONFIRM');
    });
  });

  describe('handlePipeline', () => {
    it('should list available pipelines when no args', () => {
      const result = handlePipeline([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Pipelines');
      expect(result.entry?.content).toContain('code-review');
      expect(result.entry?.content).toContain('bug-fix');
      expect(result.entry?.content).toContain('feature-development');
      expect(result.entry?.content).toContain('security-audit');
      expect(result.entry?.content).toContain('documentation');
    });

    it('should run code-review pipeline with target', () => {
      const result = handlePipeline(['code-review', 'src/utils.ts']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('code-review');
      expect(result.prompt).toContain('src/utils.ts');
      expect(result.prompt).toContain('code smells');
    });

    it('should run bug-fix pipeline', () => {
      const result = handlePipeline(['bug-fix', 'src/main.ts']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('bug-fix');
      expect(result.prompt).toContain('root cause');
    });

    it('should run feature-development pipeline', () => {
      const result = handlePipeline(['feature-development', 'new-feature']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('feature-development');
    });

    it('should run security-audit pipeline', () => {
      const result = handlePipeline(['security-audit', 'src/']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('security-audit');
      expect(result.prompt).toContain('vulnerabilities');
    });

    it('should run documentation pipeline', () => {
      const result = handlePipeline(['documentation', 'src/']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('documentation');
      expect(result.prompt).toContain('API documentation');
    });

    it('should use cwd as default target', () => {
      const result = handlePipeline(['code-review']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toBeDefined();
    });

    it('should handle unknown pipeline name', () => {
      const result = handlePipeline(['unknown-pipeline', 'target']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('unknown-pipeline');
    });
  });

  describe('handleParallel', () => {
    it('should show usage when no task provided', () => {
      const result = handleParallel([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Parallel Subagent Runner');
      expect(result.entry?.content).toContain('Usage:');
    });

    it('should pass task to AI for parallel execution', () => {
      const result = handleParallel(['analyze', 'all', 'TypeScript', 'files']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('analyze all TypeScript files');
      expect(result.prompt).toContain('parallel');
    });

    it('should include parallel operation suggestions', () => {
      const result = handleParallel(['test', 'task']);

      expect(result.prompt).toContain('Independent file analysis');
      expect(result.prompt).toContain('Multiple search queries');
      expect(result.prompt).toContain('Concurrent API calls');
    });
  });

  describe('handleModelRouter', () => {
    it('should enable auto mode', () => {
      const result = handleModelRouter(['auto']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('AUTO MODE');
      expect(result.entry?.content).toContain('automatically');
    });

    it('should show task type mappings in auto mode', () => {
      const result = handleModelRouter(['auto']);

      expect(result.entry?.content).toContain('Task Types');
      expect(result.entry?.content).toContain('search');
      expect(result.entry?.content).toContain('planning');
      expect(result.entry?.content).toContain('coding');
    });

    it('should enable manual mode', () => {
      const result = handleModelRouter(['manual']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('MANUAL MODE');
    });

    it('should show status by default', () => {
      const result = handleModelRouter([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Model Router Status');
      expect(result.entry?.content).toContain('Task-to-Model Mapping');
    });

    it('should show status with explicit command', () => {
      const result = handleModelRouter(['status']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Model Router Status');
    });

    it('should show available commands', () => {
      const result = handleModelRouter(['status']);

      expect(result.entry?.content).toContain('/model-router auto');
      expect(result.entry?.content).toContain('/model-router manual');
    });
  });

  describe('handleSkill', () => {
    it('should list skills when no args', () => {
      const result = handleSkill([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Skills');
    });

    it('should list skills with explicit list command', () => {
      const result = handleSkill(['list']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Skills');
    });

    it('should show skill commands in help', () => {
      const result = handleSkill([]);

      expect(result.entry?.content).toContain('Commands:');
      expect(result.entry?.content).toContain('/skill list');
      expect(result.entry?.content).toContain('/skill activate');
      expect(result.entry?.content).toContain('/skill deactivate');
    });

    it('should deactivate skill', () => {
      const result = handleSkill(['deactivate']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('deactivated');
    });

    it('should handle unknown skill activation', () => {
      const result = handleSkill(['activate', 'nonexistent-skill']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('not found');
    });

    it('should handle unknown skill with quick activate', () => {
      const result = handleSkill(['nonexistent']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Unknown skill');
    });
  });

  describe('handleSaveConversation', () => {
    const mockHistory: ChatEntry[] = [
      {
        type: 'user',
        content: 'Hello',
        timestamp: new Date('2024-01-01T10:00:00'),
      },
      {
        type: 'assistant',
        content: 'Hi there!',
        timestamp: new Date('2024-01-01T10:00:01'),
      },
    ];

    it('should save conversation with default filename', () => {
      const result = handleSaveConversation([], mockHistory);

      expect(result.handled).toBe(true);
      // May succeed or fail depending on filesystem permissions
      expect(result.entry).toBeDefined();
    });

    it('should save conversation with custom filename', () => {
      const result = handleSaveConversation(['custom-chat.md'], mockHistory);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should handle empty conversation', () => {
      const result = handleSaveConversation([], []);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should include file path in success message', () => {
      const result = handleSaveConversation([], mockHistory);

      if (result.entry?.content?.includes('✅')) {
        expect(result.entry.content).toContain('File:');
        expect(result.entry.content).toContain('Markdown format');
      }
    });
  });
});

describe('CommandHandlerResult Interface', () => {
  it('should support minimal result', () => {
    const result: CommandHandlerResult = {
      handled: true,
    };

    expect(result.handled).toBe(true);
    expect(result.entry).toBeUndefined();
    expect(result.passToAI).toBeUndefined();
  });

  it('should support full result with entry', () => {
    const result: CommandHandlerResult = {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Test message',
        timestamp: new Date(),
      },
      passToAI: false,
      prompt: 'Additional prompt',
    };

    expect(result.handled).toBe(true);
    expect(result.entry?.type).toBe('assistant');
    expect(result.entry?.content).toBe('Test message');
    expect(result.passToAI).toBe(false);
    expect(result.prompt).toBe('Additional prompt');
  });

  it('should support passToAI with prompt', () => {
    const result: CommandHandlerResult = {
      handled: true,
      passToAI: true,
      prompt: 'Process this request',
    };

    expect(result.passToAI).toBe(true);
    expect(result.prompt).toBe('Process this request');
  });
});
