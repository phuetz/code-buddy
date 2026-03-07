/**
 * Tests for `buddy lessons` CLI command
 *
 * The LessonsTracker module is mocked so tests exercise only
 * the command wiring (argument parsing, option handling, console output)
 * without touching the filesystem.
 */

import { Command } from 'commander';
import { createLessonsCommand } from '../../src/commands/lessons.js';

// ============================================================================
// Mock the lessons tracker
// ============================================================================

const mockTracker = {
  list: jest.fn(),
  add: jest.fn(),
  search: jest.fn(),
  remove: jest.fn(),
  clearByCategory: jest.fn(),
  buildContextBlock: jest.fn(),
  load: jest.fn(),
  save: jest.fn(),
};

jest.mock('../../src/agent/lessons-tracker.js', () => ({
  getLessonsTracker: jest.fn(function() { return mockTracker; }),
}));

// ============================================================================
// Helpers
// ============================================================================

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  return program;
}

function getLogOutput(spy: jest.SpyInstance): string {
  return (spy.mock.calls as unknown[][]).map(c => c.join(' ')).join('\n');
}

// ============================================================================
// Tests
// ============================================================================

describe('createLessonsCommand', () => {
  let program: Command;
  let consoleSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock return values
    mockTracker.list.mockReturnValue([]);
    mockTracker.add.mockReturnValue({
      id: 'test123',
      category: 'RULE',
      content: 'test content',
      createdAt: Date.now(),
      source: 'manual',
    });
    mockTracker.search.mockReturnValue([]);
    mockTracker.clearByCategory.mockReturnValue(0);
    mockTracker.buildContextBlock.mockReturnValue(null);

    consoleSpy = jest.spyOn(console, 'log').mockImplementation(function() {});
    consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(function() {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(
      (() => {}) as unknown as (code?: number | string | null) => never
    );

    program = createProgram();
    program.addCommand(createLessonsCommand());
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // Command structure
  // --------------------------------------------------------------------------

  it('should create a command named "lessons" with a description', () => {
    const cmd = createLessonsCommand();
    expect(cmd.name()).toBe('lessons');
    expect(cmd.description().length).toBeGreaterThan(0);
  });

  it('should have subcommands: list, add, search, clear, context', () => {
    const cmd = createLessonsCommand();
    const names = cmd.commands.map(c => c.name());
    expect(names).toContain('list');
    expect(names).toContain('add');
    expect(names).toContain('search');
    expect(names).toContain('clear');
    expect(names).toContain('context');
  });

  // --------------------------------------------------------------------------
  // list subcommand
  // --------------------------------------------------------------------------

  describe('list', () => {
    it('should call tracker.list() and print "No lessons recorded" when empty', async () => {
      mockTracker.list.mockReturnValue([]);
      await program.parseAsync(['node', 'buddy', 'lessons', 'list']);
      expect(mockTracker.list).toHaveBeenCalled();
      expect(getLogOutput(consoleSpy)).toContain('No lessons recorded');
    });

    it('should group and display lessons when items exist', async () => {
      mockTracker.list.mockReturnValue([
        { id: 'a1', category: 'RULE', content: 'run tests', createdAt: 0, source: 'manual' },
      ]);
      await program.parseAsync(['node', 'buddy', 'lessons', 'list']);
      expect(getLogOutput(consoleSpy)).toContain('RULE');
      expect(getLogOutput(consoleSpy)).toContain('run tests');
    });
  });

  // --------------------------------------------------------------------------
  // add subcommand
  // --------------------------------------------------------------------------

  describe('add', () => {
    it('should call tracker.add() with parsed category and content', async () => {
      await program.parseAsync([
        'node', 'buddy', 'lessons', 'add', 'always run tsc', '--category', 'RULE',
      ]);
      expect(mockTracker.add).toHaveBeenCalledWith('RULE', 'always run tsc', 'manual', undefined);
    });

    it('should default category to INSIGHT when not specified', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'add', 'some insight']);
      expect(mockTracker.add).toHaveBeenCalledWith('INSIGHT', 'some insight', 'manual', undefined);
    });

    it('should pass context when --context is provided', async () => {
      await program.parseAsync([
        'node', 'buddy', 'lessons', 'add', 'use ESM', '--context', 'Node.js',
      ]);
      expect(mockTracker.add).toHaveBeenCalledWith('INSIGHT', 'use ESM', 'manual', 'Node.js');
    });

    it('should print the added lesson id and category', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'add', 'test content']);
      expect(getLogOutput(consoleSpy)).toContain('test123');
    });
  });

  // --------------------------------------------------------------------------
  // search subcommand
  // --------------------------------------------------------------------------

  describe('search', () => {
    it('should call tracker.search() with the query and print count', async () => {
      mockTracker.search.mockReturnValue([]);
      await program.parseAsync(['node', 'buddy', 'lessons', 'search', 'tsc']);
      expect(mockTracker.search).toHaveBeenCalledWith('tsc', undefined);
      expect(getLogOutput(consoleSpy)).toContain('No lessons found');
    });

    it('should display matching lessons when results exist', async () => {
      mockTracker.search.mockReturnValue([
        { id: 'b1', category: 'PATTERN', content: 'run tsc first', createdAt: 0, source: 'manual' },
      ]);
      await program.parseAsync(['node', 'buddy', 'lessons', 'search', 'tsc']);
      expect(getLogOutput(consoleSpy)).toContain('Found 1');
    });
  });

  // --------------------------------------------------------------------------
  // clear subcommand
  // --------------------------------------------------------------------------

  describe('clear', () => {
    it('should NOT call clearByCategory without --yes flag', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'clear']);
      expect(mockTracker.clearByCategory).not.toHaveBeenCalled();
      expect(getLogOutput(consoleSpy)).toContain('--yes');
    });

    it('should call clearByCategory() when --yes flag is provided', async () => {
      mockTracker.clearByCategory.mockReturnValue(3);
      await program.parseAsync(['node', 'buddy', 'lessons', 'clear', '--yes']);
      expect(mockTracker.clearByCategory).toHaveBeenCalledWith(undefined);
    });

    it('should print the count cleared', async () => {
      mockTracker.clearByCategory.mockReturnValue(5);
      await program.parseAsync(['node', 'buddy', 'lessons', 'clear', '--yes']);
      expect(getLogOutput(consoleSpy)).toContain('5');
    });
  });

  // --------------------------------------------------------------------------
  // context subcommand
  // --------------------------------------------------------------------------

  describe('context', () => {
    it('should call tracker.buildContextBlock()', async () => {
      await program.parseAsync(['node', 'buddy', 'lessons', 'context']);
      expect(mockTracker.buildContextBlock).toHaveBeenCalled();
    });

    it('should print "No lessons" when buildContextBlock returns null', async () => {
      mockTracker.buildContextBlock.mockReturnValue(null);
      await program.parseAsync(['node', 'buddy', 'lessons', 'context']);
      expect(getLogOutput(consoleSpy)).toContain('No lessons');
    });

    it('should print the block when buildContextBlock returns a string', async () => {
      mockTracker.buildContextBlock.mockReturnValue('<lessons_context>block</lessons_context>');
      await program.parseAsync(['node', 'buddy', 'lessons', 'context']);
      expect(getLogOutput(consoleSpy)).toContain('<lessons_context>');
    });
  });
});
