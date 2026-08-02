import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateToolCall,
  setGuardianLLMCall,
} from '../../src/security/guardian-agent.js';

const context = {
  toolName: 'str_replace_editor',
  content: 'edit src/main.ts',
  cwd: '/project',
};

afterEach(() => setGuardianLLMCall(null));

describe('Guardian fail-closed decisions', () => {
  it('denies without a reviewer unless a real prompt surface exists', async () => {
    expect((await evaluateToolCall(context)).decision).toBe('deny');
    expect((await evaluateToolCall({ ...context, canPromptUser: true })).decision)
      .toBe('prompt_user');
    expect((await evaluateToolCall({ ...context, canPromptUser: true, yoloMode: true })).decision)
      .toBe('deny');
  });

  it.each([
    ['not json'],
    ['{"reasoning":"missing score"}'],
    ['{"risk_score":"50"}'],
    ['{"risk_score":-1,"reasoning":"invalid","risks":[]}'],
    ['{"risk_score":101,"reasoning":"invalid","risks":[]}'],
    ['{"risk_score":0,"risks":[]}'],
    ['{"risk_score":0,"reasoning":"missing risks"}'],
    ['{"risk_score":0,"reasoning":"bad risks","risks":[1]}'],
  ])('denies an invalid reviewer response: %s', async (response) => {
    setGuardianLLMCall(async () => response);
    expect((await evaluateToolCall(context)).decision).toBe('deny');
  });

  it('maps a medium-risk prompt to deny without a prompt surface or under YOLO', async () => {
    setGuardianLLMCall(async () => '{"risk_score":85,"reasoning":"review","risks":[]}');
    expect((await evaluateToolCall(context)).decision).toBe('deny');
    expect((await evaluateToolCall({ ...context, canPromptUser: true })).decision)
      .toBe('prompt_user');
    expect((await evaluateToolCall({ ...context, canPromptUser: true, yoloMode: true })).decision)
      .toBe('deny');
  });

  it('denies when the reviewer throws', async () => {
    setGuardianLLMCall(async () => { throw new Error('offline'); });
    expect((await evaluateToolCall(context)).decision).toBe('deny');
  });
});
