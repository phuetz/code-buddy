/**
 * ColabBoardBridge — board mutations (add/claim/complete/block/release +
 * expired-claim sweep) through the core FleetColabStore, with fail-closed
 * validation of the inputs the shared worklog depends on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  addColabTaskForReview,
  blockColabTaskForReview,
  claimColabTaskForReview,
  completeColabTaskForReview,
  releaseColabTaskForReview,
  reclaimExpiredColabForReview,
} from '../src/main/autonomy/colab-board-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
  resolveCoreEntry: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

interface StoreStub {
  addTask: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  completeTask: ReturnType<typeof vi.fn>;
  blockTask: ReturnType<typeof vi.fn>;
  releaseTask: ReturnType<typeof vi.fn>;
  reclaimExpired: ReturnType<typeof vi.fn>;
}

const baseTask = {
  id: 'task-1',
  title: 'Wire the kanban write half',
  status: 'open',
  priority: 'medium',
  claimedBy: null,
  claimedAt: null,
};

function makeStore(overrides: Partial<StoreStub> = {}): StoreStub {
  return {
    addTask: vi.fn().mockReturnValue(baseTask),
    claim: vi.fn().mockReturnValue({ ...baseTask, status: 'in_progress', claimedBy: 'unit/cowork' }),
    completeTask: vi.fn().mockReturnValue({ task: { ...baseTask, status: 'completed' } }),
    blockTask: vi.fn().mockReturnValue({ ...baseTask, status: 'blocked', blockedReason: 'needs creds' }),
    releaseTask: vi.fn().mockReturnValue({ ...baseTask, status: 'open' }),
    reclaimExpired: vi.fn().mockReturnValue(['task-9']),
    ...overrides,
  };
}

function stubStoreModule(store: StoreStub): { capturedConfig: () => Record<string, unknown> | undefined } {
  let captured: Record<string, unknown> | undefined;
  mockedLoadCoreModule.mockImplementation(async (path: string) => {
    if (path !== 'fleet/colab-store.js') return null;
    return {
      FleetColabStore: class {
        constructor(config?: Record<string, unknown>) {
          captured = config;
        }
        getDir = () => (captured?.dir as string) ?? '/queue';
        addTask = store.addTask;
        claim = store.claim;
        completeTask = store.completeTask;
        blockTask = store.blockTask;
        releaseTask = store.releaseTask;
        reclaimExpired = store.reclaimExpired;
      },
    };
  });
  return { capturedConfig: () => captured };
}

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('colab board add', () => {
  it('adds a task through the core store, attributed to <host>/cowork on the daemon queue dir', async () => {
    const store = makeStore();
    const { capturedConfig } = stubStoreModule(store);

    const review = await addColabTaskForReview({ title: '  Wire the kanban write half  ', priority: 'high' });

    expect(review.ok).toBe(true);
    expect(review.task?.id).toBe('task-1');
    expect(store.addTask).toHaveBeenCalledWith({ title: 'Wire the kanban write half', priority: 'high' });
    const config = capturedConfig();
    expect(String(config?.agentId)).toMatch(/\/cowork$/);
    expect(String(config?.dir)).toContain('.codebuddy');
  });

  it('refuses an empty title without touching the core', async () => {
    const review = await addColabTaskForReview({ title: '   ' });

    expect(review.ok).toBe(false);
    expect(review.error).toContain('title');
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });

  it('refuses an unknown priority without touching the core', async () => {
    const review = await addColabTaskForReview({ title: 'ok', priority: 'urgent' as never });

    expect(review.ok).toBe(false);
    expect(review.error).toContain('priority');
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });

  it('degrades cleanly when the core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    const review = await addColabTaskForReview({ title: 'ok' });

    expect(review.ok).toBe(false);
    expect(review.error).toContain('unavailable');
  });
});

describe('colab board claim', () => {
  it('claims through the core store and returns the in_progress task', async () => {
    const store = makeStore();
    stubStoreModule(store);

    const review = await claimColabTaskForReview('task-1');

    expect(review.ok).toBe(true);
    expect(store.claim).toHaveBeenCalledWith('task-1');
    expect(review.task?.status).toBe('in_progress');
  });

  it('surfaces the store error when a task is already claimed', async () => {
    const store = makeStore({
      claim: vi.fn().mockImplementation(() => {
        throw new Error("Task 'task-1' already claimed by 'gpuNode/repo'");
      }),
    });
    stubStoreModule(store);

    const review = await claimColabTaskForReview('task-1');

    expect(review.ok).toBe(false);
    expect(review.error).toContain('already claimed');
  });
});

describe('colab board complete', () => {
  it('completes with a trimmed worklog summary', async () => {
    const store = makeStore();
    stubStoreModule(store);

    const review = await completeColabTaskForReview('task-1', '  shipped the board  ');

    expect(review.ok).toBe(true);
    expect(store.completeTask).toHaveBeenCalledWith('task-1', { summary: 'shipped the board' });
    expect(review.task?.status).toBe('completed');
  });

  it('refuses an empty summary without touching the core (it feeds the shared worklog)', async () => {
    const review = await completeColabTaskForReview('task-1', '   ');

    expect(review.ok).toBe(false);
    expect(review.error).toContain('summary');
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });
});

describe('colab board block / release', () => {
  it('blocks with a reason', async () => {
    const store = makeStore();
    stubStoreModule(store);

    const review = await blockColabTaskForReview('task-1', 'needs creds');

    expect(review.ok).toBe(true);
    expect(store.blockTask).toHaveBeenCalledWith('task-1', 'needs creds');
    expect(review.task?.blockedReason).toBe('needs creds');
  });

  it('refuses to block without a reason', async () => {
    const review = await blockColabTaskForReview('task-1', '');

    expect(review.ok).toBe(false);
    expect(review.error).toContain('reason');
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });

  it('releases a task back to the open pool', async () => {
    const store = makeStore();
    stubStoreModule(store);

    const review = await releaseColabTaskForReview('task-1');

    expect(review.ok).toBe(true);
    expect(store.releaseTask).toHaveBeenCalledWith('task-1');
    expect(review.task?.status).toBe('open');
  });
});

describe('colab board expired-claim sweep', () => {
  it('returns the reclaimed task ids', async () => {
    const store = makeStore();
    stubStoreModule(store);

    const review = await reclaimExpiredColabForReview();

    expect(review.ok).toBe(true);
    expect(review.reclaimed).toEqual(['task-9']);
  });

  it('degrades cleanly when the core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    const review = await reclaimExpiredColabForReview();

    expect(review.ok).toBe(false);
    expect(review.reclaimed).toEqual([]);
  });
});
