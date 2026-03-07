/**
 * Tests for AI Collaboration Manager
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock fs module
jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('AIColabManager', () => {
  let AIColabManager: typeof import('../../src/collaboration/ai-colab-manager.js').AIColabManager;
  let getAIColabManager: typeof import('../../src/collaboration/ai-colab-manager.js').getAIColabManager;
  let resetAIColabManager: typeof import('../../src/collaboration/ai-colab-manager.js').resetAIColabManager;

  const testDir = '/test/project';

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup fs mocks
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('{}');
    mockFs.writeFileSync.mockImplementation(function() {});
    mockFs.mkdirSync.mockImplementation(() => undefined);

    // Dynamic import to get fresh module
    const module = await import('../../src/collaboration/ai-colab-manager.js');
    AIColabManager = module.AIColabManager;
    getAIColabManager = module.getAIColabManager;
    resetAIColabManager = module.resetAIColabManager;

    // Reset singleton
    resetAIColabManager();
  });

  afterEach(() => {
    resetAIColabManager();
  });

  describe('constructor', () => {
    it('should create manager with default config', () => {
      const manager = new AIColabManager(testDir);
      expect(manager).toBeDefined();
    });

    it('should use current directory by default', () => {
      const manager = new AIColabManager();
      expect(manager).toBeDefined();
    });
  });

  describe('Task Management', () => {
    it('should create a new task', () => {
      const manager = new AIColabManager(testDir);

      const task = manager.createTask({
        title: 'Test Task',
        description: 'A test task',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: ['file1.ts', 'file2.ts'],
        acceptanceCriteria: ['Criterion 1'],
        proofOfFunctionality: ['npm test']
      });

      expect(task.id).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('not_started');
    });

    it('should get all tasks', () => {
      const manager = new AIColabManager(testDir);

      manager.createTask({
        title: 'Task 1',
        description: 'Description 1',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      manager.createTask({
        title: 'Task 2',
        description: 'Description 2',
        status: 'in_progress',
        priority: 'medium',
        maxFiles: 5,
        estimatedTests: 3,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      const tasks = manager.getTasks();
      expect(tasks).toHaveLength(2);
    });

    it('should get tasks by status', () => {
      const manager = new AIColabManager(testDir);

      manager.createTask({
        title: 'Task 1',
        description: 'Description 1',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      manager.createTask({
        title: 'Task 2',
        description: 'Description 2',
        status: 'in_progress',
        priority: 'medium',
        maxFiles: 5,
        estimatedTests: 3,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      const notStarted = manager.getTasksByStatus('not_started');
      expect(notStarted).toHaveLength(1);
      expect(notStarted[0].title).toBe('Task 1');

      const inProgress = manager.getTasksByStatus('in_progress');
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].title).toBe('Task 2');
    });

    it('should get next available task by priority', () => {
      const manager = new AIColabManager(testDir);

      manager.createTask({
        title: 'Low Priority',
        description: 'Low priority task',
        status: 'not_started',
        priority: 'low',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      manager.createTask({
        title: 'High Priority',
        description: 'High priority task',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      const next = manager.getNextTask();
      expect(next).toBeDefined();
      expect(next?.title).toBe('High Priority');
    });

    it('should start a task', () => {
      const manager = new AIColabManager(testDir);

      const task = manager.createTask({
        title: 'Test Task',
        description: 'A test task',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      const result = manager.startTask(task.id, 'Claude');

      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('in_progress');
      expect(result.task?.assignedAgent).toBe('Claude');
    });

    it('should not start a task that is already in progress', () => {
      const manager = new AIColabManager(testDir);

      const task = manager.createTask({
        title: 'Test Task',
        description: 'A test task',
        status: 'in_progress',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      const result = manager.startTask(task.id, 'Gemini');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in progress');
    });

    it('should update task status', () => {
      const manager = new AIColabManager(testDir);

      const task = manager.createTask({
        title: 'Test Task',
        description: 'A test task',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      const result = manager.updateTaskStatus(task.id, 'completed');
      expect(result).toBe(true);

      const tasks = manager.getTasksByStatus('completed');
      expect(tasks).toHaveLength(1);
    });
  });

  describe('Work Log', () => {
    it('should add work log entry', () => {
      const manager = new AIColabManager(testDir);

      const entry = manager.addWorkLogEntry({
        agent: 'Claude',
        summary: 'Implemented feature X',
        filesModified: [{ file: 'file1.ts', changes: 'added feature' }],
        testsAdded: [{ file: 'file1.test.ts', count: 5 }],
        proofOfFunctionality: 'npm test',
        issues: [],
        nextSteps: ['Continue with feature Y']
      });

      expect(entry.id).toBeDefined();
      expect(entry.agent).toBe('Claude');
      expect(entry.date).toBeDefined();
    });

    it('should get recent work log entries', () => {
      const manager = new AIColabManager(testDir);

      manager.addWorkLogEntry({
        agent: 'Claude',
        summary: 'Entry 1',
        filesModified: [],
        testsAdded: [],
        proofOfFunctionality: '',
        issues: [],
        nextSteps: []
      });

      manager.addWorkLogEntry({
        agent: 'Gemini',
        summary: 'Entry 2',
        filesModified: [],
        testsAdded: [],
        proofOfFunctionality: '',
        issues: [],
        nextSteps: []
      });

      const recent = manager.getRecentWorkLog(2);
      expect(recent).toHaveLength(2);
    });
  });

  describe('Handoff', () => {
    it('should create handoff markdown', () => {
      const manager = new AIColabManager(testDir);

      const handoff = manager.createHandoff({
        fromAgent: 'Claude',
        toAgent: 'Gemini',
        currentTask: 'task-123',
        taskStatus: 'in_progress',
        context: 'Working on feature X',
        filesInProgress: [{ file: 'file1.ts', state: 'modified' }],
        blockers: ['Need API key'],
        recommendedNextSteps: ['Complete implementation', 'Add tests']
      });

      expect(handoff).toContain('Handoff from Claude to Gemini');
      expect(handoff).toContain('task-123');
      expect(handoff).toContain('Working on feature X');
      expect(handoff).toContain('Need API key');
    });
  });

  describe('Agent Instructions', () => {
    it('should generate instructions for new agent', () => {
      const manager = new AIColabManager(testDir);

      const instructions = manager.generateAgentInstructions('Gemini');

      expect(instructions).toContain('Instructions de Collaboration');
      expect(instructions).toContain('Gemini');
      expect(instructions).toContain('/colab status');
    });
  });

  describe('Status and Reports', () => {
    it('should generate status report', () => {
      const manager = new AIColabManager(testDir);

      manager.createTask({
        title: 'Task 1',
        description: 'Description',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      const status = manager.getStatus();

      expect(status).toContain('Statut de Collaboration');
      expect(status).toContain('Non commencées');
    });

    it('should list tasks formatted', () => {
      const manager = new AIColabManager(testDir);

      manager.createTask({
        title: 'Task 1',
        description: 'Description',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 5,
        filesToModify: [],
        acceptanceCriteria: [],
        proofOfFunctionality: []
      });

      const list = manager.listTasks();

      expect(list).toContain('Liste des tâches');
      expect(list).toContain('Task 1');
    });
  });

  describe('Default Tasks', () => {
    it('should initialize default tasks', () => {
      const manager = new AIColabManager(testDir);

      manager.initializeDefaultTasks();

      const tasks = manager.getTasks();
      expect(tasks.length).toBeGreaterThan(0);

      // Should include the predefined tasks
      const titles = tasks.map(t => t.title);
      expect(titles).toContain('Base Agent Extraction');
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const manager1 = getAIColabManager(testDir);
      const manager2 = getAIColabManager();

      expect(manager1).toBe(manager2);
    });

    it('should reset singleton', () => {
      const manager1 = getAIColabManager(testDir);
      resetAIColabManager();
      const manager2 = getAIColabManager(testDir);

      expect(manager1).not.toBe(manager2);
    });
  });
});
