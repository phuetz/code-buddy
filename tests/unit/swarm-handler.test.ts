/**
 * Tests for `/swarm` slash command — thin UX wrapper around handleAgents.
 *
 * Inspired by Korben's article on Claude Code's hidden Swarms mode.
 * The swarm handler:
 * - Saves and restores activeStrategy around the run
 * - Forces strategy=parallel during the delegated /agents run
 * - Wraps output with thematic banner + footer
 * - Pass-through for stop / status sub-actions
 * - Help shown when no args or `help`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agents-handler module so we can verify what /swarm dispatches
// to it AND control the strategy state without booting the MultiAgentSystem.
const handleAgentsMock = vi.hoisted(() => vi.fn());
const strategyState = vi.hoisted(() => ({ value: 'hierarchical' as string }));
const peekMock = vi.hoisted(() => vi.fn(() => strategyState.value));
const setMock = vi.hoisted(() => vi.fn((s: string) => { strategyState.value = s; }));

vi.mock('../../src/commands/handlers/agents-handler.js', () => ({
  handleAgents: handleAgentsMock,
  _peekActiveStrategy: peekMock,
  _setActiveStrategy: setMock,
}));

import { handleSwarm } from '../../src/commands/handlers/swarm-handler.js';

describe('handleSwarm — /swarm slash command', () => {
  beforeEach(() => {
    handleAgentsMock.mockReset();
    handleAgentsMock.mockResolvedValue({
      handled: true,
      entry: { type: 'assistant', content: 'mock /agents output', timestamp: new Date() },
    });
    strategyState.value = 'hierarchical';
    peekMock.mockClear();
    setMock.mockClear();
  });

  describe('help / no args', () => {
    it('shows help when no args', async () => {
      const result = await handleSwarm([]);
      expect(result.handled).toBe(true);
      const c = result.entry?.content as string;
      expect(c).toContain('Usage: /swarm');
      expect(c).toContain('team lead');
      expect(c).toContain('parallel');
      expect(c).not.toContain('mock /agents output'); // didn't dispatch
      expect(handleAgentsMock).not.toHaveBeenCalled();
    });

    it('shows help on `help` action', async () => {
      const result = await handleSwarm(['help']);
      expect(result.entry?.content).toContain('Usage: /swarm');
      expect(handleAgentsMock).not.toHaveBeenCalled();
    });

    it('shows help on `--help` and `-h` flags', async () => {
      const r1 = await handleSwarm(['--help']);
      const r2 = await handleSwarm(['-h']);
      expect(r1.entry?.content).toContain('Usage: /swarm');
      expect(r2.entry?.content).toContain('Usage: /swarm');
    });

    it('help text references Korben source for context', async () => {
      const c = (await handleSwarm([])).entry?.content as string;
      expect(c.toLowerCase()).toContain('korben');
    });
  });

  describe('pass-through actions', () => {
    it('/swarm stop delegates to /agents stop', async () => {
      await handleSwarm(['stop']);
      expect(handleAgentsMock).toHaveBeenCalledWith(['stop']);
      // No strategy override for pass-through
      expect(setMock).not.toHaveBeenCalled();
    });

    it('/swarm status delegates to /agents status', async () => {
      await handleSwarm(['status']);
      expect(handleAgentsMock).toHaveBeenCalledWith(['status']);
      expect(setMock).not.toHaveBeenCalled();
    });
  });

  describe('task dispatch (the main path)', () => {
    it('forwards task to /agents run with strategy=parallel override', async () => {
      await handleSwarm(['refactor', 'the', 'auth', 'module']);
      expect(handleAgentsMock).toHaveBeenCalledWith(
        ['run', 'refactor the auth module'],
        expect.objectContaining({
          threadDelegation: expect.objectContaining({
            concurrency: 1,
            parentBudget: {
              maxTurns: 100,
              maxCostUsd: 10,
              maxContextTokens: 128_000,
            },
            onEvent: expect.any(Function),
          }),
        }),
      );
      // Strategy must be set to parallel before the delegated call.
      expect(setMock).toHaveBeenCalledWith('parallel');
      expect(setMock.mock.invocationCallOrder[0]).toBeLessThan(
        handleAgentsMock.mock.invocationCallOrder[0],
      );
    });

    it('restores the previous strategy after the run (no permanent mutation)', async () => {
      strategyState.value = 'hierarchical';
      await handleSwarm(['some', 'task']);
      // After the call, strategy must be back to its prior value.
      // setMock should have been called twice: once with 'parallel', once with 'hierarchical'.
      const calls = setMock.mock.calls.map(c => c[0]);
      expect(calls[0]).toBe('parallel');
      expect(calls[calls.length - 1]).toBe('hierarchical');
      expect(strategyState.value).toBe('hierarchical');
    });

    it('restores strategy even if handleAgents throws', async () => {
      strategyState.value = 'iterative';
      handleAgentsMock.mockRejectedValueOnce(new Error('boom'));
      await expect(handleSwarm(['fail-task'])).rejects.toThrow('boom');
      // Strategy must STILL be restored despite the error
      expect(strategyState.value).toBe('iterative');
    });

    it('wraps output with thematic banner and footer', async () => {
      const result = await handleSwarm(['analyze', 'the', 'codebase']);
      const c = result.entry?.content as string;
      expect(c).toContain('🐝 Swarm spawning');
      expect(c).toContain('analyze the codebase');
      expect(c).toContain('parallel');
      expect(c).toContain('mock /agents output'); // delegated content present
      expect(c).toContain('💡 Tip: /swarm status');
    });

    it('does not crash when handleAgents returns no entry content', async () => {
      handleAgentsMock.mockResolvedValueOnce({ handled: true });
      const result = await handleSwarm(['task']);
      expect(result.handled).toBe(true);
      // Strategy still gets restored
      expect(strategyState.value).toBe('hierarchical');
    });
  });
});
