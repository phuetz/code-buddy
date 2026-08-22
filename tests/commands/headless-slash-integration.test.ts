import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NO mocks: exercise the real core chain
//   executeHeadlessSlashToken -> getEnhancedCommandHandler -> real handler.
// This is the one test that proves info commands actually produce headless
// output, rather than asserting it against a fake of the next layer.
import { executeHeadlessSlashToken } from '../../src/commands/headless-slash.js';
import { maybeContinueGoalAfterTurn } from '../../src/goals/goal-loop.js';
import { resetGoalManagers } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';

const ALLOW = new Set(['__HELP__', '__STATS__', '__GOAL__', '__SUBGOAL__']);

describe('headless slash — real engine chain (no mocks)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headless-slash-goal-test-'));
    resetGoalManagers(new GoalStore({ storeDir: tmpDir }));
  });

  afterEach(() => {
    resetGoalManagers();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('runs __HELP__ end-to-end and returns real, non-empty help output', async () => {
    const res = await executeHeadlessSlashToken('__HELP__', [], ALLOW);
    expect(res.handled).toBe(true);
    expect(res.denied).toBeUndefined();
    expect(typeof res.output).toBe('string');
    expect((res.output ?? '').length).toBeGreaterThan(0);
  });

  it('runs __STATS__ against the real singleton and returns string output', async () => {
    const res = await executeHeadlessSlashToken('__STATS__', [], ALLOW);
    expect(res.handled).toBe(true);
    expect(typeof res.output).toBe('string');
  });

  it('default-denies a token outside the allow set on the real path (no execution)', async () => {
    const res = await executeHeadlessSlashToken('__YOLO_MODE__', ['on'], ALLOW);
    expect(res).toMatchObject({ handled: true, denied: true });
  });

  it('runs __GOAL__ and __SUBGOAL__ through the real headless slash chain', async () => {
    const goal = await executeHeadlessSlashToken(
      '__GOAL__',
      ['Ship', 'interactive', 'goal'],
      ALLOW
    );
    expect(goal.handled).toBe(true);
    expect(goal.output).toContain('⊙ Goal set (20-turn budget): Ship interactive goal');
    expect(goal.passToAI).toBe(true);
    expect(goal.prompt).toBe('Ship interactive goal');

    const subgoal = await executeHeadlessSlashToken('__SUBGOAL__', ['include', 'regression'], ALLOW);
    expect(subgoal.handled).toBe(true);
    expect(subgoal.output).toBe('✓ Added subgoal 1: include regression');

    const listed = await executeHeadlessSlashToken('__SUBGOAL__', [], ALLOW);
    expect(listed.handled).toBe(true);
    expect(listed.output).toContain('⊙ Goal (active, 0/20 turns, 1 subgoal): Ship interactive goal');
    expect(listed.output).toContain('- 1. include regression');
  });

  it('feeds headless __SUBGOAL__ criteria into the real continuation loop', async () => {
    await executeHeadlessSlashToken('__GOAL__', ['Ship', 'interactive', 'goal'], ALLOW);
    await executeHeadlessSlashToken(
      '__SUBGOAL__',
      ['include', 'a', 'visible', 'regression', 'command'],
      ALLOW
    );
    const client = {
      chat: vi.fn(async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '{"done": false, "reason": "regression command is missing"}',
            },
            finish_reason: 'stop',
          },
        ],
      })),
      getCurrentModel: vi.fn(() => 'gpt-5.5'),
    };

    const outcome = await maybeContinueGoalAfterTurn({
      client: client as never,
      lastResponse: 'Implemented the main goal, but did not mention a regression command.',
      interrupted: false,
    });

    expect(outcome?.message).toBe(
      '↻ Continuing toward goal (1/20): regression command is missing'
    );
    expect(outcome?.continuationPrompt).toContain(
      '- 1. include a visible regression command'
    );
    const judgePrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(judgePrompt).toContain('- 1. include a visible regression command');
  });
});
