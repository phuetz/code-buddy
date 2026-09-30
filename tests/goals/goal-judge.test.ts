import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildJudgeUserPrompt, judgeGoal, parseJudgeResponse } from '../../src/goals/goal-judge.js';
import { JUDGE_SYSTEM_PROMPT } from '../../src/goals/goal-state.js';

const recordUsageSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/cost-tracker.js', () => ({
  getCostTracker: () => ({ recordUsage: recordUsageSpy }),
}));

beforeEach(() => {
  recordUsageSpy.mockClear();
});

function mockClient(content: string) {
  return {
    chat: vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
  } as any;
}

describe('judgeGoal', () => {
  it('lets a local default judge finish after the old 30 second ceiling', async () => {
    vi.useFakeTimers();
    vi.stubEnv('CODEBUDDY_PROVIDER', 'openai'); // actual judge provider wins
    try {
      const client = { getProviderName: () => 'Ollama', chat: vi.fn(() => new Promise(resolve => {
        setTimeout(() => resolve({ choices: [{ message: { content: '{"done":true,"reason":"verified","evidence":"exit 0"}' } }] }), 35_000);
      })) } as never;
      const pending = judgeGoal(client, { goal: 'explain project', lastResponse: 'Read entry file.' });
      await vi.advanceTimersByTimeAsync(35_001);
      expect((await pending).verdict).toBe('done');
    } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
  });

  it('keeps explicit local timeouts and the cloud default authoritative', async () => {
    vi.useFakeTimers();
    vi.stubEnv('CODEBUDDY_PROVIDER', 'ollama');
    try {
      for (const [local, timeoutMs] of [[true, 20_000], [false, undefined]] as const) {
        const client = { isEffectiveTargetLocal: () => local, chat: vi.fn(() => new Promise(() => {})) } as never;
        const pending = judgeGoal(client, { goal: 'g', lastResponse: 'r', timeoutMs });
        await vi.advanceTimersByTimeAsync(timeoutMs ?? 30_000);
        expect((await pending).reason).toContain('judge error');
      }
    } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
  });

  it('returns done verdict from valid JSON', async () => {
    const client = mockClient('{"done": true, "reason": "tests are green"}');
    const result = await judgeGoal(client, { goal: 'fix tests', lastResponse: 'All 30 tests pass.' });
    expect(result).toEqual({ verdict: 'done', reason: 'tests are green', parseFailed: false });
  });

  it('parses fenced JSON', async () => {
    const client = mockClient('```json\n{"done": false, "reason": "two tests still fail"}\n```');
    const result = await judgeGoal(client, { goal: 'fix tests', lastResponse: 'Working on it.' });
    expect(result.verdict).toBe('continue');
    expect(result.reason).toBe('two tests still fail');
    expect(result.parseFailed).toBe(false);
  });

  it('coerces string done values like Hermes', async () => {
    const client = mockClient('{"done": "true", "reason": "ok"}');
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('done');
  });

  it('flags prose replies as parse failures (fail-open continue)', async () => {
    const client = mockClient('The goal looks mostly complete to me!');
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(true);
  });

  it('flags empty replies as parse failures', async () => {
    const client = mockClient('');
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(true);
    expect(result.reason).toContain('empty response');
  });

  it('treats transport errors as continue WITHOUT parse failure', async () => {
    const client = { chat: vi.fn().mockRejectedValue(new Error('ECONNRESET')) } as any;
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(false);
    expect(result.reason).toContain('judge error');
  });

  it('times out hung judge calls as continue without parse failure', async () => {
    const client = { chat: vi.fn().mockReturnValue(new Promise(() => {})) } as any;
    const result = await judgeGoal(client, { goal: 'g', lastResponse: 'r', timeoutMs: 20 });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(false);
  });

  it('skips judging when the goal is empty', async () => {
    const client = mockClient('{"done": true, "reason": "x"}');
    const result = await judgeGoal(client, { goal: '   ', lastResponse: 'r' });
    expect(result.verdict).toBe('skipped');
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('continues without judging when the response is empty', async () => {
    const client = mockClient('{"done": true, "reason": "x"}');
    const result = await judgeGoal(client, { goal: 'g', lastResponse: '  ' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(false);
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('continues when no client is available', async () => {
    const result = await judgeGoal(null, { goal: 'g', lastResponse: 'r' });
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(false);
  });

  it('forwards the judge model override and temperature 0', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'r', model: 'qwen3:8b' });
    expect(client.chat).toHaveBeenCalledWith(
      [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: expect.stringContaining('Is the goal satisfied?') },
      ],
      [],
      { model: 'qwen3:8b', temperature: 0 }
    );
  });

  it('instructs the judge not to accept unsupported side-effect claims', () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain('unsupported assistant claims are NOT evidence');
    expect(JUDGE_SYSTEM_PROMPT).toContain('creating, editing, moving, deleting, reading, or verifying files');
    expect(JUDGE_SYSTEM_PROMPT).toContain('tool result');
    expect(JUDGE_SYSTEM_PROMPT).toContain('If a side-effect goal has no concrete evidence, return CONTINUE');
  });

  it('tells the judge evidence metadata is not exact-answer output text', () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain('internal evidence metadata');
    expect(JUDGE_SYSTEM_PROMPT).toContain('NOT part of the assistant');
    expect(JUDGE_SYSTEM_PROMPT).toContain('exact-answer goals');
    expect(JUDGE_SYSTEM_PROMPT).toContain('use the metadata and any following tool output');
  });

  it('delimits the response so prompt metadata is not exact-answer output', () => {
    const prompt = buildJudgeUserPrompt({
      goal: 'Respond exactly OK',
      lastResponse: '[tool evidence: none]\n\nOK',
    });

    expect(prompt).toContain('Text outside those tags is prompt metadata');
    expect(prompt).toContain('<response>\n[tool evidence: none]\n\nOK\n</response>');
    expect(prompt.indexOf('Current time:')).toBeLessThan(prompt.indexOf('<response>'));
    expect(prompt.indexOf('</response>')).toBeLessThan(prompt.indexOf('Is the goal satisfied?'));
  });

  it('keeps response delimiters when additional subgoal criteria are present', () => {
    const prompt = buildJudgeUserPrompt({
      goal: 'Create proof.txt',
      subgoals: ['read proof.txt back'],
      lastResponse: '[tool:view_file success]\nGOAL_FILE_OK',
    });

    expect(prompt).toContain('- 1. read proof.txt back');
    expect(prompt).toContain('<response>\n[tool:view_file success]\nGOAL_FILE_OK\n</response>');
    expect(prompt.indexOf('Current time:')).toBeLessThan(prompt.indexOf('<response>'));
    expect(prompt.indexOf('</response>')).toBeLessThan(
      prompt.indexOf('Decision: For each numbered criterion')
    );
  });

  it('forwards the per-call max token cap', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'r', maxTokens: 1234 });
    expect(client.chat.mock.calls[0]![2]).toEqual({ maxTokens: 1234, temperature: 0 });
  });

  it('omits the model option when none is configured', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(client.chat.mock.calls[0]![2]).toEqual({ temperature: 0 });
  });

  it('truncates long responses to the 4000-char snippet', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'x'.repeat(10_000) });
    const userPrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(userPrompt).toContain('… [truncated]');
    expect(userPrompt.length).toBeLessThan(5000);
  });

  it('records the judge call cost from response usage', async () => {
    const client = {
      chat: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: '{"done": false, "reason": "x"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 },
      }),
      getCurrentModel: vi.fn(() => 'gpt-5.5'),
    } as any;
    await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(recordUsageSpy).toHaveBeenCalledWith(120, 18, 'gpt-5.5');

    recordUsageSpy.mockClear();
    await judgeGoal(client, { goal: 'g', lastResponse: 'r', model: 'qwen3:8b' });
    expect(recordUsageSpy).toHaveBeenCalledWith(120, 18, 'qwen3:8b');
  });

  it('skips cost recording when the provider returns no usage', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, { goal: 'g', lastResponse: 'r' });
    expect(recordUsageSpy).not.toHaveBeenCalled();
  });

  it('switches to the with-subgoals template when subgoals exist', async () => {
    const client = mockClient('{"done": false, "reason": "x"}');
    await judgeGoal(client, {
      goal: 'g',
      lastResponse: 'r',
      subgoals: ['include a regression test'],
    });
    const userPrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(userPrompt).toContain('- 1. include a regression test');
    expect(userPrompt).toContain('every additional criterion satisfied?');
  });
});

