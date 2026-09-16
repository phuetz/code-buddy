import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplayCommand } from '../../src/commands/replay.js';
import { SessionStore } from '../../src/persistence/session-store.js';
import { SessionFacade } from '../../src/agent/facades/session-facade.js';
import { CheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import { SessionTimeline } from '../../src/sessions/timeline.js';
import { captureAndSaveTimelineSnapshot } from '../../src/sessions/timeline-snapshot.js';

describe('GK29 time-travel restore', () => {
  let tempDir: string;
  let repo: string;
  let previousHome: string | undefined;
  let previousSessionsDir: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk29-timeline-'));
    repo = path.join(tempDir, 'toy');
    fs.mkdirSync(repo);
    previousHome = process.env.HOME;
    previousSessionsDir = process.env.CODEBUDDY_SESSIONS_DIR;
    process.env.HOME = path.join(tempDir, 'home');
    process.env.CODEBUDDY_SESSIONS_DIR = path.join(tempDir, 'home', '.codebuddy', 'sessions');
    fs.mkdirSync(process.env.CODEBUDDY_SESSIONS_DIR, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousSessionsDir === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previousSessionsDir;
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('restores the exact working tree of turn 1 after two later turns, including deleting later files', async () => {
    const timelineDir = path.join(tempDir, 'home', '.codebuddy', 'timelines');
    const timeline = new SessionTimeline('gk29-session', { directory: timelineDir });
    const store = new SessionStore({ useSQLite: false });
    const facade = new SessionFacade({
      checkpointManager: new CheckpointManager(),
      sessionStore: store,
    });
    await store.saveSession({
      id: 'gk29-session',
      name: 'GK29 session',
      workingDirectory: repo,
      model: 'test-model',
      createdAt: new Date('2026-09-03T10:00:00.000Z'),
      lastAccessedAt: new Date('2026-09-03T10:03:00.000Z'),
      messages: [
        { type: 'user', content: 'turn 1', timestamp: '2026-09-03T10:00:00.000Z' },
        { type: 'assistant', content: 'wrote add', timestamp: '2026-09-03T10:00:01.000Z' },
        { type: 'user', content: 'turn 2', timestamp: '2026-09-03T10:01:00.000Z' },
        { type: 'assistant', content: 'wrote multiply', timestamp: '2026-09-03T10:01:01.000Z' },
        { type: 'user', content: 'turn 3', timestamp: '2026-09-03T10:02:00.000Z' },
        { type: 'assistant', content: 'broke add', timestamp: '2026-09-03T10:02:01.000Z' },
      ],
    });

    fs.writeFileSync(path.join(repo, 'sum.js'), 'export function add(a, b) { return a + b; }\n');
    const turn1 = captureAndSaveTimelineSnapshot({ sessionId: 'gk29-session', turn: 1, cwd: repo });
    await timeline.record({
      turn: 1,
      ts: '2026-09-03T10:00:02.000Z',
      role: 'assistant',
      textPreview: 'wrote add',
      toolCalls: [{ name: 'write_file', ok: true }],
      filesTouched: ['sum.js'],
      checkpointId: turn1.id,
    });

    fs.writeFileSync(path.join(repo, 'sum.js'), 'export function add(a, b) { return a + b; }\nexport function multiply(a, b) { return a * b; }\n');
    fs.writeFileSync(path.join(repo, 'product.js'), 'export const product = 42;\n');
    const turn2 = captureAndSaveTimelineSnapshot({ sessionId: 'gk29-session', turn: 2, cwd: repo });
    await timeline.record({
      turn: 2,
      ts: '2026-09-03T10:01:02.000Z',
      role: 'assistant',
      textPreview: 'wrote multiply',
      toolCalls: [{ name: 'write_file', ok: true }],
      filesTouched: ['sum.js', 'product.js'],
      checkpointId: turn2.id,
    });

    fs.writeFileSync(path.join(repo, 'sum.js'), 'export function add(a, b) { return a - b; }\n');
    const turn3 = captureAndSaveTimelineSnapshot({ sessionId: 'gk29-session', turn: 3, cwd: repo });
    await timeline.record({
      turn: 3,
      ts: '2026-09-03T10:02:02.000Z',
      role: 'assistant',
      textPreview: 'broke add',
      toolCalls: [{ name: 'str_replace', ok: true }],
      filesTouched: ['sum.js'],
      checkpointId: turn3.id,
    });

    await createReplayCommand({ timeline, sessionFacade: facade })
      .exitOverride()
      .parseAsync(['node', 'replay', 'gk29-session', '--at', '1', '--yes']);

    expect(fs.readFileSync(path.join(repo, 'sum.js'), 'utf8')).toBe(
      'export function add(a, b) { return a + b; }\n',
    );
    expect(fs.existsSync(path.join(repo, 'product.js'))).toBe(false);
  });
});
