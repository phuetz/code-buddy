/**
 * Tests for Colab Command Handler
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';

// Mock fs module
jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('Colab Handler', () => {
  let handleColabCommand: typeof import('../../src/commands/handlers/colab-handler.js').handleColabCommand;
  let resetAIColabManager: typeof import('../../src/collaboration/ai-colab-manager.js').resetAIColabManager;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup fs mocks
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('{}');
    mockFs.writeFileSync.mockImplementation(function() {});
    mockFs.mkdirSync.mockImplementation(() => undefined);

    // Dynamic imports
    const colabModule = await import('../../src/collaboration/ai-colab-manager.js');
    resetAIColabManager = colabModule.resetAIColabManager;

    const handlerModule = await import('../../src/commands/handlers/colab-handler.js');
    handleColabCommand = handlerModule.handleColabCommand;

    // Reset singleton
    resetAIColabManager();
  });

  afterEach(() => {
    resetAIColabManager();
  });

  describe('status command', () => {
    it('should show collaboration status', async () => {
      const result = await handleColabCommand(['status']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Statut de Collaboration');
      expect(result.action).toBe('status');
    });

    it('should default to status when no action provided', async () => {
      const result = await handleColabCommand([]);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Statut de Collaboration');
    });
  });

  describe('tasks command', () => {
    it('should list all tasks', async () => {
      const result = await handleColabCommand(['tasks']);

      expect(result.success).toBe(true);
      expect(result.action).toBe('tasks');
    });
  });

  describe('start command', () => {
    it('should fail without task ID', async () => {
      const result = await handleColabCommand(['start']);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Usage');
    });

    it('should fail for non-existent task', async () => {
      const result = await handleColabCommand(['start', 'non-existent-task']);

      expect(result.success).toBe(false);
      expect(result.output).toContain('not found');
    });
  });

  describe('complete command', () => {
    it('should show instructions when no task in progress', async () => {
      const result = await handleColabCommand(['complete']);

      expect(result.success).toBe(false);
      expect(result.output).toContain('No task in progress');
    });
  });

  describe('log command', () => {
    it('should show recent log when no entries', async () => {
      const result = await handleColabCommand(['log']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Work Log');
    });

    it('should show usage for log add without args', async () => {
      const result = await handleColabCommand(['log', 'add']);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Usage');
    });

    it('should add log entry with valid args', async () => {
      const result = await handleColabCommand([
        'log', 'add',
        '--agent', 'Claude',
        '--summary', 'Test entry',
        '--files', 'file1.ts,file2.ts'
      ]);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Work Log Entry Added');
      expect(result.action).toBe('log-add');
    });
  });

  describe('handoff command', () => {
    it('should show usage without target agent', async () => {
      const result = await handleColabCommand(['handoff']);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Usage');
    });

    it('should create handoff with target agent', async () => {
      const result = await handleColabCommand([
        'handoff', 'Gemini',
        '--from', 'Claude',
        '--context', 'Working on feature'
      ]);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Handoff Created');
      expect(result.output).toContain('Gemini');
    });
  });

  describe('init command', () => {
    it('should initialize default tasks', async () => {
      const result = await handleColabCommand(['init']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Collaboration Initialized');
      expect(result.action).toBe('init');
    });
  });

  describe('instructions command', () => {
    it('should generate instructions for default agent', async () => {
      const result = await handleColabCommand(['instructions']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Instructions de Collaboration');
      expect(result.action).toBe('instructions');
    });

    it('should generate instructions for named agent', async () => {
      const result = await handleColabCommand(['instructions', 'Gemini']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Gemini');
    });
  });

  describe('create command', () => {
    it('should show usage without args', async () => {
      const result = await handleColabCommand(['create']);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Usage');
    });

    it('should create task with title and description', async () => {
      const result = await handleColabCommand([
        'create',
        'New Feature',
        'Implement new feature X',
        '--priority', 'high'
      ]);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Task Created');
      expect(result.output).toContain('New Feature');
      expect(result.action).toBe('create');
    });
  });

  describe('help command', () => {
    it('should show help', async () => {
      const result = await handleColabCommand(['help']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('AI Collaboration Commands');
      expect(result.output).toContain('/colab status');
      expect(result.action).toBe('help');
    });
  });
});
