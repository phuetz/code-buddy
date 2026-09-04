import { describe, expect, it } from 'vitest';
import {
  ThreadDelegation,
  deriveChildThreadBudget,
  type ThreadDelegateAgentFactory,
  type ThreadDelegationEvent,
} from '../../../src/agent/delegation/thread-delegation.js';

interface TestChunk {
  type: 'content';
  content: string;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function collectEvents<T>(
  events: AsyncIterable<ThreadDelegationEvent<T>>,
): Promise<Array<ThreadDelegationEvent<T>>> {
  const collected: Array<ThreadDelegationEvent<T>> = [];
  for await (const event of events) collected.push(event);
  return collected;
}

const parentBudget = {
  maxTurns: 8,
  maxCostUsd: 4,
  maxContextTokens: 32_000,
};

describe('ThreadDelegation multiplexed delegates', () => {
  it('keeps output ordered within each agent while multiplexing agents', async () => {
    const factory: ThreadDelegateAgentFactory<TestChunk> = ({ agentId }) => ({
      async *processUserMessageStream(): AsyncGenerator<TestChunk> {
        yield { type: 'content', content: `${agentId}:1` };
        await new Promise((resolve) => setTimeout(resolve, agentId === 'slow' ? 15 : 1));
        yield { type: 'content', content: `${agentId}:2` };
      },
      abortCurrentOperation() {},
      dispose() {},
    });
    const delegation = new ThreadDelegation({
      concurrency: 2,
      parentBudget,
      createAgent: factory,
    });
    const collecting = collectEvents(delegation.events());
    const slow = delegation.spawn('slow');
    const fast = delegation.spawn('fast');

    const slowTurn = slow.submit('one');
    const fastTurn = fast.submit('two');
    slow.closeInput();
    fast.closeInput();
    await Promise.all([slowTurn, fastTurn]);
    await delegation.close();

    const content = (await collecting).filter((event) => event.kind === 'content');
    expect(content.filter((event) => event.agentId === 'slow').map((event) => event.payload)).toEqual([
      { type: 'content', content: 'slow:1' },
      { type: 'content', content: 'slow:2' },
    ]);
    expect(content.filter((event) => event.agentId === 'fast').map((event) => event.payload)).toEqual([
      { type: 'content', content: 'fast:1' },
      { type: 'content', content: 'fast:2' },
    ]);
  });

  it('runs two delegates concurrently without corrupting tagged chunks', async () => {
    let active = 0;
    let maxActive = 0;
    const factory: ThreadDelegateAgentFactory<TestChunk> = ({ agentId }) => ({
      async *processUserMessageStream(): AsyncGenerator<TestChunk> {
        active += 1;
        maxActive = Math.max(maxActive, active);
        yield { type: 'content', content: `${agentId}:begin` };
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield { type: 'content', content: `${agentId}:end` };
        active -= 1;
      },
      abortCurrentOperation() {},
      dispose() {},
    });
    const delegation = new ThreadDelegation({
      concurrency: 2,
      parentBudget,
      createAgent: factory,
    });
    const collecting = collectEvents(delegation.events());
    const a = delegation.spawn('a');
    const b = delegation.spawn('b');

    const turns = [a.submit('a'), b.submit('b')];
    a.closeInput();
    b.closeInput();
    await Promise.all(turns);
    await delegation.close();

    const content = (await collecting).filter((event) => event.kind === 'content');
    expect(maxActive).toBe(2);
    expect(content).toHaveLength(4);
    for (const event of content) {
      const chunk = event.payload as TestChunk;
      expect(chunk.content.startsWith(`${event.agentId}:`)).toBe(true);
    }
  });

  it('cancels active and queued child work when the parent aborts', async () => {
    const parent = new AbortController();
    const started = deferred();
    const interrupted = deferred();
    let turns = 0;
    const factory: ThreadDelegateAgentFactory<TestChunk> = () => ({
      async *processUserMessageStream(): AsyncGenerator<TestChunk> {
        turns += 1;
        yield { type: 'content', content: 'started' };
        started.resolve();
        await interrupted.promise;
        yield { type: 'content', content: 'late' };
      },
      abortCurrentOperation() {
        interrupted.resolve();
      },
      dispose() {},
    });
    const delegation = new ThreadDelegation({
      concurrency: 1,
      parentBudget,
      parentSignal: parent.signal,
      createAgent: factory,
    });
    const collecting = collectEvents(delegation.events());
    const child = delegation.spawn('child');
    const first = child.submit('first');
    const second = child.submit('second');

    await started.promise;
    parent.abort('parent stopped');
    const outcomes = await Promise.all([first, second]);
    await delegation.close();

    const events = await collecting;
    expect(turns).toBe(1);
    expect(outcomes.every((outcome) => !outcome.success)).toBe(true);
    expect(events.some((event) => event.kind === 'cancelled')).toBe(true);
    expect(events.some((event) => (event.payload as TestChunk).content === 'late')).toBe(false);
  });

  it('does not start a turn when the parent aborts while the agent is starting', async () => {
    const parent = new AbortController();
    const factoryStarted = deferred();
    const factoryRelease = deferred();
    let turns = 0;
    const delegation = new ThreadDelegation<TestChunk>({
      parentBudget,
      parentSignal: parent.signal,
      createAgent: async () => {
        factoryStarted.resolve();
        await factoryRelease.promise;
        return {
          async *processUserMessageStream(): AsyncGenerator<TestChunk> {
            turns += 1;
            yield { type: 'content', content: 'too late' };
          },
          abortCurrentOperation() {},
          dispose() {},
        };
      },
    });
    const collecting = collectEvents(delegation.events());
    const child = delegation.spawn('starting');
    const turn = child.submit('work');
    child.closeInput();

    await factoryStarted.promise;
    parent.abort('parent stopped during startup');
    factoryRelease.resolve();
    const outcome = await turn;
    await delegation.close();
    await collecting;

    expect(outcome).toMatchObject({ success: false, reason: 'cancelled' });
    expect(turns).toBe(0);
  });

  it('stops cleanly with an honest event when the reduced turn budget is exceeded', async () => {
    let turns = 0;
    const delegation = new ThreadDelegation<TestChunk>({
      parentBudget: { ...parentBudget, maxTurns: 4 },
      createAgent: () => ({
        async *processUserMessageStream(): AsyncGenerator<TestChunk> {
          turns += 1;
          yield { type: 'content', content: `turn:${turns}` };
        },
        abortCurrentOperation() {},
        dispose() {},
        getSessionCost: () => 0,
      }),
    });
    const collecting = collectEvents(delegation.events());
    const child = delegation.spawn('budgeted');

    expect((await child.submit('one')).success).toBe(true);
    expect((await child.submit('two')).success).toBe(true);
    const exceeded = await child.submit('three');
    child.closeInput();
    await delegation.close();

    const events = await collecting;
    expect(turns).toBe(2);
    expect(exceeded).toMatchObject({ success: false, reason: 'turn_budget_exhausted' });
    expect(events.find((event) => event.kind === 'budget_exhausted')?.payload).toMatchObject({
      message: expect.stringMatching(/turn budget.*2/i),
    });
  });

  it('fails the current turn honestly when its execution crosses the child cost budget', async () => {
    let sessionCost = 0;
    const delegation = new ThreadDelegation<TestChunk>({
      parentBudget: { ...parentBudget, maxCostUsd: 2 },
      createAgent: () => ({
        async *processUserMessageStream(): AsyncGenerator<TestChunk> {
          yield { type: 'content', content: 'work completed after spending too much' };
          sessionCost = 1.25;
        },
        abortCurrentOperation() {},
        dispose() {},
        getSessionCost: () => sessionCost,
      }),
    });
    const collecting = collectEvents(delegation.events());
    const child = delegation.spawn('costly');

    const outcome = await child.submit('work');
    child.closeInput();
    await delegation.close();

    const events = await collecting;
    expect(outcome).toMatchObject({
      success: false,
      reason: 'cost_budget_exhausted',
    });
    expect(events.find((event) => event.kind === 'budget_exhausted')?.payload).toMatchObject({
      reason: 'cost_budget_exhausted',
    });
  });

  it('contains a throwing child and reports it while another child completes', async () => {
    const factory: ThreadDelegateAgentFactory<TestChunk> = ({ agentId }) => ({
      async *processUserMessageStream(): AsyncGenerator<TestChunk> {
        if (agentId === 'broken') throw new Error('child exploded');
        yield { type: 'content', content: 'healthy output' };
      },
      abortCurrentOperation() {},
      dispose() {},
    });
    const delegation = new ThreadDelegation({
      concurrency: 2,
      parentBudget,
      createAgent: factory,
    });
    const collecting = collectEvents(delegation.events());
    const broken = delegation.spawn('broken');
    const healthy = delegation.spawn('healthy');

    const brokenTurn = broken.submit('fail');
    const healthyTurn = healthy.submit('work');
    broken.closeInput();
    healthy.closeInput();
    const [brokenOutcome, healthyOutcome] = await Promise.all([brokenTurn, healthyTurn]);
    await delegation.close();

    const events = await collecting;
    expect(brokenOutcome).toMatchObject({ success: false, reason: 'agent_error' });
    expect(healthyOutcome.success).toBe(true);
    expect(events.find((event) => event.agentId === 'broken' && event.kind === 'error')?.payload)
      .toMatchObject({ message: 'child exploded' });
    expect(events.some((event) => event.agentId === 'healthy' && event.kind === 'content')).toBe(true);
  });

  it('keeps the current default concurrency of one', async () => {
    let active = 0;
    let maxActive = 0;
    const factory: ThreadDelegateAgentFactory<TestChunk> = () => ({
      async *processUserMessageStream(): AsyncGenerator<TestChunk> {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        yield { type: 'content', content: 'done' };
      },
      abortCurrentOperation() {},
      dispose() {},
    });
    const delegation = new ThreadDelegation({ parentBudget, createAgent: factory });
    const collecting = collectEvents(delegation.events());
    const a = delegation.spawn('a');
    const b = delegation.spawn('b');
    const turns = [a.submit('a'), b.submit('b')];
    a.closeInput();
    b.closeInput();
    await Promise.all(turns);
    await delegation.close();
    await collecting;

    expect(ThreadDelegation.DEFAULT_CONCURRENCY).toBe(1);
    expect(maxActive).toBe(1);
  });

  it('uses a fair queue so a slow child cannot starve later children', async () => {
    const slowRelease = deferred();
    const quickTwoDone = deferred();
    const order: string[] = [];
    const factory: ThreadDelegateAgentFactory<TestChunk> = ({ agentId }) => ({
      async *processUserMessageStream(): AsyncGenerator<TestChunk> {
        order.push(`start:${agentId}`);
        if (agentId === 'slow') await slowRelease.promise;
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push(`done:${agentId}`);
        if (agentId === 'quick-2') quickTwoDone.resolve();
        yield { type: 'content', content: agentId };
      },
      abortCurrentOperation() {
        slowRelease.resolve();
      },
      dispose() {},
    });
    const delegation = new ThreadDelegation({
      concurrency: 2,
      parentBudget,
      createAgent: factory,
    });
    const collecting = collectEvents(delegation.events());
    const slow = delegation.spawn('slow');
    const quickOne = delegation.spawn('quick-1');
    const quickTwo = delegation.spawn('quick-2');
    const turns = [slow.submit('slow'), quickOne.submit('one'), quickTwo.submit('two')];
    slow.closeInput();
    quickOne.closeInput();
    quickTwo.closeInput();

    await quickTwoDone.promise;
    expect(order).toContain('done:quick-2');
    expect(order).not.toContain('done:slow');
    slowRelease.resolve();
    await Promise.all(turns);
    await delegation.close();
    await collecting;
  });

  it('admits three queued children in arrival order with concurrency one', async () => {
    const activeStarted = deferred();
    const activeRelease = deferred();
    const admissionOrder: string[] = [];
    const factory: ThreadDelegateAgentFactory<TestChunk> = ({ agentId }) => ({
      async *processUserMessageStream(): AsyncGenerator<TestChunk> {
        admissionOrder.push(agentId);
        if (agentId === 'active') {
          activeStarted.resolve();
          await activeRelease.promise;
        }
        yield { type: 'content', content: agentId };
      },
      abortCurrentOperation() {},
      dispose() {},
    });
    const delegation = new ThreadDelegation({
      concurrency: 1,
      parentBudget,
      createAgent: factory,
    });
    const collecting = collectEvents(delegation.events());
    const active = delegation.spawn('active');
    const first = delegation.spawn('first');
    const second = delegation.spawn('second');
    const third = delegation.spawn('third');

    const activeTurn = active.submit('active');
    await activeStarted.promise;
    const firstTurn = first.submit('first');
    const secondTurn = second.submit('second');
    const thirdTurn = third.submit('third');

    // Let all three workers reach the semaphore before releasing the active turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    activeRelease.resolve();
    active.closeInput();
    first.closeInput();
    second.closeInput();
    third.closeInput();

    await Promise.all([activeTurn, firstTurn, secondTurn, thirdTurn]);
    await delegation.close();
    await collecting;

    expect(admissionOrder).toEqual(['active', 'first', 'second', 'third']);
  });

  it('derives finite child limits that are lower than finite parent limits', () => {
    const child = deriveChildThreadBudget(parentBudget);
    expect(child.maxTurns).toBeLessThan(parentBudget.maxTurns);
    expect(child.maxCostUsd).toBeLessThan(parentBudget.maxCostUsd);
    expect(child.maxContextTokens).toBeLessThan(parentBudget.maxContextTokens);

    const fromUnlimited = deriveChildThreadBudget({
      maxTurns: Number.POSITIVE_INFINITY,
      maxCostUsd: Number.POSITIVE_INFINITY,
      maxContextTokens: Number.POSITIVE_INFINITY,
    });
    expect(Number.isFinite(fromUnlimited.maxTurns)).toBe(true);
    expect(Number.isFinite(fromUnlimited.maxCostUsd)).toBe(true);
    expect(Number.isFinite(fromUnlimited.maxContextTokens)).toBe(true);
  });
});
