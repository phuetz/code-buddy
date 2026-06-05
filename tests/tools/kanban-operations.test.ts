import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KanbanStore } from '../../src/kanban/kanban-store.js';

describe('KanbanStore — assign / unlink / archive / stats (Hermes parity)', () => {
  let dir: string;
  let store: KanbanStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-ops-'));
    store = new KanbanStore({ rootDir: dir });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('assigns and clears a card assignee', async () => {
    const card = await store.createCard({ title: 'Task A' });
    const assigned = await store.assignCard(card.id, 'alice');
    expect(assigned.assignee).toBe('alice');
    expect(assigned.comments.some((c) => c.text.includes('Assigned to alice'))).toBe(true);

    const cleared = await store.assignCard(card.id, null);
    expect(cleared.assignee).toBeUndefined();
    expect(cleared.comments.some((c) => c.text === 'Unassigned')).toBe(true);
  });

  it('unlinks by link id and by target, and throws on unknown ref', async () => {
    const card = await store.createCard({ title: 'Task B' });
    const linked = await store.linkCard(card.id, 'https://example.test/pr/1', 'PR');
    const linkId = linked.links[0]!.id;

    const afterId = await store.unlinkCard(card.id, linkId);
    expect(afterId.links).toHaveLength(0);

    await store.linkCard(card.id, 'issue-42');
    const afterTarget = await store.unlinkCard(card.id, 'issue-42');
    expect(afterTarget.links).toHaveLength(0);

    await expect(store.unlinkCard(card.id, 'nope')).rejects.toThrow(/link not found/);
  });

  it('archives a card and hides it from default lists', async () => {
    const a = await store.createCard({ title: 'Keep' });
    const b = await store.createCard({ title: 'Archive me' });
    const archived = await store.archiveCard(b.id);
    expect(archived.status).toBe('archived');

    const visible = await store.listCards();
    expect(visible.map((c) => c.id)).toEqual([a.id]);

    const withArchived = await store.listCards({ includeArchived: true });
    expect(withArchived.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());

    const onlyArchived = await store.listCards({ status: 'archived' });
    expect(onlyArchived.map((c) => c.id)).toEqual([b.id]);
  });

  it('computes per-status / per-priority / per-assignee stats', async () => {
    const t1 = await store.createCard({ title: 'T1', priority: 'high', assignee: 'alice' });
    await store.createCard({ title: 'T2', priority: 'low' });
    const t3 = await store.createCard({ title: 'T3', assignee: 'alice' });
    await store.completeCard(t1.id);
    await store.blockCard(t3.id, 'waiting');

    const stats = await store.stats();
    expect(stats.total).toBe(3);
    expect(stats.byStatus.done).toBe(1);
    expect(stats.byStatus.blocked).toBe(1);
    expect(stats.byStatus.todo).toBe(1);
    expect(stats.byStatus.archived).toBe(0);
    expect(stats.byPriority.high).toBe(1);
    expect(stats.byPriority.low).toBe(1);
    expect(stats.byPriority.medium).toBe(1);
    expect(stats.byAssignee.alice).toBe(2);
    expect(stats.unassigned).toBe(1);
  });

  it('round-trips an archived status through persistence', async () => {
    const c = await store.createCard({ title: 'Persist' });
    await store.archiveCard(c.id);
    // New store instance reading the same board file.
    const reopened = new KanbanStore({ rootDir: dir });
    const shown = await reopened.showCard(c.id);
    expect(shown.status).toBe('archived');
  });
});
