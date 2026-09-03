import {
  ThreadDelegation,
  type ThreadDelegateContext,
  type ThreadDelegateHandle,
  type ThreadDelegationEvent,
  type ThreadDelegationOptions,
  type ThreadTurnOutcome,
} from './thread-delegation.js';

/** A complete child agent adapted to the string-channel ThreadDelegation core. */
export interface ThreadTaskAgent<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput> | AsyncIterable<TOutput>;
  abortCurrentOperation(): void;
  dispose(): void | Promise<void>;
  getSessionCost?(): number;
}

export type ThreadTaskAgentFactory<TInput, TOutput> = (
  context: ThreadDelegateContext,
) => ThreadTaskAgent<TInput, TOutput> | Promise<ThreadTaskAgent<TInput, TOutput>>;

export interface ThreadTaskRunnerOptions<TInput, TOutput>
  extends Omit<ThreadDelegationOptions<TOutput>, 'createAgent'> {
  createAgent: ThreadTaskAgentFactory<TInput, TOutput>;
}

export interface ThreadTaskOutcome<TOutput> extends ThreadTurnOutcome {
  output?: TOutput;
}

interface PendingTask<TInput, TOutput> {
  input: TInput;
  output?: TOutput;
  hasOutput: boolean;
}

/**
 * Typed task facade over ThreadDelegation.
 *
 * ThreadDelegation intentionally transports strings so it can feed an LLM
 * conversation directly. Swarm and Team already own structured task objects;
 * this adapter keeps those objects in-process and sends only an opaque request
 * id through the bounded channel. The core remains the single source of truth
 * for FIFO ordering, concurrency, budgets, cancellation, and error isolation.
 */
export class ThreadTaskRunner<TInput, TOutput> {
  static readonly DEFAULT_CONCURRENCY = ThreadDelegation.DEFAULT_CONCURRENCY;

  private readonly delegation: ThreadDelegation<TOutput>;
  private readonly handles = new Map<string, ThreadDelegateHandle>();
  private readonly pending = new Map<string, PendingTask<TInput, TOutput>>();
  private requestSequence = 0;

  constructor(options: ThreadTaskRunnerOptions<TInput, TOutput>) {
    const pendingTasks = this.pending;
    this.delegation = new ThreadDelegation<TOutput>({
      parentBudget: options.parentBudget,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      ...(options.inputCapacity === undefined ? {} : { inputCapacity: options.inputCapacity }),
      ...(options.childBudgetRatio === undefined ? {} : { childBudgetRatio: options.childBudgetRatio }),
      ...(options.parentSignal === undefined ? {} : { parentSignal: options.parentSignal }),
      createAgent: async (context) => {
        const taskAgent = await options.createAgent(context);
        return {
          processUserMessageStream: async function* (requestId: string) {
            const task = pendingTasks.get(requestId);
            if (!task) throw new Error(`Unknown delegated task request: ${requestId}`);
            const execution = taskAgent.execute(task.input);
            if (Symbol.asyncIterator in Object(execution)) {
              for await (const output of execution as AsyncIterable<TOutput>) {
                task.output = output;
                task.hasOutput = true;
                yield output;
              }
            } else {
              const output = (await execution) as TOutput;
              task.output = output;
              task.hasOutput = true;
              yield output;
            }
          },
          abortCurrentOperation: () => taskAgent.abortCurrentOperation(),
          dispose: () => taskAgent.dispose(),
          ...(taskAgent.getSessionCost
            ? { getSessionCost: () => taskAgent.getSessionCost?.() ?? 0 }
            : {}),
        };
      },
    });
  }

  async submit(agentId: string, input: TInput): Promise<ThreadTaskOutcome<TOutput>> {
    const requestId = `task-${++this.requestSequence}`;
    const pending: PendingTask<TInput, TOutput> = { input, hasOutput: false };
    this.pending.set(requestId, pending);

    try {
      let handle = this.handles.get(agentId);
      if (!handle) {
        handle = this.delegation.spawn(agentId);
        this.handles.set(agentId, handle);
      }
      const outcome = await handle.submit(requestId);
      if (outcome.success && pending.hasOutput) {
        return { ...outcome, output: pending.output as TOutput };
      }
      return outcome;
    } finally {
      this.pending.delete(requestId);
    }
  }

  events(): AsyncGenerator<ThreadDelegationEvent<TOutput>, void, unknown> {
    return this.delegation.events();
  }

  cancelAgent(agentId: string, reason = 'Delegate cancelled'): void {
    this.handles.get(agentId)?.cancel(reason);
  }

  cancel(reason = 'Parent cancelled'): void {
    this.delegation.cancel(reason);
  }

  close(): Promise<void> {
    return this.delegation.close();
  }
}
