import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  runBackgroundReview,
  shouldTriggerBackgroundReview,
  guardReviewWrite,
  BACKGROUND_REVIEW_SENTINEL_ENV,
  BACKGROUND_REVIEW_ALLOW_USER_MEMORY_ENV,
  type BackgroundReviewClient,
  type ReviewChatMessage,
  type ReviewChatResponse,
} from '../../../src/agent/learning/background-review-agent.js';
import { listSkillWriteAudit } from '../../../src/agent/learning/skill-background-writes.js';
import type { HeadlessToolResult } from '../../../src/cloud/headless-tool-executor.js';

const SECRET = 'api_key=sk-abcdef0123456789abcd';
const WRITE_SKILLS = 'CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS';

const TOOLS = [
  { function: { name: 'remember' } },
  { function: { name: 'skill_manage' } },
  { function: { name: 'write_file' } },
  { function: { name: 'bash' } },
];

/** A scripted client that records the tool array it is handed each turn. */
function scriptedClient(turns: ReviewChatMessage[]): BackgroundReviewClient & {
  seenToolNames: string[];
  chatCalls: number;
} {
  const state = { seenToolNames: [] as string[], chatCalls: 0 };
  return {
    seenToolNames: state.seenToolNames,
    get chatCalls() {
      return state.chatCalls;
    },
    async chat(_messages, tools): Promise<ReviewChatResponse> {
      for (const tool of tools as Array<{ function?: { name?: string } }>) {
        state.seenToolNames.push(tool.function?.name ?? '');
      }
      const message = turns[state.chatCalls] ?? { role: 'assistant', content: 'done' };
      state.chatCalls++;
      return { choices: [{ message }] };
    },
    getCurrentModel: () => 'test-model',
  };
}

let savedSentinel: string | undefined;
let savedAllowUserMemory: string | undefined;

describe('background review agent (S4)', () => {
  beforeEach(() => {
    savedSentinel = process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    savedAllowUserMemory = process.env[BACKGROUND_REVIEW_ALLOW_USER_MEMORY_ENV];
    delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    delete process.env[BACKGROUND_REVIEW_ALLOW_USER_MEMORY_ENV];
  });

  afterEach(() => {
    if (savedSentinel === undefined) delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    else process.env[BACKGROUND_REVIEW_SENTINEL_ENV] = savedSentinel;
    if (savedAllowUserMemory === undefined) delete process.env[BACKGROUND_REVIEW_ALLOW_USER_MEMORY_ENV];
    else process.env[BACKGROUND_REVIEW_ALLOW_USER_MEMORY_ENV] = savedAllowUserMemory;
  });

  it('exposes only the allowed tools to the model and blocks disallowed tool calls', async () => {
    const client = scriptedClient([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', function: { name: 'remember', arguments: '{"content":"prefers French"}' } },
          { id: 'c2', function: { name: 'write_file', arguments: '{"path":"/etc/passwd"}' } },
        ],
      },
      { role: 'assistant', content: 'done' },
    ]);
    const executeTool = vi.fn(
      async (): Promise<HeadlessToolResult> => ({ success: true, output: 'ok' }),
    );

    const result = await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'please answer in French from now on' }],
      mode: 'combined',
      tools: TOOLS,
      executeTool,
    });

    // The model only ever saw the allowed tools.
    expect(new Set(client.seenToolNames)).toEqual(new Set(['remember', 'skill_manage']));
    // The disallowed tool was blocked, never executed.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0]?.[0]).toBe('remember');
    expect(result.blockedToolAttempts).toEqual(['write_file']);
    expect(result.toolCallsMade).toEqual([{ name: 'remember', success: true }]);
    expect(result.summary).toContain('Memory updated');
    expect(result.skipped).toBe(false);
    expect(result.rounds).toBe(2);
  });

  it('keeps autonomous remember calls project-scoped even if the model asks for user scope', async () => {
    const client = scriptedClient([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            function: {
              name: 'remember',
              arguments: '{"key":"team-pref","value":"prefers French","scope":"user"}',
            },
          },
        ],
      },
      { role: 'assistant', content: 'done' },
    ]);
    const executeTool = vi.fn(async (): Promise<HeadlessToolResult> => ({ success: true }));

    await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'please keep notes for this repo' }],
      mode: 'memory',
      tools: TOOLS,
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    const args = JSON.parse(String(executeTool.mock.calls[0]?.[1]));
    expect(args).toMatchObject({ key: 'team-pref', value: 'prefers French', scope: 'project' });
  });

  it('allows user-scope autonomous memory only behind the explicit operator flag', async () => {
    process.env[BACKGROUND_REVIEW_ALLOW_USER_MEMORY_ENV] = 'true';
    const client = scriptedClient([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            function: {
              name: 'remember',
              arguments: '{"key":"global-pref","value":"prefers concise output","scope":"user"}',
            },
          },
        ],
      },
      { role: 'assistant', content: 'done' },
    ]);
    const executeTool = vi.fn(async (): Promise<HeadlessToolResult> => ({ success: true }));

    await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'please remember my style everywhere' }],
      mode: 'memory',
      tools: TOOLS,
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    const args = JSON.parse(String(executeTool.mock.calls[0]?.[1]));
    expect(args).toMatchObject({ key: 'global-pref', value: 'prefers concise output', scope: 'user' });
  });

  it('no-ops when a review is already in progress (recursion guard)', async () => {
    process.env[BACKGROUND_REVIEW_SENTINEL_ENV] = '1';
    const client = scriptedClient([{ role: 'assistant', content: 'should not run' }]);
    const executeTool = vi.fn(async (): Promise<HeadlessToolResult> => ({ success: true }));

    const result = await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'hi' }],
      mode: 'combined',
      tools: TOOLS,
      executeTool,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('nested review suppressed');
    expect(client.chatCalls).toBe(0);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('restores the sentinel after the run so later reviews are not suppressed', async () => {
    const client = scriptedClient([{ role: 'assistant', content: 'done' }]);
    expect(process.env[BACKGROUND_REVIEW_SENTINEL_ENV]).toBeUndefined();

    await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'hi' }],
      mode: 'memory',
      tools: TOOLS,
      executeTool: async () => ({ success: true }),
    });

    expect(process.env[BACKGROUND_REVIEW_SENTINEL_ENV]).toBeUndefined();
  });
});

