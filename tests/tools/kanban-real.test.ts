import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { KanbanStore, type KanbanBoard } from '../../src/kanban/kanban-store.js';
import { createKanbanTools } from '../../src/tools/registry/kanban-tools.js';

let tempWorkspace: string;
let originalCwd: string;
let idCounter: number;

function nextId(): string {
  idCounter += 1;
  return `test-id-${idCounter}`;
}

function fixedNow(): Date {
  return new Date('2026-05-30T12:00:00.000Z');
}

async function readBoard(rootDir: string): Promise<KanbanBoard> {
  const raw = await fs.readFile(path.join(rootDir, '.codebuddy', 'kanban-board.json'), 'utf8');
  return JSON.parse(raw) as KanbanBoard;
}

function parseToolOutput(result: { success: boolean; output?: string; error?: string }): Record<string, unknown> {
  expect(result.success, result.error).toBe(true);
  expect(result.output).toBeTruthy();
  return JSON.parse(result.output as string) as Record<string, unknown>;
}

describe('Hermes Kanban real workspace integration', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-kanban-real-'));
    idCounter = 0;
    process.chdir(tempWorkspace);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('persists the Hermes kanban lifecycle on disk', async () => {
    const store = new KanbanStore({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: nextId,
    });

    const created = await store.createCard({
      title: 'Implement Hermes Kanban',
      description: 'Close the official kanban_* gap.',
      priority: 'high',
      assignee: 'codex',
      tags: ['hermes', 'parity', 'hermes'],
    });
    expect(created.id).toBe('kb-implement-hermes-kanban-testid1');
    expect(created.tags).toEqual(['hermes', 'parity']);

    await store.heartbeatCard(created.id, 'Started real store integration', 'codex');
    await store.blockCard(created.id, 'Need official tool name parity', 'codex');
    await store.unblockCard(created.id, 'Tool names confirmed', 'codex');
    await store.linkCard(created.id, 'src/tools/registry/kanban-tools.ts', 'registry adapter');
    await store.commentCard(created.id, 'Verified with real file reads', 'codex');
    const completed = await store.completeCard(created.id, 'Ready for parity manifest update', 'codex');

    expect(completed.status).toBe('done');
    expect(completed.blockedReason).toBeUndefined();
    expect(completed.completedAt).toBe('2026-05-30T12:00:00.000Z');

    const board = await readBoard(tempWorkspace);
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]).toEqual(
      expect.objectContaining({
        id: created.id,
        status: 'done',
        priority: 'high',
        assignee: 'codex',
      }),
    );
    expect(board.cards[0]?.comments.map((comment) => comment.text)).toEqual([
      'Blocked: Need official tool name parity',
      'Tool names confirmed',
      'Verified with real file reads',
      'Ready for parity manifest update',
    ]);
    expect(board.cards[0]?.heartbeats).toEqual([
      expect.objectContaining({ message: 'Started real store integration', author: 'codex' }),
    ]);
    expect(board.cards[0]?.links).toEqual([
      expect.objectContaining({ target: 'src/tools/registry/kanban-tools.ts', label: 'registry adapter' }),
    ]);
  });

  it('exposes the official kanban_* tool names against a real workspace board', async () => {
    const tools = createKanbanTools({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: nextId,
    });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      'kanban_show',
      'kanban_list',
      'kanban_complete',
      'kanban_block',
      'kanban_heartbeat',
      'kanban_comment',
      'kanban_create',
      'kanban_link',
      'kanban_unblock',
    ]) {
      expect(byName.has(name)).toBe(true);
    }

    const created = parseToolOutput(await byName.get('kanban_create')!.execute({
      title: 'Exercise tool adapters',
      priority: 'urgent',
      tags: ['real', 'kanban'],
    }));
    const cardId = ((created.card as Record<string, unknown>).id as string);

    parseToolOutput(await byName.get('kanban_heartbeat')!.execute({
      id: cardId,
      message: 'Running through ITool adapter',
      author: 'test',
    }));
    parseToolOutput(await byName.get('kanban_block')!.execute({
      id: cardId,
      reason: 'Adapter block path',
      author: 'test',
    }));
    parseToolOutput(await byName.get('kanban_unblock')!.execute({
      id: cardId,
      comment: 'Adapter unblock path',
      author: 'test',
    }));
    parseToolOutput(await byName.get('kanban_link')!.execute({
      id: cardId,
      target: 'commit:abcdef',
      label: 'test commit',
    }));
    const completed = parseToolOutput(await byName.get('kanban_complete')!.execute({
      id: cardId,
      comment: 'Adapter complete path',
      author: 'test',
    }));

    expect((completed.card as Record<string, unknown>).status).toBe('done');

    const listed = parseToolOutput(await byName.get('kanban_list')!.execute({ include_done: true }));
    expect(listed.count).toBe(1);
    // Unified board: the kanban_* tools now drive the shared fleet queue
    // (colab-tasks.json) the autonomous daemon claims from, not a separate
    // kanban-board.json. This is the parity-gap closure.
    expect(listed.boardPath).toBe(path.join(tempWorkspace, '.codebuddy', 'colab-tasks.json'));

    const shown = parseToolOutput(await byName.get('kanban_show')!.execute({ id: cardId }));
    expect((shown.card as Record<string, unknown>).id).toBe(cardId);

    await expect(fs.stat(path.join(tempWorkspace, '.codebuddy', 'colab-tasks.json'))).resolves.toBeTruthy();
  });

  it('marks official Hermes kanban tools as exact local tool parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T12:00:00.000Z');
    for (const name of [
      'kanban_show',
      'kanban_list',
      'kanban_complete',
      'kanban_block',
      'kanban_heartbeat',
      'kanban_comment',
      'kanban_create',
      'kanban_link',
      'kanban_unblock',
    ]) {
      expect(manifest.tools).toContainEqual(expect.objectContaining({
        name,
        status: 'exact',
        detectedCodeBuddyTools: [name],
      }));
    }
  });
});
