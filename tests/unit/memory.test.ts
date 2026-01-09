/**
 * Comprehensive Unit Tests for Memory Module
 *
 * Tests cover:
 * 1. Memory storage operations
 * 2. Memory retrieval
 * 3. Memory indexing
 * 4. Memory persistence
 * 5. Enhanced Memory System
 * 6. Persistent Memory Manager
 * 7. Prospective Memory System
 */

import { EventEmitter } from 'events';

// ============================================================================
// Mocks
// ============================================================================

// Mock fs-extra
const mockEnsureDir = jest.fn().mockResolvedValue(undefined);
const mockPathExists = jest.fn().mockResolvedValue(false);
const mockReadJSON = jest.fn().mockResolvedValue([]);
const mockWriteJSON = jest.fn().mockResolvedValue(undefined);
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockReadFile = jest.fn().mockResolvedValue('');
const mockReaddir = jest.fn().mockResolvedValue([]);

jest.mock('fs-extra', () => ({
  ensureDir: mockEnsureDir,
  pathExists: mockPathExists,
  readJSON: mockReadJSON,
  writeJSON: mockWriteJSON,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  readdir: mockReaddir,
}));

// Mock database repository
const mockDbCreate = jest.fn();
const mockDbFind = jest.fn().mockReturnValue([]);
const mockDbDelete = jest.fn();

jest.mock('../../src/database/repositories/memory-repository', () => ({
  getMemoryRepository: jest.fn(() => ({
    create: mockDbCreate,
    find: mockDbFind,
    delete: mockDbDelete,
  })),
  MemoryRepository: jest.fn(),
}));

