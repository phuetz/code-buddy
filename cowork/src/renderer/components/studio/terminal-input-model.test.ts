import { describe, expect, it } from 'vitest';
import { navigate, pushCommand, TERMINAL_HISTORY_LIMIT } from './terminal-input-model';

describe('terminal-input-model', () => {
  describe('pushCommand', () => {
    it('adds a trimmed command without mutating history', () => {
      const history = ['npm test'];

      const next = pushCommand(history, '  npm run build  ');

      expect(next).toEqual(['npm test', 'npm run build']);
      expect(history).toEqual(['npm test']);
    });

    it('deduplicates only the last command', () => {
      expect(pushCommand(['npm test'], 'npm test')).toEqual(['npm test']);
      expect(pushCommand(['npm test', 'npm run build'], 'npm test')).toEqual([
        'npm test',
        'npm run build',
        'npm test',
      ]);
    });

    it('ignores blank commands', () => {
      expect(pushCommand(['npm test'], '   ')).toEqual(['npm test']);
    });

    it('caps history to the newest 100 commands', () => {
      const history = Array.from({ length: TERMINAL_HISTORY_LIMIT }, (_, index) => `cmd-${index}`);

      const next = pushCommand(history, 'cmd-100');

      expect(next).toHaveLength(TERMINAL_HISTORY_LIMIT);
      expect(next[0]).toBe('cmd-1');
      expect(next.at(-1)).toBe('cmd-100');
    });
  });

  describe('navigate', () => {
    const history = ['first', 'second', 'third'];

    it('moves up through history and clamps at the oldest command', () => {
      expect(navigate(history, history.length, 'up')).toEqual({ cursor: 2, value: 'third' });
      expect(navigate(history, 2, 'up')).toEqual({ cursor: 1, value: 'second' });
      expect(navigate(history, 0, 'up')).toEqual({ cursor: 0, value: 'first' });
    });

    it('moves down through history and returns an empty input after the newest command', () => {
      expect(navigate(history, 0, 'down')).toEqual({ cursor: 1, value: 'second' });
      expect(navigate(history, 2, 'down')).toEqual({ cursor: 3, value: '' });
      expect(navigate(history, 3, 'down')).toEqual({ cursor: 3, value: '' });
    });

    it('bounds out-of-range cursors', () => {
      expect(navigate(history, -10, 'up')).toEqual({ cursor: 0, value: 'first' });
      expect(navigate(history, 99, 'down')).toEqual({ cursor: 3, value: '' });
    });

    it('returns an empty value for empty history', () => {
      expect(navigate([], 0, 'up')).toEqual({ cursor: 0, value: '' });
      expect(navigate([], 0, 'down')).toEqual({ cursor: 0, value: '' });
    });
  });
});
