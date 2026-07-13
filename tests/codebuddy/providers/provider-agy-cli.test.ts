import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{
    command: string;
    args: string[];
    options: { shell?: boolean; stdio?: string[] };
  }>,
  stdout: '',
  stderr: '',
  exitCode: 0 as number | null,
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn((command: string, args: string[], options: { shell?: boolean; stdio?: string[] }) => {
    state.calls.push({ command, args, options });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      killed: boolean;
      exitCode: number | null;
      kill: (signal?: string) => boolean;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.killed = false;
    child.exitCode = null;
    child.kill = () => {
      child.killed = true;
      return true;
    };
    setImmediate(() => {
      if (state.stdout) stdout.write(state.stdout);
      if (state.stderr) stderr.write(state.stderr);
      stdout.end();
      stderr.end();
      setImmediate(() => {
        child.exitCode = state.exitCode;
        child.emit('close', state.exitCode);
      });
    });
    return child;
  }),
}));

import {
  AgyCliProvider,
  formatMessagesForAgy,
} from '../../../src/codebuddy/providers/provider-agy-cli.js';

beforeEach(() => {
  state.calls.length = 0;
  state.stdout = '';
  state.stderr = '';
  state.exitCode = 0;
});

afterEach(() => vi.clearAllMocks());

describe('AgyCliProvider', () => {
  it('forces plan + sandbox and returns plain text', async () => {
    state.stdout = '\u001b[32mconseil vérifié\u001b[0m\n';
    const provider = new AgyCliProvider({
      binaryPath: '/fake/agy',
      model: 'Gemini 3.1 Pro (High)',
      defaultMaxTokens: 1024,
    });
    const result = await provider.chat([{ role: 'user', content: 'Analyse' }]);

    expect(result.choices[0]?.message.content).toBe('conseil vérifié');
    expect(result.usage).toBeUndefined();
    const call = state.calls[0];
    expect(call?.command).toBe('/fake/agy');
    expect(call?.args).toContain('--mode');
    expect(call?.args).toContain('plan');
    expect(call?.args).toContain('--sandbox');
    expect(call?.args).toContain('--model');
    expect(call?.args).toContain('Gemini 3.1 Pro (High)');
    expect(call?.args).not.toContain('--dangerously-skip-permissions');
    expect(call?.args).not.toContain('--json');
    expect(call?.options.shell).toBe(false);
  });

  it('per-call model overrides the default opaque display name', async () => {
    state.stdout = 'ok';
    const provider = new AgyCliProvider({
      binaryPath: '/fake/agy',
      model: 'Gemini 3.1 Pro (High)',
      defaultMaxTokens: 1024,
    });
    await provider.chat(
      [{ role: 'user', content: 'Analyse' }],
      undefined,
      { model: 'Claude Opus 4.6 (Thinking)' },
    );
    expect(state.calls[0]?.args).toContain('Claude Opus 4.6 (Thinking)');
  });

  it('maps a non-zero subprocess exit to a bounded error', async () => {
    state.exitCode = 1;
    state.stderr = 'quota unavailable';
    const provider = new AgyCliProvider({
      binaryPath: '/fake/agy',
      model: 'Gemini 3.1 Pro (High)',
      defaultMaxTokens: 1024,
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/quota unavailable/);
  });

  it('rejects runaway stdout', async () => {
    state.stdout = 'x'.repeat(10 * 1024 * 1024 + 1);
    const provider = new AgyCliProvider({
      binaryPath: '/fake/agy',
      model: 'Gemini 3.1 Pro (High)',
      defaultMaxTokens: 1024,
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/stdout exceeded/);
  });

  it('exposes stdout as a text stream and emits stop', async () => {
    state.stdout = 'réponse';
    const provider = new AgyCliProvider({
      binaryPath: '/fake/agy',
      model: 'Gemini 3.1 Pro (High)',
      defaultMaxTokens: 1024,
    });
    const chunks = [];
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'x' }])) {
      chunks.push(chunk);
    }
    expect(chunks.map((chunk) => chunk.choices[0]?.delta?.content ?? '').join(''))
      .toBe('réponse');
    expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe('stop');
  });
});

describe('formatMessagesForAgy', () => {
  it('preserves roles and injects the external-advisor boundary', () => {
    const prompt = formatMessagesForAgy([
      { role: 'system', content: 'Règles' },
      { role: 'user', content: 'Question' },
      { role: 'tool', tool_call_id: 't1', content: 'Résultat déjà contrôlé' },
    ]);
    expect(prompt).toContain('Code Buddy is the sole tool executor');
    expect(prompt).toContain('# System\nRègles');
    expect(prompt).toContain('# User\nQuestion');
    expect(prompt).toContain('# Tool result supplied by Code Buddy');
  });
});
