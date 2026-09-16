/**
 * Lightweight in-process sub-agents with bounded input channels and a shared,
 * tagged output stream. A delegate owns its conversation context, while the
 * scheduler limits only active turns so an idle conversation never holds a
 * concurrency slot.
 */

export interface ThreadParentBudget {
  maxTurns: number;
  maxCostUsd: number;
  maxContextTokens: number;
}

export type ThreadChildBudget = ThreadParentBudget;

export interface ThreadDelegateContext {
  agentId: string;
  budget: ThreadChildBudget;
  signal: AbortSignal;
}

export interface ThreadDelegateAgent<TOutput = unknown> {
  processUserMessageStream(input: string): AsyncIterable<TOutput>;
  abortCurrentOperation(): void;
  dispose(): void | Promise<void>;
  getSessionCost?(): number;
}

export type ThreadDelegateAgentFactory<TOutput = unknown> = (
  context: ThreadDelegateContext,
) => ThreadDelegateAgent<TOutput> | Promise<ThreadDelegateAgent<TOutput>>;

export interface ThreadDelegationEvent<TOutput = unknown> {
  agentId: string;
  kind: string;
  payload: TOutput | Record<string, unknown>;
}

export interface ThreadTurnOutcome {
  success: boolean;
  reason?: 'agent_error' | 'cancelled' | 'turn_budget_exhausted' | 'cost_budget_exhausted';
  message?: string;
}

export interface ThreadDelegateHandle {
  readonly agentId: string;
  readonly budget: ThreadChildBudget;
  readonly done: Promise<void>;
  submit(input: string): Promise<ThreadTurnOutcome>;
  closeInput(): void;
  cancel(reason?: string): void;
}

export interface ThreadDelegationOptions<TOutput = unknown> {
  createAgent: ThreadDelegateAgentFactory<TOutput>;
  parentBudget: ThreadParentBudget;
  concurrency?: number;
  inputCapacity?: number;
  childBudgetRatio?: number;
  parentSignal?: AbortSignal;
}

interface TurnRequest {
  input: string;
  resolve: (outcome: ThreadTurnOutcome) => void;
}

interface DelegateState<TOutput> {
  agentId: string;
  budget: ThreadChildBudget;
  input: BoundedAsyncChannel<TurnRequest>;
  controller: AbortController;
  agent: ThreadDelegateAgent<TOutput> | null;
  turns: number;
  cancelledReason: string | null;
  budgetReported: boolean;
  worker: Promise<void>;
}

const DEFAULT_PARENT_TURNS = 12;
const DEFAULT_PARENT_COST_USD = 10;
const DEFAULT_PARENT_CONTEXT_TOKENS = 128_000;
const DEFAULT_CHILD_RATIO = 0.5;
const MIN_COST_USD = 0.01;
const MIN_CONTEXT_TOKENS = 1_024;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Derive a finite, reduced child allowance even when the parent is unlimited. */
export function deriveChildThreadBudget(
  parent: ThreadParentBudget,
  ratio: number = DEFAULT_CHILD_RATIO,
): ThreadChildBudget {
  const boundedRatio = Number.isFinite(ratio)
    ? Math.max(0.1, Math.min(0.9, ratio))
    : DEFAULT_CHILD_RATIO;
  const parentTurns = finitePositive(parent.maxTurns, DEFAULT_PARENT_TURNS);
  const parentCost = finitePositive(parent.maxCostUsd, DEFAULT_PARENT_COST_USD);
  const parentContext = finitePositive(
    parent.maxContextTokens,
    DEFAULT_PARENT_CONTEXT_TOKENS,
  );

  return {
    maxTurns: Math.max(1, Math.floor(parentTurns * boundedRatio)),
    maxCostUsd: Math.max(MIN_COST_USD, parentCost * boundedRatio),
    maxContextTokens: Math.max(
      MIN_CONTEXT_TOKENS,
      Math.floor(parentContext * boundedRatio),
    ),
  };
}

class ChannelClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelClosedError';
  }
}

