import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  handleCommand,
  setConversationHistory,
  setCodeBuddyClient,
  handleGoal,
  handleLoop,
  handleSubgoal,
} = vi.hoisted(() => ({
  handleCommand: vi.fn(),
  setConversationHistory: vi.fn(),
  setCodeBuddyClient: vi.fn(),
  handleGoal: vi.fn(),
  handleLoop: vi.fn(),
  handleSubgoal: vi.fn(),
}));

vi.mock('../../src/commands/enhanced-command-handler.js', () => ({
  getEnhancedCommandHandler: () => ({
    handleCommand,
    setConversationHistory,
    setCodeBuddyClient,
  }),
}));

vi.mock('../../src/commands/handlers/goal-handler.js', () => ({
  handleGoal,
  handleLoop,
  handleSubgoal,
}));

import {
  executeHeadlessSlashToken,
  isSpecialCommandToken,
} from '../../src/commands/headless-slash.js';

describe('headless slash execution', () => {
  beforeEach(() => {
    handleCommand.mockReset();
    setConversationHistory.mockReset();
    setCodeBuddyClient.mockReset();
    handleGoal.mockReset();
    handleLoop.mockReset();
    handleSubgoal.mockReset();
  });

  describe('isSpecialCommandToken', () => {
    it('recognizes __TOKEN__ markers', () => {
      expect(isSpecialCommandToken('__HELP__')).toBe(true);
      expect(isSpecialCommandToken('__YOLO_MODE__')).toBe(true);
    });
    it('rejects non-tokens', () => {
      expect(isSpecialCommandToken('help')).toBe(false);
      expect(isSpecialCommandToken('/help')).toBe(false);
      expect(isSpecialCommandToken('____')).toBe(false);
      expect(isSpecialCommandToken('')).toBe(false);
    });
  });

  it('returns handled:false for non-token input', async () => {
    const res = await executeHeadlessSlashToken('not a token', [], new Set(['__HELP__']));
    expect(res.handled).toBe(false);
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it('default-denies a token outside the allow set (no handler run)', async () => {
    const res = await executeHeadlessSlashToken('__COMPACT__', [], new Set(['__HELP__']));
    expect(res).toMatchObject({ handled: true, denied: true });
    expect(res.reason).toContain('__COMPACT__');
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it('runs an allowed token and maps entry.content to output', async () => {
    handleCommand.mockResolvedValue({
      handled: true,
      entry: { type: 'assistant', content: 'YOLO MODE: ENABLED', timestamp: new Date() },
    });
    const res = await executeHeadlessSlashToken('__YOLO_MODE__', ['on'], new Set(['__YOLO_MODE__']));
    expect(res).toMatchObject({ handled: true, output: 'YOLO MODE: ENABLED' });
    expect(res.denied).toBeUndefined();
    expect(handleCommand).toHaveBeenCalledWith('__YOLO_MODE__', ['on'], '__YOLO_MODE__ on');
  });

  it('passes through passToAI + prompt', async () => {
    handleCommand.mockResolvedValue({ handled: true, passToAI: true, prompt: 'do the thing' });
    const res = await executeHeadlessSlashToken('__REVIEW__', [], new Set(['__REVIEW__']));
    expect(res).toMatchObject({ handled: true, passToAI: true, prompt: 'do the thing' });
  });

  it('wires session context when provided', async () => {
    handleCommand.mockResolvedValue({ handled: true, entry: { type: 'assistant', content: 'ok', timestamp: new Date() } });
    const history = [{ type: 'user' as const, content: 'hi', timestamp: new Date() }];
    await executeHeadlessSlashToken('__HELP__', [], new Set(['__HELP__']), { conversationHistory: history });
    expect(setConversationHistory).toHaveBeenCalledWith(history);
    expect(setCodeBuddyClient).not.toHaveBeenCalled();
  });

  it('routes goal tokens through the session-scoped goal handler when provided', async () => {
    handleGoal.mockResolvedValue({
      handled: true,
      entry: { type: 'assistant', content: 'goal set', timestamp: new Date() },
      passToAI: true,
      prompt: 'ship it',
    });
    const res = await executeHeadlessSlashToken('__GOAL__', ['ship', 'it'], new Set(['__GOAL__']), {
      goalSessionKey: 'cowork:s1',
    });
    expect(res).toMatchObject({
      handled: true,
      output: 'goal set',
      passToAI: true,
      prompt: 'ship it',
    });
    expect(handleGoal).toHaveBeenCalledWith(['ship', 'it'], {
      sessionKey: 'cowork:s1',
      client: null,
    });
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it('returns a reason instead of throwing when a handler errors', async () => {
    handleCommand.mockRejectedValue(new Error('boom'));
    const res = await executeHeadlessSlashToken('__HELP__', [], new Set(['__HELP__']));
    expect(res).toMatchObject({ handled: true, reason: 'boom' });
  });
});
