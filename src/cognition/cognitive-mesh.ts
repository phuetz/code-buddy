import { logger } from '../utils/logger.js';
import { GlobalWorkspace } from './global-workspace.js';
import type {
  SpecialistDefinition,
  SpecialistMetrics,
  WorkspaceDraft,
  WorkspaceItem,
  WorkspacePrivacy,
} from './types.js';

interface SpecialistState {
  definition: SpecialistDefinition;
  queue: WorkspaceItem[];
  active: number;
  controllers: Set<AbortController>;
  latency: number[];
  counters: Omit<SpecialistMetrics, 'id' | 'queued' | 'active' | 'latencyP50Ms' | 'latencyP95Ms'>;
}

export interface CognitiveMeshOptions {
  maxConcurrency?: number;
  maxConcurrencyPerProvider?: number;
  maxDepth?: number;
  now?: () => number;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

const PRIVACY_RANK: Record<WorkspacePrivacy, number> = {
  'cloud-ok': 0,
  'trusted-lan': 1,
  'local-only': 2,
};

function stricterPrivacy(
  inherited: WorkspacePrivacy,
  proposed: WorkspacePrivacy,
): WorkspacePrivacy {
  return PRIVACY_RANK[inherited] > PRIVACY_RANK[proposed] ? inherited : proposed;
}

/**
 * Runs independent cognitive specialists concurrently while serialising each
 * specialist by default. It is deliberately provider-agnostic: local models,
 * Fleet sessions and deterministic reducers all implement the same contract.
 */
export class CognitiveMesh {
  private readonly specialists = new Map<string, SpecialistState>();
  private readonly maxConcurrency: number;
  private readonly maxConcurrencyPerProvider: number;
  private readonly maxDepth: number;
  private readonly now: () => number;
  private readonly activeByProvider = new Map<string, number>();
  private activeTotal = 0;
  private stopped = false;
  private pumpScheduled = false;

