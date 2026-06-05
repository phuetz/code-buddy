import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  archiveHermesKanbanCard,
  assignHermesKanbanCard,
  blockHermesKanbanCard,
  commentHermesKanbanCard,
  completeHermesKanbanCard,
  createHermesKanbanCard,
  linkHermesKanbanCard,
  listHermesKanbanCards,
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

let store: ReturnType<typeof makeStore>;
let KanbanStore: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
  store = makeStore();
  // Use a normal function (not an arrow) so it is constructable with `new`.
  KanbanStore = vi.fn().mockImplementation(function (this: unknown) {
    return store;
  });
  mockedLoadCoreModule.mockResolvedValue({ KanbanStore });
});

describe('Hermes kanban bridge', () => {
  it('builds the store rooted at the provided workspace cwd', async () => {
    await listHermesKanbanCards({ cwd: '/ws', filter: { includeDone: true } });
    expect(KanbanStore).toHaveBeenCalledWith({ rootDir: '/ws' });
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

  it('returns null when the kanban store module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);
    expect(await listHermesKanbanCards({ cwd: '/ws' })).toBeNull();
  });
});
