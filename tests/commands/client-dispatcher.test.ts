import { describe, expect, it } from 'vitest';
import {
  COMMAND_COMPLETED_WITH_NO_OUTPUT,
  formatCommandResultContent,
} from '../../src/commands/client-dispatcher.js';

describe('ClientCommandDispatcher command result formatting', () => {
  it('labels command success with no output explicitly', () => {
    expect(formatCommandResultContent({ success: true, output: '' })).toBe(
      COMMAND_COMPLETED_WITH_NO_OUTPUT
    );
  });

  it('preserves successful command output', () => {
    expect(formatCommandResultContent({ success: true, output: 'hello' })).toBe('hello');
  });

  it('preserves command errors', () => {
    expect(formatCommandResultContent({ success: false, error: 'boom' })).toBe('boom');
  });

  it('keeps an explicit fallback for failed commands without errors', () => {
    expect(formatCommandResultContent({ success: false })).toBe('Command failed');
  });
});
