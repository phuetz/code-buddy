import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  KanbanBoardRegistry,
  DEFAULT_BOARD_SLUG,
  isValidBoardSlug,
} from '../../src/kanban/kanban-board-registry.js';
import { KanbanStore } from '../../src/kanban/kanban-store.js';

describe('KanbanBoardRegistry (multi-board)', () => {
  let dir: string;
  let registry: KanbanBoardRegistry;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-boards-'));
    registry = new KanbanBoardRegistry({ rootDir: dir, env: {} });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('always exposes a default board and resolves to it initially', () => {
    expect(registry.resolveSlug()).toBe(DEFAULT_BOARD_SLUG);
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slug: 'default', current: true });
  });

  it('maps default to the legacy board path and others to kanban/<slug>.json', () => {
    expect(registry.boardPath('default')).toBe(path.join(dir, '.codebuddy', 'kanban-board.json'));
    expect(registry.boardPath('work')).toBe(path.join(dir, '.codebuddy', 'kanban', 'work.json'));
  });

  it('creates a board, switches to it, and isolates cards per board', async () => {
    const board = registry.create('work', 'Work');
    expect(board).toMatchObject({ slug: 'work', name: 'Work', current: true });
    expect(registry.resolveSlug()).toBe('work');

    // Cards written to the active board do not leak into default.
    const workStore = new KanbanStore({ boardPath: registry.boardPath('work') });
    await workStore.createCard({ title: 'Work task' });
    const defaultStore = new KanbanStore({ boardPath: registry.boardPath('default') });
    await defaultStore.createCard({ title: 'Default task' });

    expect((await workStore.listCards())).toHaveLength(1);
    expect((await defaultStore.listCards())).toHaveLength(1);

    const list = registry.list();
    expect(list.find((b) => b.slug === 'work')?.cardCount).toBe(1);
    expect(list.find((b) => b.slug === 'default')?.cardCount).toBe(1);
  });

  it('honours the explicit → env → current → default resolution precedence', () => {
    registry.create('work');
    // current is now 'work'
    expect(registry.resolveSlug()).toBe('work');
    // explicit wins
    expect(registry.resolveSlug('default')).toBe('default');
    // env wins over current
    const envRegistry = new KanbanBoardRegistry({ rootDir: dir, env: { CODEBUDDY_KANBAN_BOARD: 'default' } });
    expect(envRegistry.resolveSlug()).toBe('default');
    // explicit still beats env
    expect(envRegistry.resolveSlug('work')).toBe('work');
  });

  it('archives a board (hidden, resolves to default) and can hard-delete it', () => {
    registry.create('temp');
    expect(fs.existsSync(registry.boardPath('temp'))).toBe(true);

    registry.remove('temp'); // archive
    expect(registry.list().some((b) => b.slug === 'temp')).toBe(false);
    expect(registry.list(true).find((b) => b.slug === 'temp')?.archived).toBe(true);
    expect(registry.resolveSlug()).toBe('default'); // active reset after removing current

    // Re-create revives the archived board (same file).
    registry.create('temp');
    expect(registry.list().some((b) => b.slug === 'temp')).toBe(true);

    registry.remove('temp', { hardDelete: true });
    expect(fs.existsSync(registry.boardPath('temp'))).toBe(false);
    expect(registry.list(true).some((b) => b.slug === 'temp')).toBe(false);
  });

  it('refuses to remove the default board and rejects invalid slugs', () => {
    expect(() => registry.remove('default')).toThrow(/default board cannot be removed/);
    expect(() => registry.create('Bad Slug!')).toThrow(/invalid board slug/);
    expect(isValidBoardSlug('good-slug-1')).toBe(true);
    expect(isValidBoardSlug('Bad')).toBe(false);
  });

  it('rejects creating a board that already exists', () => {
    registry.create('dup');
    expect(() => registry.create('dup')).toThrow(/already exists/);
  });
});
