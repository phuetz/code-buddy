export const TERMINAL_HISTORY_LIMIT = 100;

export type TerminalHistoryDirection = 'up' | 'down';

export interface TerminalHistoryNavigationResult {
  cursor: number;
  value: string;
}

export function pushCommand(history: readonly string[], cmd: string): string[] {
  const command = cmd.trim();
  if (!command) return [...history];

  const next = history[history.length - 1] === command ? [...history] : [...history, command];
  return next.slice(-TERMINAL_HISTORY_LIMIT);
}

export function navigate(
  history: readonly string[],
  cursor: number,
  direction: TerminalHistoryDirection,
): TerminalHistoryNavigationResult {
  if (history.length === 0) {
    return { cursor: 0, value: '' };
  }

  const boundedCursor = Math.min(Math.max(cursor, 0), history.length);
  const nextCursor =
    direction === 'up'
      ? Math.max(0, boundedCursor - 1)
      : Math.min(history.length, boundedCursor + 1);

  return {
    cursor: nextCursor,
    value: nextCursor === history.length ? '' : history[nextCursor] ?? '',
  };
}
