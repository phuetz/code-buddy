/**
 * Tests for Extra Slash Command Handlers
 *
 * Tests the UX slash commands: /undo, /diff, /context stats, /search, /test, /fix, /review
 */

import {
  handleUndo,
  handleDiff,
  handleContextStats,
  handleSearch,
  handleTest,
  handleFix,
  handleReview,
} from '../../src/commands/handlers/extra-handlers.js';

// ============================================================================
// /undo
// ============================================================================

describe('handleUndo', () => {
  it('should return handled=true', async () => {
    const result = await handleUndo([]);
    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
  });

  it('should report when no checkpoints available', async () => {
    // With no prior file edits, there should be no checkpoints
    const result = await handleUndo([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.type).toBe('assistant');
    // Either no checkpoints or checkpoint error
    expect(result.entry?.content).toBeDefined();
  });
});

// ============================================================================
// /diff
// ============================================================================

describe('handleDiff', () => {
  it('should return handled=true', async () => {
    const result = await handleDiff([]);
    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
  });

  it('should show git diff output or no changes message', async () => {
    const result = await handleDiff([]);
    expect(result.handled).toBe(true);
    // Should either show diff content or "No uncommitted changes"
    const content = result.entry?.content || '';
    const hasDiff = content.includes('diff') || content.includes('changes') || content.includes('Changes');
    expect(hasDiff).toBe(true);
  });

  it('should have assistant type entry', async () => {
    const result = await handleDiff([]);
    expect(result.entry?.type).toBe('assistant');
  });
});

// ============================================================================
// /context stats
// ============================================================================

describe('handleContextStats', () => {
  it('should return handled=true without agent', async () => {
    const result = await handleContextStats([]);
    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
    expect(result.entry?.content).toContain('only available');
  });

  it('should show stats when agent is provided', async () => {
    const mockAgent = {
      getContextStats: () => ({
        totalTokens: 5000,
        maxTokens: 128000,
        messageCount: 10,
        usagePercent: 3.9,
        isCritical: false,
        isNearLimit: false,
        summarizedSessions: 0,
      }),
      formatContextStats: () => 'Context: 5000/128000 tokens',
      getCurrentModel: () => 'grok-3-fast-latest',
    };

    const result = await handleContextStats([], mockAgent);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Context Window Statistics');
    expect(result.entry?.content).toContain('5,000');
    expect(result.entry?.content).toContain('128,000');
    expect(result.entry?.content).toContain('grok-3-fast-latest');
    expect(result.entry?.content).toContain('10');
    expect(result.entry?.content).toContain('OK');
  });

  it('should show WARNING status when near limit', async () => {
    const mockAgent = {
      getContextStats: () => ({
        totalTokens: 100000,
        maxTokens: 128000,
        messageCount: 50,
        usagePercent: 78.1,
        isCritical: false,
        isNearLimit: true,
        summarizedSessions: 2,
      }),
      formatContextStats: () => 'Context: 100000/128000 tokens',
      getCurrentModel: () => 'grok-3-fast-latest',
    };

    const result = await handleContextStats([], mockAgent);
    expect(result.entry?.content).toContain('WARNING');
  });

  it('should show CRITICAL status when critical', async () => {
    const mockAgent = {
      getContextStats: () => ({
        totalTokens: 125000,
        maxTokens: 128000,
        messageCount: 100,
        usagePercent: 97.7,
        isCritical: true,
        isNearLimit: true,
        summarizedSessions: 5,
      }),
      formatContextStats: () => 'Context: 125000/128000 tokens',
      getCurrentModel: () => 'grok-3-fast-latest',
    };

    const result = await handleContextStats([], mockAgent);
    expect(result.entry?.content).toContain('CRITICAL');
  });

  it('should show progress bar', async () => {
    const mockAgent = {
      getContextStats: () => ({
        totalTokens: 50000,
        maxTokens: 100000,
        messageCount: 20,
        usagePercent: 50.0,
        isCritical: false,
        isNearLimit: false,
        summarizedSessions: 1,
      }),
      formatContextStats: () => 'Context stats',
      getCurrentModel: () => 'test-model',
    };

    const result = await handleContextStats([], mockAgent);
    expect(result.entry?.content).toContain('[');
    expect(result.entry?.content).toContain('#');
    expect(result.entry?.content).toContain('%');
  });
});

// ============================================================================
// /search
// ============================================================================

describe('handleSearch', () => {
  it('should show usage when no query provided', async () => {
    const result = await handleSearch([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Usage');
    expect(result.entry?.content).toContain('/search');
  });

  it('should return search results for a known pattern', async () => {
    // Search for 'import' which should be present in this codebase
    const result = await handleSearch(['import']);
    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
    const content = result.entry?.content || '';
    // Should either find results or report no matches
    const hasResult = content.includes('Search results') || content.includes('No matches');
    expect(hasResult).toBe(true);
  });

  it('should report no matches for non-existent pattern', async () => {
    const result = await handleSearch(['xyzNonExistentPatternQwertyuiop12345']);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('No matches');
  });

  it('should join multi-word queries', async () => {
    const result = await handleSearch(['function', 'handleSearch']);
    expect(result.handled).toBe(true);
    // The query should be joined as "function handleSearch"
    expect(result.entry).toBeDefined();
  });
});

// ============================================================================
// /test
// ============================================================================

describe('handleTest', () => {
  it('should return handled=true', async () => {
    // Note: this actually runs npm test, so we just verify the handler structure
    // In a real test, this would take too long, so we just verify the interface
    const result = await handleTest(['--help']);
    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
    expect(result.entry?.type).toBe('assistant');
  });

  it('should include "Test results" in output', async () => {
    const result = await handleTest(['--help']);
    expect(result.entry?.content).toContain('Test results');
  });
});

// ============================================================================
// /fix
// ============================================================================

describe('handleFix', () => {
  it('should return handled=true', async () => {
    const result = await handleFix([]);
    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
  });

  it('should mention ESLint or TypeScript in output', async () => {
    const result = await handleFix([]);
    const content = result.entry?.content || '';
    // Should mention at least one of the tools
    const mentionsTool = content.includes('ESLint') || content.includes('TypeScript');
    expect(mentionsTool).toBe(true);
  });

  it('should have assistant type entry', async () => {
    const result = await handleFix([]);
    expect(result.entry?.type).toBe('assistant');
  });
});

// ============================================================================
// /review
// ============================================================================

describe('handleReview', () => {
  it('should return handled=true', async () => {
    const result = await handleReview([]);
    expect(result.handled).toBe(true);
  });

  it('should either pass to AI or show no changes message', async () => {
    const result = await handleReview([]);
    if (result.passToAI) {
      // Has changes to review - should provide a prompt
      expect(result.prompt).toBeDefined();
      expect(result.prompt).toContain('review');
    } else {
      // No changes to review
      expect(result.entry?.content).toContain('No changes');
    }
  });

  it('should include diff in prompt when changes exist', async () => {
    const result = await handleReview([]);
    if (result.passToAI && result.prompt) {
      expect(result.prompt).toContain('diff');
    }
  });
});

// ============================================================================
// Slash command registration
// ============================================================================

describe('Slash command registration', () => {
  it('should register new commands in builtin-commands', async () => {
    const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
    const commandNames = builtinCommands.map(cmd => cmd.name);

    expect(commandNames).toContain('undo');
    expect(commandNames).toContain('diff');
    expect(commandNames).toContain('search');
    expect(commandNames).toContain('fix');
    expect(commandNames).toContain('test');
    expect(commandNames).toContain('review');
  });

  it('should have __UNDO__ token for /undo command', async () => {
    const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
    const undoCmd = builtinCommands.find(cmd => cmd.name === 'undo');

    expect(undoCmd).toBeDefined();
    expect(undoCmd?.prompt).toBe('__UNDO__');
    expect(undoCmd?.isBuiltin).toBe(true);
  });

  it('should have __DIFF__ token for /diff command', async () => {
    const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
    const diffCmd = builtinCommands.find(cmd => cmd.name === 'diff');

    expect(diffCmd).toBeDefined();
    expect(diffCmd?.prompt).toBe('__DIFF__');
  });

  it('should have __SEARCH__ token for /search command', async () => {
    const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
    const searchCmd = builtinCommands.find(cmd => cmd.name === 'search');

    expect(searchCmd).toBeDefined();
    expect(searchCmd?.prompt).toBe('__SEARCH__');
  });

  it('should have __TEST__ token for /test command', async () => {
    const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
    const testCmd = builtinCommands.find(cmd => cmd.name === 'test');

    expect(testCmd).toBeDefined();
    expect(testCmd?.prompt).toBe('__TEST__');
  });

  it('should have __FIX__ token for /fix command', async () => {
    const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
    const fixCmd = builtinCommands.find(cmd => cmd.name === 'fix');

    expect(fixCmd).toBeDefined();
    expect(fixCmd?.prompt).toBe('__FIX__');
  });

  it('should have __REVIEW__ token for /review command', async () => {
    const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
    const reviewCmd = builtinCommands.find(cmd => cmd.name === 'review');

    expect(reviewCmd).toBeDefined();
    expect(reviewCmd?.prompt).toBe('__REVIEW__');
  });

  it('should support stats subcommand in /context description', async () => {
    const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
    const contextCmd = builtinCommands.find(cmd => cmd.name === 'context');

    expect(contextCmd).toBeDefined();
    const argDesc = contextCmd?.arguments?.[0]?.description || '';
    expect(argDesc).toContain('stats');
  });
});

// ============================================================================
// Enhanced command handler dispatch
// ============================================================================

describe('EnhancedCommandHandler dispatch', () => {
  let handler: InstanceType<typeof import('../../src/commands/enhanced-command-handler.js').EnhancedCommandHandler>;

  beforeEach(async () => {
    const { EnhancedCommandHandler } = await import('../../src/commands/enhanced-command-handler.js');
    handler = new EnhancedCommandHandler();
  });

  it('should handle __UNDO__ token', async () => {
    const result = await handler.handleCommand('__UNDO__', [], '/undo');
    expect(result.handled).toBe(true);
  });

  it('should handle __DIFF__ token with no args (git diff)', async () => {
    const result = await handler.handleCommand('__DIFF__', [], '/diff');
    expect(result.handled).toBe(true);
  });

  it('should handle __DIFF__ token with args (checkpoint diff)', async () => {
    const result = await handler.handleCommand('__DIFF__', ['last'], '/diff last');
    expect(result.handled).toBe(true);
  });

  it('should handle __SEARCH__ token', async () => {
    const result = await handler.handleCommand('__SEARCH__', ['test'], '/search test');
    expect(result.handled).toBe(true);
  });

  it('should handle __TEST__ token', async () => {
    const result = await handler.handleCommand('__TEST__', ['--help'], '/test --help');
    expect(result.handled).toBe(true);
  });

  it('should handle __FIX__ token', async () => {
    const result = await handler.handleCommand('__FIX__', [], '/fix');
    expect(result.handled).toBe(true);
  });

  it('should handle __REVIEW__ token', async () => {
    const result = await handler.handleCommand('__REVIEW__', [], '/review');
    expect(result.handled).toBe(true);
  });
});