/** A small bounded many-sender/single-receiver channel with FIFO backpressure. */
class BoundedAsyncChannel<T> {
  private readonly capacity: number;
  private readonly values: T[] = [];
  private readonly receivers: Array<(result: IteratorResult<T>) => void> = [];
  private readonly senders: Array<{
    value: T;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private closeMessage = 'Channel closed';

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  send(value: T): Promise<void> {
    if (this.closed) return Promise.reject(new ChannelClosedError(this.closeMessage));
    const receiver = this.receivers.shift();
    if (receiver) {
      receiver({ value, done: false });
      return Promise.resolve();
    }
    if (this.values.length < this.capacity) {
      this.values.push(value);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.senders.push({ value, resolve, reject });
    });
  }

  receive(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) {
      this.promoteSender();
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise<IteratorResult<T>>((resolve) => this.receivers.push(resolve));
  }

  close(message = 'Channel closed'): void {
    if (this.closed) return;
    this.closed = true;
    this.closeMessage = message;
    const error = new ChannelClosedError(message);
    for (const sender of this.senders.splice(0)) sender.reject(error);
    if (this.values.length === 0) {
      for (const receiver of this.receivers.splice(0)) {
        receiver({ value: undefined, done: true });
      }
    }
  }

  private promoteSender(): void {
    const sender = this.senders.shift();
    if (sender) {
      this.values.push(sender.value);
      sender.resolve();
      return;
    }
    if (this.closed && this.values.length === 0) {
      for (const receiver of this.receivers.splice(0)) {
        receiver({ value: undefined, done: true });
      }
    }
  }
}

/** Non-blocking output queue: a slow consumer never stalls a child turn. */
class AsyncEventQueue<T> {
  private readonly values: T[] = [];
  private readonly receivers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const receiver = this.receivers.shift();
    if (receiver) receiver({ value, done: false });
    else this.values.push(value);
  }

  receive(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise<IteratorResult<T>>((resolve) => this.receivers.push(resolve));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.values.length === 0) {
      for (const receiver of this.receivers.splice(0)) {
        receiver({ value: undefined, done: true });
      }
    }
  }
}

/** FIFO semaphore. Cancellation removes a waiter instead of consuming a slot. */
class FairSemaphore {
  private available: number;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
    onAbort: () => void;
  }> = [];

  constructor(size: number) {
    this.available = Math.max(1, Math.floor(size));
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error('Delegate cancelled'));
    if (this.available > 0 && this.waiters.length === 0) {
      this.available -= 1;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error('Delegate cancelled'));
        },
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift();
        if (!waiter) break;
        waiter.signal.removeEventListener('abort', waiter.onAbort);
        if (waiter.signal.aborted) continue;
        waiter.resolve(this.makeRelease());
        return;
      }
      this.available += 1;
    };
  }
}

export class ThreadDelegation<TOutput = unknown> {
  static readonly DEFAULT_CONCURRENCY = 1;

