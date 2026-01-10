/**
 * Tests for Session Command Handlers
 */

import {
  handleSessions,
  CommandHandlerResult,
} from '../../src/commands/handlers/session-handlers.js';

describe('Session Handlers', () => {
  describe('handleSessions', () => {
    describe('list action', () => {
      it('should list sessions by default', () => {
        const result = handleSessions([]);

        expect(result.handled).toBe(true);
        expect(result.entry).toBeDefined();
        // Will either show sessions or "No sessions found"
      });

      it('should list sessions with explicit list action', () => {
        const result = handleSessions(['list']);

        expect(result.handled).toBe(true);
        expect(result.entry).toBeDefined();
      });

      it('should support limit parameter', () => {
        const result = handleSessions(['list', '5']);

        expect(result.handled).toBe(true);
        expect(result.entry).toBeDefined();
      });

      it('should include help text in list output', () => {
        const result = handleSessions(['list']);

        // Help text should include usage hints
        if (result.entry?.content?.includes('Sessions')) {
          expect(result.entry.content).toContain('/sessions');
        }
      });
    });

    describe('show action', () => {
      it('should require session id', () => {
        const result = handleSessions(['show']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('Usage:');
        expect(result.entry?.content).toContain('/sessions show');
      });

      it('should handle non-existent session', () => {
        const result = handleSessions(['show', 'non-existent-id']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('not found');
      });
    });

    describe('replay action', () => {
      it('should require session id', () => {
        const result = handleSessions(['replay']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('Usage:');
        expect(result.entry?.content).toContain('/sessions replay');
      });

      it('should handle non-existent session', () => {
        const result = handleSessions(['replay', 'non-existent-id']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('not found');
      });
    });

    describe('delete action', () => {
      it('should require session id', () => {
        const result = handleSessions(['delete']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('Usage:');
        expect(result.entry?.content).toContain('/sessions delete');
      });

      it('should handle non-existent session', () => {
        const result = handleSessions(['delete', 'non-existent-id']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('not found');
      });
    });

    describe('latest action', () => {
      it('should show latest session or no sessions message', () => {
        const result = handleSessions(['latest']);

        expect(result.handled).toBe(true);
        expect(result.entry).toBeDefined();
        // Will either show session or "No sessions found"
      });
    });

    describe('search action', () => {
      it('should require search term', () => {
        const result = handleSessions(['search']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('Usage:');
        expect(result.entry?.content).toContain('/sessions search');
      });

      it('should handle search with no results', () => {
        const result = handleSessions(['search', 'xyz123nonexistent']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('No sessions found');
      });
    });

    describe('unknown action', () => {
      it('should show help for unknown action', () => {
        const result = handleSessions(['unknown']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('Unknown action');
        expect(result.entry?.content).toContain('Available actions');
      });

      it('should list all available actions', () => {
        const result = handleSessions(['invalid']);

        expect(result.entry?.content).toContain('list');
        expect(result.entry?.content).toContain('show');
        expect(result.entry?.content).toContain('replay');
        expect(result.entry?.content).toContain('delete');
        expect(result.entry?.content).toContain('latest');
        expect(result.entry?.content).toContain('search');
      });
    });
  });
});

describe('CommandHandlerResult Interface', () => {
  it('should have handled field', () => {
    const result: CommandHandlerResult = {
      handled: true,
    };

    expect(result.handled).toBe(true);
  });

  it('should support entry field', () => {
    const result: CommandHandlerResult = {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Response content',
        timestamp: new Date(),
      },
    };

    expect(result.entry?.type).toBe('assistant');
    expect(result.entry?.content).toBe('Response content');
  });

  it('should support sendToAI field', () => {
    const result: CommandHandlerResult = {
      handled: true,
      sendToAI: true,
    };

    expect(result.sendToAI).toBe(true);
  });
});