describe('shouldTriggerBackgroundReview (S5 — interactive-only gating)', () => {
  const base = {
    interactiveOptIn: true,
    envFlag: 'true',
    sentinel: undefined as string | undefined,
    transcriptLength: 3,
  };

  it('fires for an interactive session with the flag on and content to review', () => {
    expect(shouldTriggerBackgroundReview(base)).toBe(true);
  });

  it('never fires for a non-interactive (cron/headless/sub-agent) construction', () => {
    expect(shouldTriggerBackgroundReview({ ...base, interactiveOptIn: false })).toBe(false);
  });

  it('does not fire when the env flag is off/unset', () => {
    expect(shouldTriggerBackgroundReview({ ...base, envFlag: undefined })).toBe(false);
    expect(shouldTriggerBackgroundReview({ ...base, envFlag: 'false' })).toBe(false);
  });

  it('does not fire while already inside a review (recursion guard via sentinel)', () => {
    expect(shouldTriggerBackgroundReview({ ...base, sentinel: '1' })).toBe(false);
  });

  it('does not fire with an empty transcript', () => {
    expect(shouldTriggerBackgroundReview({ ...base, transcriptLength: 0 })).toBe(false);
  });
});

describe('reversible-net guard on the live review loop (option A)', () => {
  let savedSentinel: string | undefined;
  let savedWriteSkills: string | undefined;

  beforeEach(() => {
    savedSentinel = process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    savedWriteSkills = process.env[WRITE_SKILLS];
    delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    delete process.env[WRITE_SKILLS];
  });

  afterEach(() => {
    if (savedSentinel === undefined) delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    else process.env[BACKGROUND_REVIEW_SENTINEL_ENV] = savedSentinel;
    if (savedWriteSkills === undefined) delete process.env[WRITE_SKILLS];
    else process.env[WRITE_SKILLS] = savedWriteSkills;
  });

  it('gates skill mutations on the autonomous-skill-write flag', () => {
    const call = { action: 'create', name: 'demo', content: 'a reusable skill body' };
    expect(guardReviewWrite('skill_manage', call)).toMatchObject({ allowed: false });
    process.env[WRITE_SKILLS] = 'true';
    expect(guardReviewWrite('skill_manage', call)).toEqual({ allowed: true });
  });

  it('screens any write (skill or memory) for secrets/omissions', () => {
    process.env[WRITE_SKILLS] = 'true';
    expect(guardReviewWrite('remember', { content: SECRET })).toMatchObject({ allowed: false });
    expect(
      guardReviewWrite('skill_manage', { action: 'edit', name: 'd', content: SECRET }),
    ).toMatchObject({ allowed: false });
    // A clean memory write passes.
    expect(guardReviewWrite('remember', { content: 'the user prefers French' })).toEqual({ allowed: true });
  });

  it('refuses an ungated skill create in the live loop (never executed, nothing audited)', async () => {
    const client = scriptedClient([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', function: { name: 'skill_manage', arguments: '{"action":"create","name":"demo","content":"body"}' } },
        ],
      },
      { role: 'assistant', content: 'done' },
    ]);
    const executeTool = vi.fn(async (): Promise<HeadlessToolResult> => ({ success: true, output: 'ok' }));

    const result = await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'do a thing' }],
      mode: 'skill',
      tools: TOOLS,
      executeTool,
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.screenedWrites).toEqual([
      { name: 'skill_manage', reason: expect.stringContaining('disabled') },
    ]);
  });

  it('executes and audits a gated, clean skill create in the live loop', async () => {
    process.env[WRITE_SKILLS] = 'true';
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-audit-'));
    try {
      const client = scriptedClient([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'c1', function: { name: 'skill_manage', arguments: '{"action":"create","name":"demo-skill","content":"a clean reusable skill body"}' } },
          ],
        },
        { role: 'assistant', content: 'done' },
      ]);
      const executeTool = vi.fn(async (): Promise<HeadlessToolResult> => ({ success: true, output: 'installed' }));

      const result = await runBackgroundReview({
        client,
        transcript: [{ role: 'user', content: 'do a thing' }],
        mode: 'skill',
        tools: TOOLS,
        executeTool,
        workDir,
      });

      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(result.screenedWrites).toEqual([]);
      const audit = listSkillWriteAudit(workDir);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ skillName: 'demo-skill', reviewer: 'auto:gate-passed' });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });
});
