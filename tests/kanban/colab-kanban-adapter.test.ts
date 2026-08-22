import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ColabKanbanAdapter, importKanbanCards } from '../../src/kanban/colab-kanban-adapter';
import { FleetColabStore } from '../../src/fleet/colab-store';
import { KanbanStore } from '../../src/kanban/kanban-store';

/**
 * The unification seam: kanban_* tools (via this adapter) and the autonomous
 * daemon (via FleetColabStore) must drive ONE board. These tests prove a card
 * created through the adapter is the same task the daemon claims, and that the
 * urgent->critical mapping preserves the auto-claim safety guard.
 */
describe('ColabKanbanAdapter (unified kanban board)', () => {
  let dir: string;

  function colab(): FleetColabStore {
    return new FleetColabStore({ dir: join(dir, '.codebuddy') });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'colab-kanban-adapter-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('writes to the shared fleet board so the daemon can claim what a tool created', async () => {
    const adapter = new ColabKanbanAdapter({ rootDir: dir });
    const card = await adapter.createCard({ title: 'Shared work', priority: 'high' });
    expect(card.status).toBe('todo');

    // Same board, read through the daemon's store.
    const tasks = colab().listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Shared work', priority: 'high', status: 'open' });
    expect(colab().nextClaimable()?.id).toBe(card.id); // the daemon would claim it
  });

  it('maps urgent -> critical and preserves the auto-claim safety guard', async () => {
    const adapter = new ColabKanbanAdapter({ rootDir: dir });
    await adapter.createCard({ title: 'Urgent thing', priority: 'urgent' });

    const task = colab().listTasks().find((t) => t.title === 'Urgent thing');
    expect(task?.priority).toBe('critical');
    expect(colab().isAutoClaimable(task!)).toBe(false); // critical is never auto-claimed
    expect(colab().nextClaimable()).toBeNull(); // the daemon leaves it for a human

    // …but the tool surface still shows it as 'urgent'.
    const cards = await adapter.listCards();
    expect(cards.find((c) => c.title === 'Urgent thing')?.priority).toBe('urgent');
  });

  it('round-trips the kanban lifecycle through the colab store', async () => {
    const adapter = new ColabKanbanAdapter({ rootDir: dir });
    const created = await adapter.createCard({ title: 'Lifecycle', tags: ['a', 'b', 'a'] });
    expect(created.tags).toEqual(['a', 'b']);

    const beat = await adapter.heartbeatCard(created.id, 'working', 'alice');
    expect(beat.status).toBe('in_progress'); // todo -> in_progress on heartbeat
    expect(beat.heartbeats).toHaveLength(1);

    const blocked = await adapter.blockCard(created.id, 'waiting on review', 'alice');
    expect(blocked.status).toBe('blocked');
    expect(blocked.comments.some((c) => c.text === 'Blocked: waiting on review')).toBe(true);

    const unblocked = await adapter.unblockCard(created.id, 'review done', 'alice');
    expect(unblocked.status).toBe('in_progress');
    expect(unblocked.blockedReason).toBeUndefined();

    const linked = await adapter.linkCard(created.id, 'commit:abcdef', 'fix commit');
    expect(linked.links).toEqual([
      expect.objectContaining({ target: 'commit:abcdef', label: 'fix commit' }),
    ]);
    // Free-form link is NOT a DAG edge.
    expect(colab().getTask(created.id)?.dependsOn).toBeUndefined();

    const done = await adapter.completeCard(created.id, 'shipped', 'alice');
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeTruthy();
  });

  it('list filters honour include_done and tags', async () => {
    const adapter = new ColabKanbanAdapter({ rootDir: dir });
    const a = await adapter.createCard({ title: 'A', tags: ['keep'] });
    await adapter.createCard({ title: 'B' });
    await adapter.completeCard(a.id);

    expect((await adapter.listCards({ includeDone: false })).map((c) => c.title)).toEqual(['B']);
    expect((await adapter.listCards({ tag: 'keep' })).map((c) => c.title)).toEqual(['A']);
  });

  describe('importKanbanCards (migrate a legacy board)', () => {
    it('migrates cards into the unified board, mapping status/priority, skipping archived; idempotent', async () => {
      // Seed a legacy kanban-board.json via KanbanStore.
      const legacy = new KanbanStore({ rootDir: dir });
      const urgent = await legacy.createCard({ title: 'Urgent legacy', priority: 'urgent', tags: ['x'] });
      await legacy.commentCard(urgent.id, 'a note', 'bob');
      await legacy.linkCard(urgent.id, 'pr:7', 'the PR');
      const done = await legacy.createCard({ title: 'Done legacy' });
      await legacy.completeCard(done.id);
      const arch = await legacy.createCard({ title: 'Archived legacy' });
      await legacy.archiveCard(arch.id);

      const cards = await legacy.listCards({ includeArchived: true, includeDone: true });
      const store = colab();
      const { imported, skipped } = importKanbanCards(cards, store);

      expect(imported.sort()).toEqual([done.id, urgent.id].sort());
      expect(skipped).toEqual([arch.id]); // archived is skipped

      const migrated = store.getTask(urgent.id);
      expect(migrated?.priority).toBe('critical'); // urgent -> critical
      expect(migrated?.tags).toEqual(['x']);
      expect(migrated?.comments?.[0]?.text).toBe('a note');
      expect(migrated?.links?.[0]?.target).toBe('pr:7');
      expect(store.getTask(done.id)?.status).toBe('completed'); // done -> completed

      // Idempotent: a second import skips everything.
      const second = importKanbanCards(cards, store);
      expect(second.imported).toEqual([]);
    });
  });
});