  constructor(
    readonly workspace: GlobalWorkspace,
    options: CognitiveMeshOptions = {},
  ) {
    this.maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 8));
    this.maxConcurrencyPerProvider = Math.max(
      1,
      Math.floor(options.maxConcurrencyPerProvider ?? 2),
    );
    this.maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 4));
    this.now = options.now ?? Date.now;
  }

  register(definition: SpecialistDefinition): void {
    if (this.specialists.has(definition.id)) {
      throw new Error(`cognitive specialist already registered: ${definition.id}`);
    }
    this.specialists.set(definition.id, {
      definition,
      queue: [],
      active: 0,
      controllers: new Set(),
      latency: [],
      counters: {
        processed: 0,
        dropped: 0,
        coalesced: 0,
        failed: 0,
        deadlineMisses: 0,
      },
    });
  }

  publish<T>(draft: WorkspaceDraft<T>): WorkspaceItem<T> | null {
    if (this.stopped) return null;
    const item = this.workspace.publish(draft);
    if (item) this.dispatch(item);
    return item;
  }

  dispatch(item: WorkspaceItem): void {
    if (this.stopped || item.depth >= this.maxDepth) return;
    for (const state of this.specialists.values()) {
      if (state.definition.id === item.producerId) continue;
      if (!state.definition.subscriptions.includes(item.kind)) continue;
      this.enqueue(state, item);
    }
    this.schedulePump();
  }

  metrics(): SpecialistMetrics[] {
    return [...this.specialists.values()].map((state) => ({
      id: state.definition.id,
      queued: state.queue.length,
      active: state.active,
      ...state.counters,
      latencyP50Ms: percentile(state.latency, 0.5),
      latencyP95Ms: percentile(state.latency, 0.95),
    }));
  }

  stop(): void {
    this.stopped = true;
    for (const state of this.specialists.values()) {
      state.queue.length = 0;
      for (const controller of state.controllers) controller.abort('cognitive mesh stopped');
    }
  }

  private enqueue(state: SpecialistState, item: WorkspaceItem): void {
    const capacity = Math.max(1, Math.floor(state.definition.mailboxCapacity ?? 32));
    if (state.queue.length < capacity) {
      state.queue.push(item);
      return;
    }
    switch (state.definition.overflow ?? 'drop-lowest-salience') {
      case 'drop-oldest':
        state.queue.shift();
        state.queue.push(item);
        state.counters.dropped++;
        return;
      case 'coalesce-latest': {
        const index = state.queue.findIndex(
          (queued) => queued.kind === item.kind && queued.correlationId === item.correlationId,
        );
        if (index >= 0) {
          state.queue[index] = item;
          state.counters.coalesced++;
        } else {
          state.queue.shift();
          state.queue.push(item);
          state.counters.dropped++;
        }
        return;
      }
      case 'drop-lowest-salience': {
        let lowest = 0;
        for (let i = 1; i < state.queue.length; i++) {
          if ((state.queue[i]?.salience ?? 0) < (state.queue[lowest]?.salience ?? 0)) lowest = i;
        }
        if ((state.queue[lowest]?.salience ?? 0) >= item.salience) {
          state.counters.dropped++;
          return;
        }
        state.queue.splice(lowest, 1, item);
        state.counters.dropped++;
      }
    }
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.stopped) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.stopped) return;
    let admitted = true;
    while (admitted && this.activeTotal < this.maxConcurrency) {
      admitted = false;
      for (const state of this.specialists.values()) {
        if (this.activeTotal >= this.maxConcurrency) break;
        if (state.queue.length === 0) continue;
        const specialistLimit = Math.max(1, Math.floor(state.definition.maxConcurrency ?? 1));
        if (state.active >= specialistLimit) continue;
        const provider = state.definition.providerGroup ?? state.definition.id;
        if ((this.activeByProvider.get(provider) ?? 0) >= this.maxConcurrencyPerProvider) continue;
        const trigger = state.queue.shift();
        if (!trigger) continue;
        admitted = true;
        this.startActivation(state, provider, trigger);
      }
    }
  }

  private startActivation(state: SpecialistState, provider: string, trigger: WorkspaceItem): void {
    state.active++;
    this.activeTotal++;
    this.activeByProvider.set(provider, (this.activeByProvider.get(provider) ?? 0) + 1);
    const controller = new AbortController();
    state.controllers.add(controller);
    const startedAt = this.now();
    const deadlineMs = Math.max(1, Math.floor(state.definition.deadlineMs ?? 30_000));
    const deadline = setTimeout(() => {
      state.counters.deadlineMisses++;
      controller.abort(`specialist deadline exceeded (${deadlineMs}ms)`);
    }, deadlineMs);
    deadline.unref?.();

    void Promise.resolve()
      .then(() =>
        state.definition.activate({
          trigger,
          workspace: this.workspace.snapshot({ correlationId: trigger.correlationId }),
          signal: controller.signal,
        }),
      )
      .then((drafts) => {
        state.counters.processed++;
        for (const draft of drafts ?? []) {
          this.publish({
            ...draft,
            // Carry privacy directly from the trigger as well as through the
            // provenance graph. The trigger may expire before a slow model
            // returns, but its derived result must still never be downgraded.
            privacy: stricterPrivacy(trigger.privacy, draft.privacy),
            depth: trigger.depth + 1,
            provenance: {
              ...draft.provenance,
              derivedFrom: [...new Set([trigger.id, ...(draft.provenance.derivedFrom ?? [])])],
            },
          });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          state.counters.failed++;
          logger.warn(
            `[cognition] specialist "${state.definition.id}" failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      })
      .finally(() => {
        clearTimeout(deadline);
        state.controllers.delete(controller);
        state.active--;
        this.activeTotal--;
        const providerActive = Math.max(0, (this.activeByProvider.get(provider) ?? 1) - 1);
        if (providerActive === 0) this.activeByProvider.delete(provider);
        else this.activeByProvider.set(provider, providerActive);
        state.latency.push(Math.max(0, this.now() - startedAt));
        if (state.latency.length > 256) state.latency.shift();
        this.schedulePump();
      });
  }
}