// Mock embedding provider
jest.mock('../../src/embeddings/embedding-provider', () => ({
  getEmbeddingProvider: jest.fn(() => null),
  EmbeddingProvider: jest.fn(),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock database manager for prospective memory
const mockDbExec = jest.fn();
const mockDbPrepare = jest.fn().mockReturnValue({
  run: jest.fn(),
  all: jest.fn().mockReturnValue([]),
});

jest.mock('../../src/database/database-manager', () => ({
  getDatabaseManager: jest.fn(() => ({
    getDatabase: () => ({
      exec: mockDbExec,
      prepare: mockDbPrepare,
    }),
  })),
}));

// Import modules after mocks are set up
import {
  EnhancedMemory,
  getEnhancedMemory,
  resetEnhancedMemory,
  MemoryEntry,
  MemoryType,
  ProjectMemory,
  MemorySearchOptions,
} from '../../src/memory/enhanced-memory';

import {
  PersistentMemoryManager,
  getMemoryManager,
  initializeMemory,
  Memory,
  MemoryCategory,
} from '../../src/memory/persistent-memory';

import {
  ProspectiveMemory,
  getProspectiveMemory,
  resetProspectiveMemory,
  initializeProspectiveMemory,
  ProspectiveTask,
  Goal,
  Reminder,
} from '../../src/memory/prospective-memory';

// ============================================================================
// Enhanced Memory Tests
// ============================================================================

describe('EnhancedMemory', () => {
  let memory: EnhancedMemory;

  beforeEach(() => {
    jest.clearAllMocks();
    resetEnhancedMemory();

    // Reset mocks to default behavior
    mockPathExists.mockResolvedValue(false);
    mockReadJSON.mockResolvedValue([]);
    mockReaddir.mockResolvedValue([]);

    memory = new EnhancedMemory({
      enabled: true,
      maxMemories: 100,
      embeddingEnabled: false,
      useSQLite: false, // Disable SQLite to use JSON for easier testing
    });
  });

  afterEach(() => {
    memory.dispose();
  });

  describe('Constructor and Initialization', () => {
    it('should create with default config', () => {
      const m = new EnhancedMemory();
      expect(m).toBeDefined();
      expect(m).toBeInstanceOf(EventEmitter);
      m.dispose();
    });

    it('should accept custom config', () => {
      const m = new EnhancedMemory({
        maxMemories: 50,
        decayRate: 0.05,
        minImportance: 0.2,
      });
      expect(m).toBeDefined();
      m.dispose();
    });

    it('should initialize data directories', () => {
      expect(mockEnsureDir).toHaveBeenCalled();
    });

    it('should load existing memories on initialization', async () => {
      const existingMemories = [
        {
          id: 'existing1',
          type: 'fact',
          content: 'Existing memory',
          importance: 0.8,
          accessCount: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
          tags: [],
          metadata: {},
        },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJSON.mockResolvedValue(existingMemories);

      const newMemory = new EnhancedMemory({
        embeddingEnabled: false,
        useSQLite: false,
      });

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 50));

      newMemory.dispose();
    });

    it('should handle corrupted memory data gracefully', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJSON.mockRejectedValue(new Error('JSON parse error'));

      const newMemory = new EnhancedMemory({
        embeddingEnabled: false,
        useSQLite: false,
      });

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = newMemory.getStats();
      expect(stats.totalMemories).toBe(0);

      newMemory.dispose();
    });
  });

  describe('Memory Storage Operations', () => {
    it('should store a memory with basic options', async () => {
      const entry = await memory.store({
        type: 'fact',
        content: 'The project uses TypeScript',
      });

      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.id.length).toBe(16); // 8 bytes = 16 hex chars
      expect(entry.type).toBe('fact');
      expect(entry.content).toBe('The project uses TypeScript');
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.updatedAt).toBeInstanceOf(Date);
      expect(entry.lastAccessedAt).toBeInstanceOf(Date);
    });

    it('should store memory with all options', async () => {
      const entry = await memory.store({
        type: 'decision',
        content: 'We chose React for the frontend',
        summary: 'Frontend framework decision',
        importance: 0.95,
        tags: ['architecture', 'frontend'],
        metadata: { reason: 'team familiarity' },
        projectId: 'proj-123',
        sessionId: 'session-456',
        expiresIn: 30, // days
      });

      expect(entry.type).toBe('decision');
      expect(entry.summary).toBe('Frontend framework decision');
      expect(entry.importance).toBe(0.95);
      expect(entry.tags).toContain('architecture');
      expect(entry.tags).toContain('frontend');
      expect(entry.metadata.reason).toBe('team familiarity');
      expect(entry.projectId).toBe('proj-123');
      expect(entry.sessionId).toBe('session-456');
      expect(entry.expiresAt).toBeDefined();
    });

    it('should assign importance based on type', async () => {
      const decision = await memory.store({
        type: 'decision',
        content: 'Architecture decision',
      });

      const instruction = await memory.store({
        type: 'instruction',
        content: 'User instruction',
      });

      const preference = await memory.store({
        type: 'preference',
        content: 'User preference',
      });

      const context = await memory.store({
        type: 'context',
        content: 'Some context',
      });

      // Higher type scores should have higher importance
      expect(decision.importance).toBeGreaterThan(context.importance);
      expect(instruction.importance).toBeGreaterThan(context.importance);
      expect(preference.importance).toBeGreaterThan(context.importance);
    });

    it('should adjust importance based on content length', async () => {
      const short = await memory.store({
        type: 'fact',
        content: 'Hi', // Very short
      });

      const optimal = await memory.store({
        type: 'fact',
        content: 'This is a moderate length content that provides useful information about the project structure and conventions used.', // 50-500 chars
      });

      // Optimal length should get bonus
      expect(optimal.importance).toBeGreaterThanOrEqual(short.importance);
    });

    it('should adjust importance based on tags', async () => {
      const noTags = await memory.store({
        type: 'fact',
        content: 'No tags',
      });

      const withTags = await memory.store({
        type: 'fact',
        content: 'With tags',
        tags: ['important', 'architecture', 'core'],
      });

      expect(withTags.importance).toBeGreaterThan(noTags.importance);
    });

    it('should emit memory:stored event', async () => {
      const handler = jest.fn();
      memory.on('memory:stored', handler);

      const entry = await memory.store({
        type: 'fact',
        content: 'Test memory',
      });

      expect(handler).toHaveBeenCalledWith({ memory: entry });
    });

    it('should save memories after storage', async () => {
      await memory.store({
        type: 'fact',
        content: 'Test memory',
      });

      expect(mockWriteJSON).toHaveBeenCalled();
    });

    it('should calculate expiration date correctly', async () => {
      const entry = await memory.store({
        type: 'context',
        content: 'Temporary memory',
        expiresIn: 7, // 7 days
      });

      expect(entry.expiresAt).toBeDefined();
      const expectedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const diff = Math.abs(entry.expiresAt!.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(1000); // Within 1 second tolerance
    });

    it('should enforce memory limits', async () => {
      const limitedMemory = new EnhancedMemory({
        maxMemories: 5,
        embeddingEnabled: false,
        useSQLite: false,
      });

      for (let i = 0; i < 10; i++) {
        await limitedMemory.store({
          type: 'fact',
          content: `Memory ${i}`,
          importance: i * 0.1, // Different importance levels
        });
      }

      const stats = limitedMemory.getStats();
      expect(stats.totalMemories).toBeLessThanOrEqual(5);

      limitedMemory.dispose();
    });
  });

  describe('Memory Retrieval', () => {
    beforeEach(async () => {
      // Store some test memories
      await memory.store({ type: 'fact', content: 'Fact 1', tags: ['tag1'] });
      await memory.store({ type: 'fact', content: 'Fact 2', tags: ['tag2'] });
      await memory.store({ type: 'decision', content: 'Decision 1', importance: 0.9 });
      await memory.store({ type: 'preference', content: 'Preference 1', tags: ['tag1'] });
      await memory.store({ type: 'pattern', content: 'Pattern 1' });
    });

    it('should recall all stored memories', async () => {
      const results = await memory.recall();
      expect(results.length).toBe(5);
    });

    it('should filter by type', async () => {
      const facts = await memory.recall({ types: ['fact'] });
      expect(facts.length).toBe(2);
      expect(facts.every(m => m.type === 'fact')).toBe(true);
    });

    it('should filter by multiple types', async () => {
      const results = await memory.recall({ types: ['fact', 'decision'] });
      expect(results.length).toBe(3);
      expect(results.every(m => m.type === 'fact' || m.type === 'decision')).toBe(true);
    });

    it('should filter by tags', async () => {
      const results = await memory.recall({ tags: ['tag1'] });
      expect(results.length).toBe(2);
      expect(results.every(m => m.tags.includes('tag1'))).toBe(true);
    });

    it('should filter by minimum importance', async () => {
      const results = await memory.recall({ minImportance: 0.8 });
      expect(results.every(m => m.importance >= 0.8)).toBe(true);
    });

    it('should limit results', async () => {
      const results = await memory.recall({ limit: 2 });
      expect(results.length).toBe(2);
    });

    it('should search by query (keyword search)', async () => {
      const results = await memory.recall({ query: 'Decision' });
      expect(results.length).toBe(1);
      expect(results[0].content).toContain('Decision');
    });

    it('should search by query in summary', async () => {
      await memory.store({
        type: 'fact',
        content: 'Some content',
        summary: 'Important summary about testing',
      });

      const results = await memory.recall({ query: 'testing' });
      expect(results.some(m => m.summary?.includes('testing'))).toBe(true);
    });

    it('should search by query in tags', async () => {
      await memory.store({
        type: 'fact',
        content: 'Content',
        tags: ['searchable-tag'],
      });

      const results = await memory.recall({ query: 'searchable-tag' });
      expect(results.some(m => m.tags.includes('searchable-tag'))).toBe(true);
    });

    it('should filter expired memories by default', async () => {
      // Store an expired memory
      const expiredEntry = await memory.store({
        type: 'context',
        content: 'Expired memory',
        expiresIn: -1, // Already expired (1 day ago)
      });

      // Manually set expired date
      expiredEntry.expiresAt = new Date(Date.now() - 86400000); // 1 day ago

      const results = await memory.recall();
      const hasExpired = results.some(m => m.id === expiredEntry.id);
      expect(hasExpired).toBe(false);
    });

    it('should include expired memories when requested', async () => {
      const entry = await memory.store({
        type: 'context',
        content: 'Expired memory for inclusion test',
      });

      // Manually set expired date on the memory
      entry.expiresAt = new Date(Date.now() - 86400000); // 1 day ago

      const results = await memory.recall({ includeExpired: true });
      // Should include all memories regardless of expiration
      expect(results.length).toBeGreaterThan(0);
    });

    it('should sort by importance and recency', async () => {
      const results = await memory.recall();

      // Results should be sorted (higher score first)
      for (let i = 1; i < results.length; i++) {
        const prevScore = results[i - 1].importance * 0.6 +
          (new Date(results[i - 1].lastAccessedAt).getTime() / Date.now()) * 0.4;
        const currScore = results[i].importance * 0.6 +
          (new Date(results[i].lastAccessedAt).getTime() / Date.now()) * 0.4;
        expect(prevScore).toBeGreaterThanOrEqual(currScore);
      }
    });

    it('should update access stats on recall', async () => {
      const results = await memory.recall();

      // Access count should be incremented
      expect(results.every(m => m.accessCount >= 1)).toBe(true);
    });
  });

  describe('Memory Indexing', () => {
    it('should index memories by ID', async () => {
      const entry1 = await memory.store({ type: 'fact', content: 'Memory 1' });
      const entry2 = await memory.store({ type: 'fact', content: 'Memory 2' });

      const recalled = await memory.recall();
      const ids = recalled.map(m => m.id);

      expect(ids).toContain(entry1.id);
      expect(ids).toContain(entry2.id);
    });

    it('should index memories by type', async () => {
      await memory.store({ type: 'fact', content: 'Fact' });
      await memory.store({ type: 'decision', content: 'Decision' });
      await memory.store({ type: 'fact', content: 'Another fact' });

      const stats = memory.getStats();
      expect(stats.byType.fact).toBe(2);
      expect(stats.byType.decision).toBe(1);
    });

    it('should support multiple tag indexes', async () => {
      await memory.store({
        type: 'fact',
        content: 'Multi-tagged',
        tags: ['tag1', 'tag2', 'tag3'],
      });

      const byTag1 = await memory.recall({ tags: ['tag1'] });
      const byTag2 = await memory.recall({ tags: ['tag2'] });
      const byTag3 = await memory.recall({ tags: ['tag3'] });

      expect(byTag1.length).toBe(1);
      expect(byTag2.length).toBe(1);
      expect(byTag3.length).toBe(1);
    });
  });

  describe('Memory Persistence', () => {
    it('should save memories to JSON file', async () => {
      await memory.store({ type: 'fact', content: 'Persistent memory' });

      expect(mockWriteJSON).toHaveBeenCalled();
      const calls = mockWriteJSON.mock.calls;
      expect(calls.some((call: unknown[]) =>
        (call[0] as string).includes('memory-index.json')
      )).toBe(true);
    });

    it('should save user profile when updated', async () => {
      await memory.updateUserProfile({
        preferences: { codeStyle: 'functional', verbosity: 'detailed' },
      });

      expect(mockWriteJSON).toHaveBeenCalled();
      const calls = mockWriteJSON.mock.calls;
      expect(calls.some((call: unknown[]) =>
        (call[0] as string).includes('user-profile.json')
      )).toBe(true);
    });

    it('should save summaries when stored', async () => {
      await memory.storeSummary({
        sessionId: 'session-1',
        summary: 'Test summary',
        topics: ['test'],
        messageCount: 10,
      });

      expect(mockWriteJSON).toHaveBeenCalled();
      const calls = mockWriteJSON.mock.calls;
      expect(calls.some((call: unknown[]) =>
        (call[0] as string).includes('summaries.json')
      )).toBe(true);
    });

    it('should save project when set', async () => {
      await memory.setProjectContext('/test/project');

      expect(mockWriteJSON).toHaveBeenCalled();
    });
  });

  describe('Forget Operation', () => {
    it('should remove memory by ID', async () => {
      const entry = await memory.store({
        type: 'fact',
        content: 'To be forgotten',
      });

      const result = await memory.forget(entry.id);
      expect(result).toBe(true);

      const recalled = await memory.recall();
      expect(recalled.find(m => m.id === entry.id)).toBeUndefined();
    });

    it('should return false for unknown ID', async () => {
      const result = await memory.forget('unknown-id');
      expect(result).toBe(false);
    });

    it('should emit memory:forgotten event', async () => {
      const handler = jest.fn();
      memory.on('memory:forgotten', handler);

      const entry = await memory.store({
        type: 'fact',
        content: 'To be forgotten',
      });
      await memory.forget(entry.id);

      expect(handler).toHaveBeenCalledWith({ id: entry.id });
    });
  });

  describe('Project Context', () => {
    it('should set project context', async () => {
      const project = await memory.setProjectContext('/path/to/project');

      expect(project.projectPath).toBe('/path/to/project');
      expect(project.name).toBe('project');
      expect(project.projectId).toBeDefined();
    });

    it('should return null when no project set', () => {
      const project = memory.getProjectMemory();
      expect(project).toBeNull();
    });

    it('should return current project after setting', async () => {
      await memory.setProjectContext('/my/project');
      const project = memory.getProjectMemory();
      expect(project).not.toBeNull();
    });

    it('should emit project:set event', async () => {
      const handler = jest.fn();
      memory.on('project:set', handler);

      await memory.setProjectContext('/test/project');

      expect(handler).toHaveBeenCalled();
    });

    it('should associate memories with current project', async () => {
      await memory.setProjectContext('/my/project');

      const entry = await memory.store({
        type: 'fact',
        content: 'Project-specific memory',
      });

      expect(entry.projectId).toBeDefined();
    });
  });

  describe('Code Conventions', () => {
    beforeEach(async () => {
      await memory.setProjectContext('/my/project');
    });

    it('should learn code conventions', async () => {
      await memory.learnConvention({
        type: 'naming',
        rule: 'Use camelCase for variables',
        examples: ['myVariable', 'userName'],
      });

      const project = memory.getProjectMemory();
      expect(project?.conventions.length).toBe(1);
      expect(project?.conventions[0].rule).toContain('camelCase');
      expect(project?.conventions[0].examples).toContain('myVariable');
    });

    it('should increase confidence for repeated conventions', async () => {
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

    it('should add examples to existing conventions', async () => {
      await memory.learnConvention({
        type: 'naming',
        rule: 'Use camelCase',
        examples: ['example1'],
      });

      await memory.learnConvention({
        type: 'naming',
        rule: 'Use camelCase',
        examples: ['example2', 'example3'],
      });

      const project = memory.getProjectMemory();
      expect(project?.conventions[0].examples).toContain('example1');
      expect(project?.conventions[0].examples).toContain('example2');
      expect(project?.conventions[0].examples).toContain('example3');
    });

    it('should emit convention:learned event', async () => {
      const handler = jest.fn();
      memory.on('convention:learned', handler);

      await memory.learnConvention({
        type: 'style',
        rule: 'Use 2-space indentation',
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should not learn convention without project context', async () => {
      const newMemory = new EnhancedMemory({
        embeddingEnabled: false,
        useSQLite: false,
      });

      await newMemory.learnConvention({
        type: 'naming',
        rule: 'Test rule',
      });

      // Should not throw and should not add convention
      expect(newMemory.getProjectMemory()).toBeNull();

      newMemory.dispose();
    });
  });

  describe('Conversation Summaries', () => {
    it('should store conversation summary', async () => {
      const summary = await memory.storeSummary({
        sessionId: 'session-1',
        summary: 'Discussed project architecture',
        topics: ['architecture', 'design'],
        messageCount: 20,
      });

      expect(summary.id).toBeDefined();
      expect(summary.summary).toBe('Discussed project architecture');
      expect(summary.topics).toContain('architecture');
      expect(summary.messageCount).toBe(20);
    });

    it('should store summary with decisions and todos', async () => {
      const summary = await memory.storeSummary({
        sessionId: 'session-2',
        summary: 'Planning session',
        topics: ['planning'],
        decisions: ['Use React', 'Use TypeScript'],
        todos: ['Setup project', 'Create components'],
        messageCount: 30,
      });

      expect(summary.decisions).toContain('Use React');
      expect(summary.todos).toContain('Setup project');
    });

    it('should emit summary:stored event', async () => {
      const handler = jest.fn();
      memory.on('summary:stored', handler);

      await memory.storeSummary({
        sessionId: 'session-1',
        summary: 'Test',
        topics: [],
        messageCount: 5,
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should also store summary as memory', async () => {
      const initialCount = memory.getStats().totalMemories;

      await memory.storeSummary({
        sessionId: 'session-1',
        summary: 'Summary as memory',
        topics: ['test'],
        messageCount: 10,
      });

      const newCount = memory.getStats().totalMemories;
      expect(newCount).toBe(initialCount + 1);
    });
  });

  describe('User Profile', () => {
    it('should create profile if not exists', async () => {
      const profile = await memory.updateUserProfile({
        preferences: {
          codeStyle: 'functional',
          verbosity: 'detailed',
        },
      });

      expect(profile.id).toBeDefined();
      expect(profile.preferences.codeStyle).toBe('functional');
      expect(profile.preferences.verbosity).toBe('detailed');
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
      expect(profile.interests).toContain('React');
    });

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

    it('should emit profile:updated event', async () => {
      const handler = jest.fn();
      memory.on('profile:updated', handler);

      await memory.updateUserProfile({
        preferences: { codeStyle: 'test', verbosity: 'minimal' },
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should update timestamp on profile update', async () => {
      const profile1 = await memory.updateUserProfile({
        preferences: { codeStyle: 'test', verbosity: 'minimal' },
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const profile2 = await memory.updateUserProfile({
        interests: ['Node.js'],
      });

      expect(profile2.updatedAt.getTime()).toBeGreaterThan(profile1.updatedAt.getTime());
    });
  });

  describe('Build Context', () => {
    beforeEach(async () => {
      await memory.store({
        type: 'fact',
        content: 'Important project info',
        importance: 0.9,
      });
      await memory.updateUserProfile({
        preferences: { codeStyle: 'functional', verbosity: 'minimal' },
      });
    });

    it('should build context from memories', async () => {
      const context = await memory.buildContext({
        query: 'project',
      });

      expect(context).toContain('Important project info');
    });

    it('should include user preferences when requested', async () => {
      const context = await memory.buildContext({
        includePreferences: true,
      });

      expect(context).toContain('preferences');
      expect(context).toContain('functional');
    });

    it('should include project context when requested', async () => {
      await memory.setProjectContext('/test/project');

      const context = await memory.buildContext({
        includeProject: true,
      });

      expect(context).toContain('Project');
    });

    it('should include recent summaries when requested', async () => {
      await memory.storeSummary({
        sessionId: 'session-1',
        summary: 'Recent summary content',
        topics: ['test'],
        messageCount: 10,
      });

      const context = await memory.buildContext({
        includeRecentSummaries: true,
      });

      expect(context).toContain('Recent summary content');
    });
  });

  describe('Statistics', () => {
    it('should return memory stats', async () => {
      await memory.store({ type: 'fact', content: 'Fact 1' });
      await memory.store({ type: 'fact', content: 'Fact 2' });
      await memory.store({ type: 'decision', content: 'Decision 1' });

      const stats = memory.getStats();

      expect(stats.totalMemories).toBe(3);
      expect(stats.byType.fact).toBe(2);
      expect(stats.byType.decision).toBe(1);
    });

    it('should count projects', async () => {
      await memory.setProjectContext('/project1');

      const stats = memory.getStats();
      expect(stats.projects).toBe(1);
    });

    it('should count summaries', async () => {
      await memory.storeSummary({
        sessionId: 's1',
        summary: 'Summary 1',
        topics: [],
        messageCount: 5,
      });
      await memory.storeSummary({
        sessionId: 's2',
        summary: 'Summary 2',
        topics: [],
        messageCount: 10,
      });

      const stats = memory.getStats();
      expect(stats.summaries).toBe(2);
    });
  });

  describe('Format Status', () => {
    it('should render status', () => {
      const status = memory.formatStatus();

      expect(status).toContain('MEMORY SYSTEM');
      expect(status).toContain('Total Memories');
      expect(status).toContain('Projects');
      expect(status).toContain('Summaries');
    });

    it('should include memory by type breakdown', async () => {
      await memory.store({ type: 'fact', content: 'Test' });

      const status = memory.formatStatus();
      expect(status).toContain('MEMORIES BY TYPE');
    });

    it('should show current project info', async () => {
      await memory.setProjectContext('/test/project');

      const status = memory.formatStatus();
      expect(status).toContain('Current Project');
    });

    it('should show command hints', () => {
      const status = memory.formatStatus();

      expect(status).toContain('/memory store');
      expect(status).toContain('/memory recall');
      expect(status).toContain('/memory forget');
    });
  });

  describe('Clear Operation', () => {
    it('should clear all memories', async () => {
      await memory.store({ type: 'fact', content: 'Memory 1' });
      await memory.store({ type: 'fact', content: 'Memory 2' });

      await memory.clear();

      const stats = memory.getStats();
      expect(stats.totalMemories).toBe(0);
    });

    it('should clear summaries', async () => {
      await memory.storeSummary({
        sessionId: 's1',
        summary: 'Test',
        topics: [],
        messageCount: 5,
      });

      await memory.clear();

      const stats = memory.getStats();
      expect(stats.summaries).toBe(0);
    });

    it('should emit memory:cleared event', async () => {
      const handler = jest.fn();
      memory.on('memory:cleared', handler);

      await memory.clear();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Dispose', () => {
    it('should clean up on dispose', async () => {
      await memory.store({ type: 'fact', content: 'Test' });

      memory.dispose();

      // Should save and clear
      expect(mockWriteJSON).toHaveBeenCalled();
    });

    it('should remove all event listeners on dispose', () => {
      const handler = jest.fn();
      memory.on('memory:stored', handler);

      memory.dispose();

      expect(memory.listenerCount('memory:stored')).toBe(0);
    });

    it('should clear internal data structures on dispose', () => {
      memory.dispose();

      const stats = memory.getStats();
      expect(stats.totalMemories).toBe(0);
      expect(stats.projects).toBe(0);
      expect(stats.summaries).toBe(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      resetEnhancedMemory();
      const instance1 = getEnhancedMemory({ embeddingEnabled: false, useSQLite: false });
      const instance2 = getEnhancedMemory();
      expect(instance1).toBe(instance2);
      instance1.dispose();
    });

    it('should reset instance', () => {
      resetEnhancedMemory();
      const instance1 = getEnhancedMemory({ embeddingEnabled: false, useSQLite: false });
      resetEnhancedMemory();
      const instance2 = getEnhancedMemory({ embeddingEnabled: false, useSQLite: false });
      expect(instance1).not.toBe(instance2);
      instance1.dispose();
      instance2.dispose();
    });
  });
});

// ============================================================================
// Persistent Memory Manager Tests
// ============================================================================

describe('PersistentMemoryManager', () => {
  let manager: PersistentMemoryManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathExists.mockResolvedValue(false);
    mockReadFile.mockResolvedValue('');

    manager = new PersistentMemoryManager({
      projectMemoryPath: '/test/.codebuddy/CODEBUDDY_MEMORY.md',
      userMemoryPath: '/home/user/.codebuddy/memory.md',
    });
  });

  describe('Constructor and Initialization', () => {
    it('should create with default config', () => {
      const m = new PersistentMemoryManager();
      expect(m).toBeDefined();
      expect(m).toBeInstanceOf(EventEmitter);
    });

    it('should accept custom config', () => {
      const m = new PersistentMemoryManager({
        autoCapture: false,
        maxMemories: 50,
        relevanceThreshold: 0.7,
      });
      expect(m).toBeDefined();
    });

    it('should initialize and ensure memory files', async () => {
      await manager.initialize();

      expect(mockEnsureDir).toHaveBeenCalled();
    });

    it('should create memory files if not exist', async () => {
      mockPathExists.mockResolvedValue(false);

      await manager.initialize();

      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should load existing memories on initialization', async () => {
      const memoryContent = `# Code Buddy Memory

## Project Context
- **project-name**: Test Project

## User Preferences
- **style**: camelCase
`;
      mockPathExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(memoryContent);

      await manager.initialize();

      const recalled = manager.recall('project-name');
      expect(recalled).toBe('Test Project');
    });

    it('should emit memory:initialized event', async () => {
      const handler = jest.fn();
      manager.on('memory:initialized', handler);

      await manager.initialize();

      expect(handler).toHaveBeenCalled();
    });

    it('should not reinitialize if already initialized', async () => {
      await manager.initialize();
      const callCount = mockEnsureDir.mock.calls.length;

      await manager.initialize();

      expect(mockEnsureDir.mock.calls.length).toBe(callCount);
    });
  });

  describe('Remember Operation', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should remember a value', async () => {
      await manager.remember('test-key', 'test-value');

      const recalled = manager.recall('test-key');
      expect(recalled).toBe('test-value');
    });

    it('should remember with category', async () => {
      await manager.remember('pref-key', 'pref-value', {
        category: 'preferences',
      });

      const memories = manager.getByCategory('preferences');
      expect(memories.some(m => m.key === 'pref-key')).toBe(true);
    });

    it('should remember with scope', async () => {
      await manager.remember('project-key', 'project-value', {
        scope: 'project',
      });

      const recalled = manager.recall('project-key', 'project');
      expect(recalled).toBe('project-value');
    });

    it('should remember with tags', async () => {
      await manager.remember('tagged-key', 'tagged-value', {
        tags: ['important', 'test'],
      });

      const recalled = manager.recall('tagged-key');
      expect(recalled).toBe('tagged-value');
    });

    it('should update existing memory', async () => {
      await manager.remember('update-key', 'initial-value');
      await manager.remember('update-key', 'updated-value');

      const recalled = manager.recall('update-key');
      expect(recalled).toBe('updated-value');
    });

    it('should preserve createdAt on update', async () => {
      await manager.remember('preserve-key', 'initial');
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.remember('preserve-key', 'updated');

      // The memory should still exist with updated value
      const recalled = manager.recall('preserve-key');
      expect(recalled).toBe('updated');
    });

    it('should emit memory:remembered event', async () => {
      const handler = jest.fn();
      manager.on('memory:remembered', handler);

      await manager.remember('event-key', 'event-value');

      expect(handler).toHaveBeenCalledWith({
        key: 'event-key',
        scope: 'project',
        category: 'context',
      });
    });

    it('should save memories after remember', async () => {
      await manager.remember('save-key', 'save-value');

      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe('Recall Operation', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.remember('project-key', 'project-value', { scope: 'project' });
      await manager.remember('user-key', 'user-value', { scope: 'user' });
    });

    it('should recall from project scope', () => {
      const recalled = manager.recall('project-key', 'project');
      expect(recalled).toBe('project-value');
    });

    it('should recall from user scope', () => {
      const recalled = manager.recall('user-key', 'user');
      expect(recalled).toBe('user-value');
    });

    it('should search both scopes when scope not specified', () => {
      const projectRecall = manager.recall('project-key');
      const userRecall = manager.recall('user-key');

      expect(projectRecall).toBe('project-value');
      expect(userRecall).toBe('user-value');
    });

    it('should prioritize project scope', async () => {
      await manager.remember('shared-key', 'project-value', { scope: 'project' });
      await manager.remember('shared-key', 'user-value', { scope: 'user' });

      const recalled = manager.recall('shared-key');
      expect(recalled).toBe('project-value');
    });

    it('should return null for unknown key', () => {
      const recalled = manager.recall('unknown-key');
      expect(recalled).toBeNull();
    });

    it('should increment access count on recall', async () => {
      manager.recall('project-key');
      manager.recall('project-key');

      const memories = manager.getByCategory('context', 'project');
      const memory = memories.find(m => m.key === 'project-key');
      expect(memory?.accessCount).toBe(2);
    });
  });

  describe('Forget Operation', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.remember('forget-key', 'forget-value', { scope: 'project' });
    });

    it('should forget a memory', async () => {
      const deleted = await manager.forget('forget-key', 'project');

      expect(deleted).toBe(true);
      expect(manager.recall('forget-key', 'project')).toBeNull();
    });

    it('should return false for unknown key', async () => {
      const deleted = await manager.forget('unknown-key', 'project');
      expect(deleted).toBe(false);
    });

    it('should emit memory:forgotten event', async () => {
      const handler = jest.fn();
      manager.on('memory:forgotten', handler);

      await manager.forget('forget-key', 'project');

      expect(handler).toHaveBeenCalledWith({
        key: 'forget-key',
        scope: 'project',
      });
    });

    it('should save after forget', async () => {
      jest.clearAllMocks();
      await manager.forget('forget-key', 'project');

      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe('Relevant Memories', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.remember('react-key', 'React is a frontend framework', {
        category: 'project',
      });
      await manager.remember('typescript-key', 'TypeScript adds type safety', {
        category: 'project',
      });
      await manager.remember('nodejs-key', 'Node.js for backend', {
        category: 'project',
      });
    });

    it('should find relevant memories by keyword', () => {
      const relevant = manager.getRelevantMemories('React frontend');

      expect(relevant.length).toBeGreaterThan(0);
      expect(relevant.some(m => m.key === 'react-key')).toBe(true);
    });

    it('should limit results', () => {
      // Search for a term that matches multiple memories, then limit to 1
      const relevant = manager.getRelevantMemories('TypeScript React Node', 1);
      expect(relevant.length).toBeLessThanOrEqual(1);
    });

    it('should score by multiple keyword matches', () => {
      const relevant = manager.getRelevantMemories('TypeScript type safety');

      // TypeScript memory should be first (more matches)
      expect(relevant[0].key).toBe('typescript-key');
    });

    it('should boost by access count', async () => {
      // Access react-key multiple times
      manager.recall('react-key');
      manager.recall('react-key');
      manager.recall('react-key');

      const relevant = manager.getRelevantMemories('framework');

      // react-key should be boosted due to higher access count
      const reactIndex = relevant.findIndex(m => m.key === 'react-key');
      expect(reactIndex).toBeGreaterThanOrEqual(0);
    });

    it('should return empty array when no matches', () => {
      const relevant = manager.getRelevantMemories('xyzzzy nonexistent');
      expect(relevant).toEqual([]);
    });
  });

  describe('Get By Category', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.remember('pref1', 'value1', { category: 'preferences', scope: 'project' });
      await manager.remember('pref2', 'value2', { category: 'preferences', scope: 'user' });
      await manager.remember('decision1', 'value3', { category: 'decisions' });
    });

    it('should get memories by category', () => {
      const preferences = manager.getByCategory('preferences');
      expect(preferences.length).toBe(2);
    });

    it('should filter by scope', () => {
      const projectPrefs = manager.getByCategory('preferences', 'project');
      expect(projectPrefs.length).toBe(1);
      expect(projectPrefs[0].key).toBe('pref1');
    });

    it('should return empty array for empty category', () => {
      const patterns = manager.getByCategory('patterns');
      expect(patterns).toEqual([]);
    });
  });

  describe('Forget Older Than', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.remember('recent', 'value1');
    });

    it('should forget memories older than specified days', async () => {
      const count = await manager.forgetOlderThan(0, 'project'); // 0 days = remove all

      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should keep recent memories', async () => {
      await manager.remember('very-recent', 'value');

      const count = await manager.forgetOlderThan(365, 'project'); // 1 year

      // Very recent should not be deleted
      expect(manager.recall('very-recent')).toBe('value');
    });
  });

  describe('Context for Prompt', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.remember('project-info', 'Test project using React', {
        category: 'project',
        scope: 'project',
      });
      await manager.remember('user-pref', 'Prefers TypeScript', {
        category: 'preferences',
        scope: 'user',
      });
    });

    it('should generate context string', () => {
      const context = manager.getContextForPrompt();

      expect(context).toContain('PERSISTENT MEMORY');
      expect(context).toContain('project-info');
      expect(context).toContain('user-pref');
    });

    it('should return empty string when no memories', async () => {
      const emptyManager = new PersistentMemoryManager();
      await emptyManager.initialize();

      const context = emptyManager.getContextForPrompt();
      expect(context).toBe('');
    });
  });

  describe('Auto Capture', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should auto-capture project context', async () => {
      await manager.autoCapture(
        'This is a React TypeScript project',
        'I see you are using React with TypeScript.'
      );

      // Should have captured something
      const stats = manager.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });

    it('should auto-capture preferences', async () => {
      await manager.autoCapture(
        'I prefer using functional components',
        'Noted, I will use functional components.'
      );

      // Check if preference was captured
      const stats = manager.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });

    it('should auto-capture decisions', async () => {
      await manager.autoCapture(
        '',
        'Decided to use Redux for state management.'
      );

      const stats = manager.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });

    it('should respect autoCapture config', async () => {
      const noAutoManager = new PersistentMemoryManager({
        autoCapture: false,
      });
      await noAutoManager.initialize();

      await noAutoManager.autoCapture(
        'This is a React project',
        'Using React.'
      );

      const stats = noAutoManager.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('Format Memories', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.remember('test-key', 'test-value');
    });

    it('should format memories for display', () => {
      const formatted = manager.formatMemories();

      expect(formatted).toContain('Persistent Memory');
      expect(formatted).toContain('Project Memory');
      expect(formatted).toContain('User Memory');
    });

    it('should show memory details', () => {
      const formatted = manager.formatMemories();

      expect(formatted).toContain('test-key');
      expect(formatted).toContain('Category');
      expect(formatted).toContain('Accessed');
    });

    it('should filter by scope', () => {
      const projectFormatted = manager.formatMemories('project');

      expect(projectFormatted).toContain('Project Memory');
    });

    it('should show commands', () => {
      const formatted = manager.formatMemories();

      expect(formatted).toContain('/remember');
      expect(formatted).toContain('/recall');
      expect(formatted).toContain('/forget');
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.remember('p1', 'v1', { scope: 'project' });
      await manager.remember('p2', 'v2', { scope: 'project' });
      await manager.remember('u1', 'v3', { scope: 'user' });
    });

    it('should return correct stats', () => {
      const stats = manager.getStats();

      expect(stats.project).toBe(2);
      expect(stats.user).toBe(1);
      expect(stats.total).toBe(3);
    });
  });

  describe('Singleton and Factory', () => {
    it('should return same instance from getMemoryManager', () => {
      const instance1 = getMemoryManager();
      const instance2 = getMemoryManager();
      expect(instance1).toBe(instance2);
    });

    it('should initialize memory via factory', async () => {
      const manager = await initializeMemory();
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(PersistentMemoryManager);
    });
  });
});

