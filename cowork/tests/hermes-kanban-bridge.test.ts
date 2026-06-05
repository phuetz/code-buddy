import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  archiveHermesKanbanCard,
  assignHermesKanbanCard,
  blockHermesKanbanCard,
  commentHermesKanbanCard,
  completeHermesKanbanCard,
  createHermesKanbanBoard,
  createHermesKanbanCard,
  linkHermesKanbanCard,
  listHermesKanbanBoards,
  listHermesKanbanCards,
  switchHermesKanbanBoard,
  unblockHermesKanbanCard,
  unlinkHermesKanbanCard,
} from '../src/main/tools/hermes-kanban-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

function makeStore() {
  const card = {
    id: 'card-1',
    title: 'Ship it',
    status: 'todo',
    priority: 'medium',
    tags: [],
    links: [],
    comments: [],
    heartbeats: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
  return {
    path: '/ws/.codebuddy/kanban-board.json',
    listCards: vi.fn().mockResolvedValue([card]),
    createCard: vi.fn().mockResolvedValue(card),
    completeCard: vi.fn().mockResolvedValue({ ...card, status: 'done' }),
    blockCard: vi.fn().mockResolvedValue({ ...card, status: 'blocked', blockedReason: 'waiting' }),
    unblockCard: vi.fn().mockResolvedValue({ ...card, status: 'todo' }),
    commentCard: vi.fn().mockResolvedValue(card),
    linkCard: vi.fn().mockResolvedValue(card),
    unlinkCard: vi.fn().mockResolvedValue({ ...card, links: [] }),
    assignCard: vi.fn().mockResolvedValue({ ...card, assignee: 'alice' }),
    archiveCard: vi.fn().mockResolvedValue({ ...card, status: 'archived' }),
  };
}

function makeRegistry() {
  const board = { slug: 'work', name: 'Work', createdAt: 'now', archived: false, current: true, cardCount: 0, path: '/ws/.codebuddy/kanban/work.json' };
  return {
    resolveSlug: vi.fn().mockReturnValue('default'),
    boardPath: vi.fn().mockReturnValue('/ws/.codebuddy/kanban-board.json'),
    list: vi.fn().mockReturnValue([
      { slug: 'default', name: 'Default', createdAt: 'now', archived: false, current: true, cardCount: 2, path: '/ws/.codebuddy/kanban-board.json' },
    ]),
    create: vi.fn().mockReturnValue(board),
    switch: vi.fn().mockReturnValue({ ...board, current: true }),
  };
}

let store: ReturnType<typeof makeStore>;
let registry: ReturnType<typeof makeRegistry>;
let KanbanStore: ReturnType<typeof vi.fn>;
let KanbanBoardRegistry: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
  store = makeStore();
  registry = makeRegistry();
  // Use normal functions (not arrows) so they are constructable with `new`.
  KanbanStore = vi.fn().mockImplementation(function (this: unknown) {
    return store;
  });
  KanbanBoardRegistry = vi.fn().mockImplementation(function (this: unknown) {
    return registry;
  });
  // Dispatch by module path: store vs board registry.
  mockedLoadCoreModule.mockImplementation(async (relativePath: string) =>
    relativePath.includes('kanban-board-registry') ? { KanbanBoardRegistry } : { KanbanStore },
  );
});

describe('Hermes kanban bridge', () => {
  it('builds the store rooted at the provided workspace cwd', async () => {
    await listHermesKanbanCards({ cwd: '/ws', filter: { includeDone: true } });
    // The active board is resolved through the registry (rooted at the cwd),
    // and the store opens the resolved board file.
    expect(KanbanBoardRegistry).toHaveBeenCalledWith({ rootDir: '/ws' });
    expect(KanbanStore).toHaveBeenCalledWith({ boardPath: '/ws/.codebuddy/kanban-board.json' });
    expect(store.listCards).toHaveBeenCalledWith({ includeDone: true });
  });

  it('creates, completes, blocks, unblocks, comments, and links cards', async () => {
    expect((await createHermesKanbanCard({ cwd: '/ws', input: { title: 'Ship it' } }))?.id).toBe('card-1');
    expect((await completeHermesKanbanCard({ cwd: '/ws', id: 'card-1' }))?.status).toBe('done');
    expect((await blockHermesKanbanCard({ cwd: '/ws', id: 'card-1', reason: 'waiting' }))?.status).toBe('blocked');
    expect((await unblockHermesKanbanCard({ cwd: '/ws', id: 'card-1' }))?.status).toBe('todo');
    await commentHermesKanbanCard({ cwd: '/ws', id: 'card-1', text: 'hi' });
    await linkHermesKanbanCard({ cwd: '/ws', id: 'card-1', target: 'https://x' });
    expect(store.commentCard).toHaveBeenCalledWith('card-1', 'hi');
    expect(store.linkCard).toHaveBeenCalledWith('card-1', 'https://x', undefined);
  });

  it('unlinks, assigns, and archives cards through the store', async () => {
    expect((await unlinkHermesKanbanCard({ cwd: '/ws', id: 'card-1', linkRef: 'l1' }))?.links).toEqual([]);
    expect((await assignHermesKanbanCard({ cwd: '/ws', id: 'card-1', assignee: 'alice' }))?.assignee).toBe('alice');
    expect((await archiveHermesKanbanCard({ cwd: '/ws', id: 'card-1' }))?.status).toBe('archived');
    expect(store.unlinkCard).toHaveBeenCalledWith('card-1', 'l1');
    expect(store.assignCard).toHaveBeenCalledWith('card-1', 'alice');
    expect(store.archiveCard).toHaveBeenCalledWith('card-1', undefined);
  });

  it('lists, creates, and switches boards through the registry', async () => {
    const boards = await listHermesKanbanBoards({ cwd: '/ws' });
    expect(boards?.[0]).toMatchObject({ slug: 'default', current: true });
    expect(KanbanBoardRegistry).toHaveBeenCalledWith({ rootDir: '/ws' });

    const created = await createHermesKanbanBoard({ cwd: '/ws', slug: 'work', name: 'Work' });
    expect(created?.slug).toBe('work');
    expect(registry.create).toHaveBeenCalledWith('work', 'Work');

    const switched = await switchHermesKanbanBoard({ cwd: '/ws', slug: 'work' });
    expect(switched?.slug).toBe('work');
    expect(registry.switch).toHaveBeenCalledWith('work');
  });

  it('returns null when the kanban store module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);
    expect(await listHermesKanbanCards({ cwd: '/ws' })).toBeNull();
  });
});
