import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplayCommand } from '../../src/commands/replay.js';
import { CheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import { SessionFacade } from '../../src/agent/facades/session-facade.js';
import { SessionStore, type Session } from '../../src/persistence/session-store.js';
import { SessionTimeline } from '../../src/sessions/timeline.js';

describe('buddy replay', () => {
  let tempDir: string;
  let timeline: SessionTimeline;
  let store: SessionStore;
  let facade: SessionFacade;
  let source: Session;
  let previousSessionsDir: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-replay-'));
    previousSessionsDir = process.env.CODEBUDDY_SESSIONS_DIR;
    process.env.CODEBUDDY_SESSIONS_DIR = path.join(tempDir, 'sessions');
    timeline = new SessionTimeline('source-session', {
      directory: path.join(tempDir, 'timelines'),
    });
    store = new SessionStore({ useSQLite: false });
    facade = new SessionFacade({
      checkpointManager: new CheckpointManager(),
      sessionStore: store,
    });
    source = {
      id: 'source-session',
      name: 'Source session',
      workingDirectory: tempDir,
      model: 'test-model',
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      lastAccessedAt: new Date('2026-01-01T10:02:00.000Z'),
      messages: [
        { type: 'user', content: 'first question', timestamp: '2026-01-01T10:00:00.000Z' },
        { type: 'assistant', content: 'first answer', timestamp: '2026-01-01T10:00:01.000Z' },
        { type: 'user', content: 'second question', timestamp: '2026-01-01T10:01:00.000Z' },
        { type: 'assistant', content: 'second answer', timestamp: '2026-01-01T10:01:01.000Z' },
      ],
    };
    await store.saveSession(source);
    await timeline.record({
      turn: 1,
      ts: '2026-01-01T10:00:02.000Z',
      role: 'assistant',
      textPreview: 'first answer',
      toolCalls: [{ name: 'write_file', ok: true }],
      filesTouched: ['src/first.ts'],
      checkpointId: 'cp-turn-1',
    });
    await timeline.record({
      turn: 2,
      ts: '2026-01-01T10:01:02.000Z',
      role: 'assistant',
      textPreview: 'second answer',
      toolCalls: [],
      filesTouched: [],
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
    if (previousSessionsDir === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previousSessionsDir;
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function output(): string {
    return logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  it('lists timeline turns as a table with previews, tools, and files', async () => {
    await createReplayCommand({ timeline })
      .exitOverride()
      .parseAsync(['node', 'replay', source.id]);

    expect(output()).toContain('turn');
    expect(output()).toContain('first answer');
    expect(output()).toContain('write_file:ok');
    expect(output()).toContain('src/first.ts');
    expect(output()).toContain('second answer');
  });

  it('shows --at state and restores its checkpoint only after confirmation', async () => {
    const rewindTo = vi.fn().mockReturnValue({
      success: true,
      restored: ['src/first.ts'],
      errors: [],
    });
    const confirm = vi.fn().mockResolvedValue(true);

    await createReplayCommand({ timeline, checkpointManager: { rewindTo }, confirm })
      .exitOverride()
      .parseAsync(['node', 'replay', source.id, '--at', '1']);

    expect(output()).toContain('Turn 1');
    expect(output()).toContain('Checkpoint: cp-turn-1');
    expect(confirm).toHaveBeenCalledOnce();
    expect(rewindTo).toHaveBeenCalledWith('cp-turn-1');
  });

  it('supports --yes while never restoring a declined checkpoint', async () => {
    const rewindTo = vi.fn().mockReturnValue({ success: true, restored: [], errors: [] });
    const confirm = vi.fn().mockResolvedValue(false);

    await createReplayCommand({ timeline, checkpointManager: { rewindTo }, confirm })
      .exitOverride()
      .parseAsync(['node', 'replay', source.id, '--at', '1']);
    expect(rewindTo).not.toHaveBeenCalled();

    logSpy.mockClear();
    await createReplayCommand({ timeline, checkpointManager: { rewindTo }, confirm })
      .exitOverride()
      .parseAsync(['node', 'replay', source.id, '--at', '1', '--yes']);
    expect(rewindTo).toHaveBeenCalledWith('cp-turn-1');
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('forks a loadable canonical session through the selected turn', async () => {
    const rewindTo = vi.fn();
    const confirm = vi.fn();

    await createReplayCommand({
      timeline,
      sessionFacade: facade,
      checkpointManager: { rewindTo },
      confirm,
    })
      .exitOverride()
      .parseAsync([
        'node',
        'replay',
        source.id,
        '--at',
        '1',
        '--fork',
        'forked-session',
      ]);

    const forked = await facade.loadSession('forked-session');
    expect(forked?.messages.map((message) => message.content)).toEqual([
      'first question',
      'first answer',
    ]);
    expect(forked?.metadata).toMatchObject({
      parentSessionId: source.id,
      forkedAtTurn: 1,
    });
    expect((await facade.loadSession(source.id))?.messages).toHaveLength(4);
    expect(rewindTo).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
