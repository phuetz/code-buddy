/**
 * Tests for Enhanced Memory System
 */

import { EnhancedMemory, getEnhancedMemory, resetEnhancedMemory } from '../src/memory/enhanced-memory';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(false),
  readJSON: jest.fn().mockResolvedValue([]),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
}));

describe('EnhancedMemory', () => {
  let memory: EnhancedMemory;

  beforeEach(() => {
    resetEnhancedMemory();
    memory = new EnhancedMemory({
      enabled: true,
      maxMemories: 100,
      embeddingEnabled: false,
    });
  });

  afterEach(() => {
    memory.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const m = new EnhancedMemory();
      expect(m).toBeDefined();
      m.dispose();
    });

    it('should accept custom config', () => {
      const m = new EnhancedMemory({
        maxMemories: 50,
        decayRate: 0.05,
      });
      expect(m).toBeDefined();
      m.dispose();
    });
  });

  describe('store', () => {
    it('should store a memory', async () => {
      const entry = await memory.store({
        type: 'fact',
        content: 'The project uses TypeScript',
      });

      expect(entry.id).toBeDefined();
      expect(entry.type).toBe('fact');
      expect(entry.content).toBe('The project uses TypeScript');
    });

    it('should assign importance based on type', async () => {
      const decision = await memory.store({
        type: 'decision',
        content: 'We chose React for the frontend',
      });

      const context = await memory.store({
        type: 'context',
        content: 'Some context info',
      });

      expect(decision.importance).toBeGreaterThan(context.importance);
    });

    it('should support tags', async () => {
      const entry = await memory.store({
        type: 'fact',
        content: 'Tagged memory',
        tags: ['important', 'architecture'],
      });

      expect(entry.tags).toContain('important');
      expect(entry.tags).toContain('architecture');
    });

    it('should support expiration', async () => {
      const entry = await memory.store({
        type: 'context',
        content: 'Temporary memory',
        expiresIn: 7, // 7 days
      });

      expect(entry.expiresAt).toBeDefined();
    });
  });

  describe('recall', () => {
    it('should recall stored memories', async () => {
      await memory.store({
        type: 'fact',
        content: 'Memory 1',
      });
      await memory.store({
        type: 'fact',
        content: 'Memory 2',
      });

      const results = await memory.recall();

      expect(results.length).toBe(2);
    });

    it('should filter by type', async () => {
      await memory.store({ type: 'fact', content: 'A fact' });
      await memory.store({ type: 'preference', content: 'A preference' });
      await memory.store({ type: 'decision', content: 'A decision' });

      const facts = await memory.recall({ types: ['fact'] });
      expect(facts.length).toBe(1);
      expect(facts[0].type).toBe('fact');
    });

    it('should filter by tags', async () => {
      await memory.store({
        type: 'fact',
        content: 'Tagged 1',
        tags: ['important'],
      });
      await memory.store({
        type: 'fact',
        content: 'Tagged 2',
        tags: ['minor'],
      });

      const results = await memory.recall({ tags: ['important'] });
      expect(results.length).toBe(1);
    });

    it('should filter by minimum importance', async () => {
      await memory.store({
        type: 'decision',
        content: 'High importance',
        importance: 0.9,
      });
      await memory.store({
        type: 'context',
        content: 'Low importance',
        importance: 0.3,
      });

      const results = await memory.recall({ minImportance: 0.8 });
      expect(results.every(r => r.importance >= 0.8)).toBe(true);
    });

    it('should limit results', async () => {
      for (let i = 0; i < 10; i++) {
        await memory.store({ type: 'fact', content: `Memory ${i}` });
      }

      const results = await memory.recall({ limit: 5 });
      expect(results.length).toBe(5);
    });

    it('should search by query', async () => {
      await memory.store({
        type: 'fact',
        content: 'The project uses React',
      });
      await memory.store({
        type: 'fact',
        content: 'The API uses Express',
      });

      const results = await memory.recall({ query: 'React' });
      expect(results.length).toBe(1);
      expect(results[0].content).toContain('React');
    });
  });

  describe('forget', () => {
    it('should remove memory', async () => {
      const entry = await memory.store({
        type: 'fact',
        content: 'To be forgotten',
      });

      const result = await memory.forget(entry.id);
      expect(result).toBe(true);

      const recalled = await memory.recall();
      expect(recalled.find(m => m.id === entry.id)).toBeUndefined();
    });

    it('should return false for unknown id', async () => {
      const result = await memory.forget('unknown-id');
      expect(result).toBe(false);
    });
  });

  describe('setProjectContext', () => {
    it('should set project context', async () => {
      const project = await memory.setProjectContext('/path/to/project');

      expect(project.projectPath).toBe('/path/to/project');
      expect(project.name).toBe('project');
    });
  });

  describe('getProjectMemory', () => {
    it('should return null when no project', () => {
      const project = memory.getProjectMemory();
      expect(project).toBeNull();
    });

    it('should return current project', async () => {
      await memory.setProjectContext('/my/project');

      const project = memory.getProjectMemory();
      expect(project).not.toBeNull();
    });
  });

  describe('learnConvention', () => {
    it('should learn code conventions', async () => {
      await memory.setProjectContext('/my/project');

      await memory.learnConvention({
        type: 'naming',
        rule: 'Use camelCase for variables',
        examples: ['myVariable', 'userName'],
      });

      const project = memory.getProjectMemory();
      expect(project?.conventions.length).toBe(1);
      expect(project?.conventions[0].rule).toContain('camelCase');
    });

    it('should increase confidence for repeated conventions', async () => {
      await memory.setProjectContext('/my/project');

      await memory.learnConvention({
        type: 'naming',
        rule: 'Use camelCase',
        confidence: 0.5,
      });

      await memory.learnConvention({
        type: 'naming',
        rule: 'Use camelCase',
      });

      const project = memory.getProjectMemory();
      expect(project?.conventions[0].confidence).toBeGreaterThan(0.5);
    });
  });

  describe('storeSummary', () => {
    it('should store conversation summary', async () => {
      const summary = await memory.storeSummary({
        sessionId: 'session-1',
        summary: 'Discussed project architecture',
        topics: ['architecture', 'design'],
        messageCount: 20,
      });

      expect(summary.id).toBeDefined();
      expect(summary.summary).toBe('Discussed project architecture');
    });
  });

  describe('updateUserProfile', () => {
    it('should create profile if not exists', async () => {
      const profile = await memory.updateUserProfile({
        preferences: {
          codeStyle: 'functional',
          verbosity: 'detailed',
        },
      });

      expect(profile.id).toBeDefined();
      expect(profile.preferences.codeStyle).toBe('functional');
    });

    it('should update existing profile', async () => {
      await memory.updateUserProfile({
        preferences: { codeStyle: 'oop', verbosity: 'minimal' },
      });

      const profile = await memory.updateUserProfile({
        interests: ['TypeScript', 'React'],
      });

      expect(profile.preferences.codeStyle).toBe('oop');
      expect(profile.interests).toContain('TypeScript');
    });
  });

  describe('getUserProfile', () => {
    it('should return null initially', () => {
      expect(memory.getUserProfile()).toBeNull();
    });

    it('should return profile after update', async () => {
      await memory.updateUserProfile({
        preferences: { codeStyle: 'modern', verbosity: 'moderate' },
      });

      const profile = memory.getUserProfile();
      expect(profile).not.toBeNull();
    });
  });

  describe('buildContext', () => {
    it('should build context from memories', async () => {
      await memory.store({
        type: 'fact',
        content: 'Important project info',
        importance: 0.9,
      });

      const context = await memory.buildContext({
        query: 'project',
      });

      expect(context).toContain('Important project info');
    });

    it('should include user preferences', async () => {
      await memory.updateUserProfile({
        preferences: { codeStyle: 'functional', verbosity: 'minimal' },
      });

      const context = await memory.buildContext({
        includePreferences: true,
      });

      expect(context).toContain('preferences');
    });
  });

  describe('getStats', () => {
    it('should return memory stats', async () => {
      await memory.store({ type: 'fact', content: 'Fact 1' });
      await memory.store({ type: 'fact', content: 'Fact 2' });
      await memory.store({ type: 'decision', content: 'Decision 1' });

      const stats = memory.getStats();

      expect(stats.totalMemories).toBe(3);
      expect(stats.byType.fact).toBe(2);
      expect(stats.byType.decision).toBe(1);
    });
  });

  describe('formatStatus', () => {
    it('should render status', () => {
      const status = memory.formatStatus();

      expect(status).toContain('MEMORY SYSTEM');
      expect(status).toContain('Total Memories');
    });
  });

  describe('clear', () => {
    it('should clear all memories', async () => {
      await memory.store({ type: 'fact', content: 'Memory 1' });
      await memory.store({ type: 'fact', content: 'Memory 2' });

      await memory.clear();

      const stats = memory.getStats();
      expect(stats.totalMemories).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit memory:stored event', async () => {
      const handler = jest.fn();
      memory.on('memory:stored', handler);

      await memory.store({ type: 'fact', content: 'Test' });

      expect(handler).toHaveBeenCalled();
    });

    it('should emit memory:forgotten event', async () => {
      const handler = jest.fn();
      memory.on('memory:forgotten', handler);

      const entry = await memory.store({ type: 'fact', content: 'Test' });
      await memory.forget(entry.id);

      expect(handler).toHaveBeenCalled();
    });

    it('should emit memory:cleared event', async () => {
      const handler = jest.fn();
      memory.on('memory:cleared', handler);

      await memory.clear();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetEnhancedMemory();
      const instance1 = getEnhancedMemory();
      const instance2 = getEnhancedMemory();
      expect(instance1).toBe(instance2);
    });
  });
});