describe('parseJudgeResponse', () => {
  it('flags mid-string truncated JSON as a parse failure (counts toward auto-pause)', () => {
    const result = parseJudgeResponse('{"done": true, "reason": "The agent successfully');
    expect(result.verdict).toBe('continue');
    expect(result.parseFailed).toBe(true);
  });

  it('defaults missing reason', () => {
    const result = parseJudgeResponse('{"done": false}');
    expect(result.reason).toBe('no reason provided');
  });

  it('accepts only explicit done values instead of arbitrary truthy JSON', () => {
    expect(parseJudgeResponse('{"done": true, "reason": "ok"}').verdict).toBe('done');
    expect(parseJudgeResponse('{"done": 1, "reason": "ok"}').verdict).toBe('done');
    expect(parseJudgeResponse('{"done": "yes", "reason": "ok"}').verdict).toBe('done');
    expect(parseJudgeResponse('{"done": false, "reason": "not yet"}').verdict).toBe('continue');
    expect(parseJudgeResponse('{"done": 0, "reason": "not yet"}').verdict).toBe('continue');
    expect(parseJudgeResponse('{"done": "no", "reason": "not yet"}').verdict).toBe('continue');
  });

  it('treats ambiguous done values as parse failures, not done', () => {
    for (const raw of [
      '{"done": {}, "reason": "object should not pass"}',
      '{"done": [], "reason": "array should not pass"}',
      '{"done": "maybe", "reason": "ambiguous"}',
      '{"reason": "missing done"}',
    ]) {
      const result = parseJudgeResponse(raw);
      expect(result.verdict).toBe('continue');
      expect(result.parseFailed).toBe(true);
    }
  });

  it('rejects JSON arrays as parse failures', () => {
    const result = parseJudgeResponse('[1, 2]');
    expect(result.parseFailed).toBe(true);
  });
});