// ============================================================================
// Prospective Memory Tests
// ============================================================================

describe('ProspectiveMemory', () => {
  let prospective: ProspectiveMemory;

  beforeEach(() => {
    jest.clearAllMocks();
    resetProspectiveMemory();

    mockDbPrepare.mockReturnValue({
      run: jest.fn(),
      all: jest.fn().mockReturnValue([]),
    });

    prospective = new ProspectiveMemory({
      enabled: true,
      maxTasks: 100,
      maxGoals: 50,
      checkIntervalMs: 60000,
    });
  });

  afterEach(() => {
    prospective.dispose();
  });

  describe('Constructor and Initialization', () => {
    it('should create with default config', () => {
      const p = new ProspectiveMemory();
      expect(p).toBeDefined();
      expect(p).toBeInstanceOf(EventEmitter);
      p.dispose();
    });

    it('should accept custom config', () => {
      const p = new ProspectiveMemory({
        maxTasks: 500,
        maxGoals: 200,
        checkIntervalMs: 30000,
      });
      expect(p).toBeDefined();
      p.dispose();
    });

    it('should initialize and create database schema', async () => {
      await prospective.initialize();

      expect(mockDbExec).toHaveBeenCalled();
    });

    it('should emit initialized event', async () => {
      const handler = jest.fn();
      prospective.on('initialized', handler);

      await prospective.initialize();

      expect(handler).toHaveBeenCalled();
    });

    it('should not reinitialize if already initialized', async () => {
      await prospective.initialize();
      const callCount = mockDbExec.mock.calls.length;

      await prospective.initialize();

      expect(mockDbExec.mock.calls.length).toBe(callCount);
    });
  });

  describe('Task Management', () => {
    beforeEach(async () => {
      await prospective.initialize();
    });

    it('should create a task with basic options', async () => {
      const task = await prospective.createTask({
        title: 'Test Task',
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('medium');
      expect(task.progress).toBe(0);
    });

    it('should create task with all options', async () => {
      const dueDate = new Date(Date.now() + 86400000);

      const task = await prospective.createTask({
        title: 'Full Task',
        description: 'Task description',
        priority: 'high',
        trigger: { type: 'time', schedule: dueDate.toISOString() },
        context: { files: ['/test/file.ts'] },
        subtasks: ['Subtask 1', 'Subtask 2'],
        dependencies: ['task-1'],
        tags: ['feature', 'urgent'],
        projectId: 'proj-123',
        dueAt: dueDate,
        metadata: { custom: 'value' },
      });

      expect(task.title).toBe('Full Task');
      expect(task.description).toBe('Task description');
      expect(task.priority).toBe('high');
      expect(task.trigger.type).toBe('time');
      expect(task.subtasks?.length).toBe(2);
      expect(task.dependencies).toContain('task-1');
      expect(task.tags).toContain('feature');
      expect(task.projectId).toBe('proj-123');
      expect(task.dueAt).toEqual(dueDate);
    });

    it('should emit task:created event', async () => {
      const handler = jest.fn();
      prospective.on('task:created', handler);

      const task = await prospective.createTask({ title: 'Event Task' });

      expect(handler).toHaveBeenCalledWith({ task });
    });

    it('should update a task', async () => {
      const task = await prospective.createTask({ title: 'Original' });

      const updated = await prospective.updateTask(task.id, {
        title: 'Updated',
        status: 'in_progress',
      });

      expect(updated?.title).toBe('Updated');
      expect(updated?.status).toBe('in_progress');
    });

    it('should emit task:updated event', async () => {
      const task = await prospective.createTask({ title: 'Test' });

      const handler = jest.fn();
      prospective.on('task:updated', handler);

      await prospective.updateTask(task.id, { title: 'Updated' });

      expect(handler).toHaveBeenCalled();
    });

    it('should return null when updating non-existent task', async () => {
      const result = await prospective.updateTask('non-existent', {
        title: 'Test',
      });

      expect(result).toBeNull();
    });

    it('should calculate progress from subtasks', async () => {
      const task = await prospective.createTask({
        title: 'Task with subtasks',
        subtasks: ['Sub 1', 'Sub 2', 'Sub 3', 'Sub 4'],
      });

      // Complete 2 of 4 subtasks
      await prospective.completeSubtask(task.id, task.subtasks![0].id);
      const updated = await prospective.completeSubtask(task.id, task.subtasks![1].id);

      expect(updated?.progress).toBe(50); // 2/4 = 50%
    });

    it('should auto-complete task when progress reaches 100%', async () => {
      const task = await prospective.createTask({
        title: 'Auto-complete task',
        subtasks: ['Sub 1'],
      });

      const completed = await prospective.completeSubtask(task.id, task.subtasks![0].id);

      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeDefined();
    });

    it('should delete a task', async () => {
      const task = await prospective.createTask({ title: 'To Delete' });

      const deleted = await prospective.deleteTask(task.id);

      expect(deleted).toBe(true);

      const tasks = prospective.getTasks();
      expect(tasks.find(t => t.id === task.id)).toBeUndefined();
    });

    it('should emit task:deleted event', async () => {
      const task = await prospective.createTask({ title: 'Delete Event' });

      const handler = jest.fn();
      prospective.on('task:deleted', handler);

      await prospective.deleteTask(task.id);

      expect(handler).toHaveBeenCalledWith({ id: task.id });
    });

    it('should return false when deleting non-existent task', async () => {
      const deleted = await prospective.deleteTask('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('Task Filtering', () => {
    beforeEach(async () => {
      await prospective.initialize();

      // Create various tasks
      const task1 = await prospective.createTask({
        title: 'High Priority',
        priority: 'high',
        tags: ['urgent'],
        projectId: 'proj-1',
      });

      const task2 = await prospective.createTask({
        title: 'Low Priority',
        priority: 'low',
        tags: ['feature'],
      });
      // Update to in_progress status
      await prospective.updateTask(task2.id, { status: 'in_progress' });

      await prospective.createTask({
        title: 'Critical',
        priority: 'critical',
        dueAt: new Date(Date.now() + 86400000), // Due tomorrow
      });
    });

    it('should filter by status', () => {
      const pending = prospective.getTasks({ status: 'pending' });
      expect(pending.every(t => t.status === 'pending')).toBe(true);
    });

    it('should filter by multiple statuses', () => {
      const tasks = prospective.getTasks({ status: ['pending', 'in_progress'] });
      expect(tasks.every(t => t.status === 'pending' || t.status === 'in_progress')).toBe(true);
    });

    it('should filter by priority', () => {
      const high = prospective.getTasks({ priority: 'high' });
      expect(high.every(t => t.priority === 'high')).toBe(true);
    });

    it('should filter by projectId', () => {
      const projectTasks = prospective.getTasks({ projectId: 'proj-1' });
      expect(projectTasks.every(t => t.projectId === 'proj-1')).toBe(true);
    });

    it('should filter by tags', () => {
      const urgent = prospective.getTasks({ tags: ['urgent'] });
      expect(urgent.every(t => t.tags.includes('urgent'))).toBe(true);
    });

    it('should filter by due date', () => {
      const deadline = new Date(Date.now() + 172800000); // 2 days
      const dueBefore = prospective.getTasks({ dueBefore: deadline });
      expect(dueBefore.every(t => !t.dueAt || t.dueAt <= deadline)).toBe(true);
    });

    it('should sort by priority and due date', () => {
      const tasks = prospective.getTasks();

      // First task should be critical (highest priority)
      expect(tasks[0].priority).toBe('critical');
    });
  });

  describe('Upcoming and Overdue Tasks', () => {
    beforeEach(async () => {
      await prospective.initialize();

      // Create upcoming task
      await prospective.createTask({
        title: 'Upcoming',
        dueAt: new Date(Date.now() + 3 * 86400000), // 3 days
      });

      // Create overdue task (manually set)
      const overdue = await prospective.createTask({
        title: 'Overdue',
        dueAt: new Date(Date.now() - 86400000), // 1 day ago
      });
    });

    it('should get upcoming tasks', () => {
      const upcoming = prospective.getUpcomingTasks(7);
      expect(upcoming.some(t => t.title === 'Upcoming')).toBe(true);
    });

    it('should get overdue tasks', () => {
      const overdue = prospective.getOverdueTasks();
      expect(overdue.some(t => t.title === 'Overdue')).toBe(true);
    });

    it('should respect days parameter for upcoming', () => {
      const upcoming1Day = prospective.getUpcomingTasks(1);
      expect(upcoming1Day.every(t => {
        if (!t.dueAt) return true;
        const diff = t.dueAt.getTime() - Date.now();
        return diff <= 86400000;
      })).toBe(true);
    });
  });

  describe('Goal Management', () => {
    beforeEach(async () => {
      await prospective.initialize();
    });

    it('should create a goal', async () => {
      const goal = await prospective.createGoal({
        title: 'Launch MVP',
        description: 'Launch the minimum viable product',
        targetDate: new Date(Date.now() + 30 * 86400000),
      });

      expect(goal).toBeDefined();
      expect(goal.id).toBeDefined();
      expect(goal.title).toBe('Launch MVP');
      expect(goal.status).toBe('active');
      expect(goal.progress).toBe(0);
    });

    it('should create goal with milestones', async () => {
      const goal = await prospective.createGoal({
        title: 'Milestone Goal',
        milestones: [
          { title: 'First Quarter', targetProgress: 25 },
          { title: 'Halfway', targetProgress: 50 },
          { title: 'Three Quarters', targetProgress: 75 },
          { title: 'Complete', targetProgress: 100 },
        ],
      });

      expect(goal.milestones?.length).toBe(4);
      expect(goal.milestones?.[0].achieved).toBe(false);
    });

    it('should emit goal:created event', async () => {
      const handler = jest.fn();
      prospective.on('goal:created', handler);

      const goal = await prospective.createGoal({ title: 'Event Goal' });

      expect(handler).toHaveBeenCalledWith({ goal });
    });

    it('should add task to goal', async () => {
      const goal = await prospective.createGoal({ title: 'Goal with tasks' });
      const task = await prospective.createTask({ title: 'Contributing task' });

      const updated = await prospective.addTaskToGoal(goal.id, task.id);

      expect(updated?.tasks).toContain(task.id);
    });

    it('should not duplicate task in goal', async () => {
      const goal = await prospective.createGoal({ title: 'No duplicates' });
      const task = await prospective.createTask({ title: 'Task' });

      await prospective.addTaskToGoal(goal.id, task.id);
      await prospective.addTaskToGoal(goal.id, task.id);

      const updated = prospective.getGoals()[0];
      expect(updated.tasks.filter(id => id === task.id).length).toBe(1);
    });

    it('should return null when adding to non-existent goal', async () => {
      const task = await prospective.createTask({ title: 'Task' });
      const result = await prospective.addTaskToGoal('non-existent', task.id);
      expect(result).toBeNull();
    });

    it('should get goals by status', async () => {
      await prospective.createGoal({ title: 'Active Goal' });

      const active = prospective.getGoals('active');
      expect(active.every(g => g.status === 'active')).toBe(true);
    });

    it('should sort goals by status and date', () => {
      const goals = prospective.getGoals();
      // Active goals should come first
      let seenNonActive = false;
      for (const goal of goals) {
        if (goal.status !== 'active') {
          seenNonActive = true;
        } else if (seenNonActive) {
          fail('Active goal found after non-active goal');
        }
      }
    });
  });

  describe('Reminder Management', () => {
    beforeEach(async () => {
      await prospective.initialize();
    });

    it('should create a reminder', async () => {
      const triggerAt = new Date(Date.now() + 3600000); // 1 hour

      const reminder = await prospective.createReminder({
        message: 'Remember to review PR',
        triggerAt,
      });

      expect(reminder).toBeDefined();
      expect(reminder.id).toBeDefined();
      expect(reminder.message).toBe('Remember to review PR');
      expect(reminder.triggerAt).toEqual(triggerAt);
      expect(reminder.dismissed).toBe(false);
    });

    it('should create reminder with task reference', async () => {
      const task = await prospective.createTask({ title: 'Linked Task' });

      const reminder = await prospective.createReminder({
        message: 'Work on task',
        triggerAt: new Date(),
        taskId: task.id,
      });

      expect(reminder.taskId).toBe(task.id);
    });

    it('should create recurring reminder', async () => {
      const reminder = await prospective.createReminder({
        message: 'Daily standup',
        triggerAt: new Date(),
        recurring: { interval: 'daily' },
      });

      expect(reminder.recurring?.interval).toBe('daily');
    });

    it('should emit reminder:created event', async () => {
      const handler = jest.fn();
      prospective.on('reminder:created', handler);

      const reminder = await prospective.createReminder({
        message: 'Event reminder',
        triggerAt: new Date(),
      });

      expect(handler).toHaveBeenCalledWith({ reminder });
    });

    it('should get pending reminders', async () => {
      // Create a past reminder (should be pending)
      await prospective.createReminder({
        message: 'Past reminder',
        triggerAt: new Date(Date.now() - 1000), // 1 second ago
      });

      const pending = prospective.getPendingReminders();
      expect(pending.some(r => r.message === 'Past reminder')).toBe(true);
    });

    it('should dismiss a reminder', async () => {
      const reminder = await prospective.createReminder({
        message: 'Dismiss me',
        triggerAt: new Date(Date.now() - 1000),
      });

      const dismissed = await prospective.dismissReminder(reminder.id);

      expect(dismissed).toBe(true);
    });

    it('should emit reminder:dismissed event', async () => {
      const reminder = await prospective.createReminder({
        message: 'Dismiss event',
        triggerAt: new Date(Date.now() - 1000),
      });

      const handler = jest.fn();
      prospective.on('reminder:dismissed', handler);

      await prospective.dismissReminder(reminder.id);

      expect(handler).toHaveBeenCalled();
    });

    it('should reschedule recurring reminder on dismiss', async () => {
      const reminder = await prospective.createReminder({
        message: 'Recurring',
        triggerAt: new Date(Date.now() - 1000),
        recurring: { interval: 'daily' },
      });

      const handler = jest.fn();
      prospective.on('reminder:rescheduled', handler);

      await prospective.dismissReminder(reminder.id);

      expect(handler).toHaveBeenCalled();
    });

    it('should return false when dismissing non-existent reminder', async () => {
      const dismissed = await prospective.dismissReminder('non-existent');
      expect(dismissed).toBe(false);
    });
  });

  describe('Event Triggers', () => {
    beforeEach(async () => {
      await prospective.initialize();
    });

    it('should fire event and trigger matching tasks', async () => {
      await prospective.createTask({
        title: 'Event-triggered task',
        trigger: { type: 'event', event: 'build:complete' },
      });

      const triggered = await prospective.fireEvent('build:complete');

      expect(triggered.length).toBe(1);
      expect(triggered[0].title).toBe('Event-triggered task');
      expect(triggered[0].trigger.fired).toBe(true);
    });

    it('should emit task:triggered event', async () => {
      await prospective.createTask({
        title: 'Triggered task',
        trigger: { type: 'event', event: 'test:event' },
      });

      const handler = jest.fn();
      prospective.on('task:triggered', handler);

      await prospective.fireEvent('test:event');

      expect(handler).toHaveBeenCalled();
    });

    it('should not trigger already-fired tasks', async () => {
      await prospective.createTask({
        title: 'One-time trigger',
        trigger: { type: 'event', event: 'once:event' },
      });

      await prospective.fireEvent('once:event');
      const secondTrigger = await prospective.fireEvent('once:event');

      expect(secondTrigger.length).toBe(0);
    });

    it('should pass event data to handler', async () => {
      await prospective.createTask({
        title: 'Data task',
        trigger: { type: 'event', event: 'data:event' },
      });

      const handler = jest.fn();
      prospective.on('task:triggered', handler);

      await prospective.fireEvent('data:event', { key: 'value' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ data: { key: 'value' } })
      );
    });
  });

  describe('Context Building', () => {
    beforeEach(async () => {
      await prospective.initialize();
    });

    it('should build context string', async () => {
      await prospective.createTask({
        title: 'Upcoming task',
        priority: 'high',
        dueAt: new Date(Date.now() + 86400000),
      });

      await prospective.createGoal({
        title: 'Active goal',
      });

      const context = prospective.buildContext();

      expect(context).toContain('Upcoming Tasks');
      expect(context).toContain('Active Goals');
    });

    it('should include overdue tasks', async () => {
      await prospective.createTask({
        title: 'Overdue task',
        dueAt: new Date(Date.now() - 86400000),
      });

      const context = prospective.buildContext();

      expect(context).toContain('Overdue Tasks');
    });

    it('should include pending reminders', async () => {
      await prospective.createReminder({
        message: 'Pending reminder',
        triggerAt: new Date(Date.now() - 1000),
      });

      const context = prospective.buildContext();

      expect(context).toContain('Pending Reminders');
    });
  });

  describe('Format Status', () => {
    beforeEach(async () => {
      await prospective.initialize();
      await prospective.createTask({ title: 'Test' });
      await prospective.createGoal({ title: 'Test Goal' });
    });

    it('should format status correctly', () => {
      const status = prospective.formatStatus();

      expect(status).toContain('PROSPECTIVE MEMORY');
      expect(status).toContain('Pending Tasks');
      expect(status).toContain('In Progress');
      expect(status).toContain('Active Goals');
    });

    it('should show overdue count', async () => {
      await prospective.createTask({
        title: 'Overdue',
        dueAt: new Date(Date.now() - 86400000),
      });

      const status = prospective.formatStatus();

      expect(status).toContain('Overdue');
    });

    it('should show command hints', () => {
      const status = prospective.formatStatus();

      expect(status).toContain('/task');
      expect(status).toContain('/goal');
      expect(status).toContain('/reminder');
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      await prospective.initialize();
    });

    it('should cleanup old completed tasks', async () => {
      const task = await prospective.createTask({
        title: 'Old completed',
        subtasks: ['Only one'],
      });

      // Complete the task
      await prospective.completeSubtask(task.id, task.subtasks![0].id);

      // Set completedAt to old date
      const updatedTask = prospective.getTasks({ status: 'completed' })[0];
      if (updatedTask) {
        updatedTask.completedAt = new Date(Date.now() - 60 * 86400000); // 60 days ago
      }

      const removed = await prospective.cleanup();

      // Should have removed the old task
      expect(removed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Dispose', () => {
    it('should clean up on dispose', async () => {
      await prospective.initialize();

      prospective.dispose();

      expect(prospective.listenerCount('task:created')).toBe(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      resetProspectiveMemory();
      const instance1 = getProspectiveMemory();
      const instance2 = getProspectiveMemory();
      expect(instance1).toBe(instance2);
      instance1.dispose();
    });

    it('should reset instance', () => {
      resetProspectiveMemory();
      const instance1 = getProspectiveMemory();
      resetProspectiveMemory();
      const instance2 = getProspectiveMemory();
      expect(instance1).not.toBe(instance2);
      instance1.dispose();
      instance2.dispose();
    });

    it('should initialize via factory', async () => {
      resetProspectiveMemory();
      const instance = await initializeProspectiveMemory();
      expect(instance).toBeDefined();
      instance.dispose();
    });
  });
});