  private readonly createAgent: ThreadDelegateAgentFactory<TOutput>;
  private readonly childBudget: ThreadChildBudget;
  private readonly inputCapacity: number;
  private readonly semaphore: FairSemaphore;
  private readonly output = new AsyncEventQueue<ThreadDelegationEvent<TOutput>>();
  private readonly delegates = new Map<string, DelegateState<TOutput>>();
  private readonly parentSignal?: AbortSignal;
  private readonly parentAbortListener: () => void;
  private closing = false;
  private cancelled = false;
  private outputClosed = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: ThreadDelegationOptions<TOutput>) {
    this.createAgent = options.createAgent;
    this.childBudget = deriveChildThreadBudget(
      options.parentBudget,
      options.childBudgetRatio,
    );
    this.inputCapacity = Math.max(1, Math.floor(options.inputCapacity ?? 8));
    const configuredConcurrency = options.concurrency ?? ThreadDelegation.DEFAULT_CONCURRENCY;
    this.semaphore = new FairSemaphore(
      Number.isFinite(configuredConcurrency) ? configuredConcurrency : ThreadDelegation.DEFAULT_CONCURRENCY,
    );
    this.parentSignal = options.parentSignal;
    this.parentAbortListener = () => this.cancel('Parent cancelled');
    if (this.parentSignal?.aborted) this.cancel('Parent already cancelled');
    else this.parentSignal?.addEventListener('abort', this.parentAbortListener, { once: true });
  }

  spawn(agentId: string): ThreadDelegateHandle {
    if (this.closing || this.cancelled) throw new Error('Thread delegation is closed');
    const normalizedId = agentId.trim();
    if (!normalizedId) throw new Error('Delegate agentId is required');
    if (this.delegates.has(normalizedId)) {
      throw new Error(`Delegate '${normalizedId}' already exists`);
    }

    const state: DelegateState<TOutput> = {
      agentId: normalizedId,
      budget: { ...this.childBudget },
      input: new BoundedAsyncChannel<TurnRequest>(this.inputCapacity),
      controller: new AbortController(),
      agent: null,
      turns: 0,
      cancelledReason: null,
      budgetReported: false,
      worker: Promise.resolve(),
    };
    state.worker = this.runDelegate(state);
    this.delegates.set(normalizedId, state);
    this.emit(normalizedId, 'status', {
      state: 'ready',
      budget: state.budget,
    });

    return {
      agentId: normalizedId,
      budget: { ...state.budget },
      done: state.worker,
      submit: (input) => this.submit(state, input),
      closeInput: () => state.input.close('Delegate input closed'),
      cancel: (reason = 'Delegate cancelled') => this.cancelDelegate(state, reason),
    };
  }

  async *events(): AsyncGenerator<ThreadDelegationEvent<TOutput>, void, unknown> {
    try {
      while (true) {
        const next = await this.output.receive();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      if (!this.outputClosed && !this.cancelled) {
        this.cancel('Parent abandoned delegate output');
      }
    }
  }

  cancel(reason = 'Parent cancelled'): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.closing = true;
    for (const state of this.delegates.values()) this.cancelDelegate(state, reason);
    this.removeParentAbortListener();
    void Promise.allSettled([...this.delegates.values()].map((state) => state.worker))
      .then(() => this.closeOutput());
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    for (const state of this.delegates.values()) {
      state.input.close('Thread delegation closed');
    }
    this.closePromise = Promise.allSettled(
      [...this.delegates.values()].map((state) => state.worker),
    ).then(() => {
      this.removeParentAbortListener();
      this.closeOutput();
    });
    return this.closePromise;
  }

  private async submit(
    state: DelegateState<TOutput>,
    input: string,
  ): Promise<ThreadTurnOutcome> {
    if (this.cancelled || state.cancelledReason) {
      return { success: false, reason: 'cancelled', message: state.cancelledReason ?? 'Parent cancelled' };
    }
    return new Promise<ThreadTurnOutcome>((resolve) => {
      state.input.send({ input, resolve }).catch((error: unknown) => {
        resolve({
          success: false,
          reason: this.cancelled || state.cancelledReason ? 'cancelled' : 'turn_budget_exhausted',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  private async runDelegate(state: DelegateState<TOutput>): Promise<void> {
    try {
      while (true) {
        const next = await state.input.receive();
        if (next.done) break;
        const request = next.value;
        if (this.cancelled || state.cancelledReason) {
          request.resolve({
            success: false,
            reason: 'cancelled',
            message: state.cancelledReason ?? 'Parent cancelled',
          });
          continue;
        }
        if (state.turns >= state.budget.maxTurns) {
          const message = `Delegate turn budget exhausted after ${state.budget.maxTurns} turns`;
          this.reportBudget(state, 'turn_budget_exhausted', message);
          request.resolve({ success: false, reason: 'turn_budget_exhausted', message });
          state.input.close(message);
          continue;
        }
        if ((state.agent?.getSessionCost?.() ?? 0) >= state.budget.maxCostUsd) {
          const message = `Delegate cost budget exhausted at $${state.budget.maxCostUsd.toFixed(4)}`;
          this.reportBudget(state, 'cost_budget_exhausted', message);
          request.resolve({ success: false, reason: 'cost_budget_exhausted', message });
          state.input.close(message);
          continue;
        }

        let release: (() => void) | null = null;
        try {
          release = await this.semaphore.acquire(state.controller.signal);
          if (this.cancelled || state.cancelledReason) {
            request.resolve({
              success: false,
              reason: 'cancelled',
              message: state.cancelledReason ?? 'Parent cancelled',
            });
            continue;
          }
          if (!state.agent) {
            state.agent = await this.createAgent({
              agentId: state.agentId,
              budget: { ...state.budget },
              signal: state.controller.signal,
            });
          }
          // The parent can be cancelled while an asynchronous factory is still
          // loading a provider. Re-check before counting or starting a turn.
          if (this.cancelled || state.cancelledReason || state.controller.signal.aborted) {
            request.resolve({
              success: false,
              reason: 'cancelled',
              message: state.cancelledReason ?? 'Parent cancelled',
            });
            continue;
          }
          state.turns += 1;
          this.emit(state.agentId, 'status', {
            state: 'turn_started',
            turn: state.turns,
            maxTurns: state.budget.maxTurns,
          });
          for await (const output of state.agent.processUserMessageStream(request.input)) {
            if (this.cancelled || state.cancelledReason || state.controller.signal.aborted) break;
            this.emit(state.agentId, this.outputKind(output), output);
          }
          if (this.cancelled || state.cancelledReason || state.controller.signal.aborted) {
            request.resolve({
              success: false,
              reason: 'cancelled',
              message: state.cancelledReason ?? 'Parent cancelled',
            });
          } else {
            const sessionCost = state.agent.getSessionCost?.() ?? 0;
            if (sessionCost >= state.budget.maxCostUsd) {
              const message =
                `Delegate cost budget exhausted at $${sessionCost.toFixed(4)} ` +
                `(limit $${state.budget.maxCostUsd.toFixed(4)})`;
              this.reportBudget(state, 'cost_budget_exhausted', message);
              request.resolve({ success: false, reason: 'cost_budget_exhausted', message });
              state.input.close(message);
            } else {
              request.resolve({ success: true });
              this.emit(state.agentId, 'status', {
                state: 'turn_completed',
                turn: state.turns,
                costUsd: sessionCost,
              });
            }
          }
        } catch (error) {
          if (this.cancelled || state.cancelledReason || state.controller.signal.aborted) {
            request.resolve({
              success: false,
              reason: 'cancelled',
              message: state.cancelledReason ?? 'Parent cancelled',
            });
          } else {
            const message = error instanceof Error ? error.message : String(error);
            this.emit(state.agentId, 'error', { message });
            request.resolve({ success: false, reason: 'agent_error', message });
          }
        } finally {
          release?.();
        }
      }
    } finally {
      try {
        await state.agent?.dispose();
      } catch (error) {
        this.emit(state.agentId, 'error', {
          message: `Delegate disposal failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      this.emit(state.agentId, 'done', {
        state: state.cancelledReason ? 'cancelled' : 'closed',
        turns: state.turns,
      });
    }
  }

  private cancelDelegate(state: DelegateState<TOutput>, reason: string): void {
    if (state.cancelledReason) return;
    state.cancelledReason = reason;
    state.controller.abort(reason);
    state.input.close(reason);
    try {
      state.agent?.abortCurrentOperation();
    } catch {
      // Cancellation is best effort; the worker still suppresses late output.
    }
    this.emit(state.agentId, 'cancelled', { message: reason });
  }

  private reportBudget(
    state: DelegateState<TOutput>,
    reason: 'turn_budget_exhausted' | 'cost_budget_exhausted',
    message: string,
  ): void {
    if (state.budgetReported) return;
    state.budgetReported = true;
    this.emit(state.agentId, 'budget_exhausted', { reason, message });
  }

  private outputKind(output: TOutput): string {
    if (typeof output === 'object' && output !== null && 'type' in output) {
      const type = (output as { type?: unknown }).type;
      if (typeof type === 'string' && type) return type;
    }
    return 'output';
  }

  private emit(agentId: string, kind: string, payload: unknown): void {
    this.output.push({
      agentId,
      kind,
      payload: payload as TOutput | Record<string, unknown>,
    });
  }

  private removeParentAbortListener(): void {
    this.parentSignal?.removeEventListener('abort', this.parentAbortListener);
  }

  private closeOutput(): void {
    if (this.outputClosed) return;
    this.outputClosed = true;
    this.output.close();
  }
}
