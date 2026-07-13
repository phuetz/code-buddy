import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookingTimerStore } from '../../src/life-rhythm/cooking-timer-store.js';
import {
  resetCookingTimerRunnerState,
  runCookingTimerTick,
} from '../../src/companion/cooking-timer-runner.js';

describe('cooking timer runner', () => {
  let dir: string;
  let clock: Date;
  let store: CookingTimerStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cooking-runner-'));
    clock = new Date('2026-07-12T12:00:00.000Z');
    store = new CookingTimerStore({
      filePath: join(dir, 'timers.json'),
      now: () => new Date(clock),
    });
    resetCookingTimerRunnerState();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('announces a named due timer and keeps it pending for acknowledgement', async () => {
    const started = await store.start(1_000, 'pâtes');
    clock = new Date(clock.getTime() + 1_000);
    const say = vi.fn(async () => undefined);

    const due = await runCookingTimerTick(clock, {
      store,
      say,
      homeMode: async () => 'normal',
      conductor: { claim: () => true },
    });

    expect(due?.id).toBe(started.id);
    expect(say).toHaveBeenCalledWith('Le minuteur « pâtes » est terminé.');
    expect(await store.due(clock)).toHaveLength(1);
  });

  it('bounds repeats and retries after the reminder interval', async () => {
    await store.start(1_000, 'four');
    clock = new Date(clock.getTime() + 1_000);
    const say = vi.fn(async () => undefined);
    const deps = {
      store,
      say,
      homeMode: async () => 'normal' as const,
      conductor: { claim: () => true },
      repeatMs: 5_000,
    };

    expect(await runCookingTimerTick(clock, deps)).toBeTruthy();
    expect(await runCookingTimerTick(new Date(clock.getTime() + 1_000), deps)).toBeNull();
    expect(await runCookingTimerTick(new Date(clock.getTime() + 5_000), deps)).toBeTruthy();
    expect(say).toHaveBeenCalledTimes(2);
  });

  it('does not consume or mark a timer announced when speech fails', async () => {
    await store.start(1_000, 'riz');
    clock = new Date(clock.getTime() + 1_000);
    const failed = await runCookingTimerTick(clock, {
      store,
      say: async () => { throw new Error('audio unavailable'); },
      homeMode: async () => 'normal',
      conductor: { claim: () => true },
    });
    const retrySay = vi.fn(async () => undefined);
    const retried = await runCookingTimerTick(clock, {
      store,
      say: retrySay,
      homeMode: async () => 'normal',
      conductor: { claim: () => true },
    });
    expect(failed).toBeNull();
    expect(retried).toBeTruthy();
    expect(retrySay).toHaveBeenCalledTimes(1);
  });

  it('reserves a due timer before slow speech so concurrent ticks announce once', async () => {
    await store.start(1_000, 'sauce');
    clock = new Date(clock.getTime() + 1_000);
    let releaseSpeech!: () => void;
    const speechGate = new Promise<void>((resolve) => { releaseSpeech = resolve; });
    let markSpeechStarted!: () => void;
    const speechStarted = new Promise<void>((resolve) => { markSpeechStarted = resolve; });
    const say = vi.fn(() => {
      markSpeechStarted();
      return speechGate;
    });
    const deps = {
      store,
      say,
      homeMode: async () => 'normal' as const,
      conductor: { claim: () => true },
    };

    const first = runCookingTimerTick(clock, deps);
    await speechStarted;
    const second = await runCookingTimerTick(clock, deps);
    releaseSpeech();
    await first;

    expect(second).toBeNull();
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('hides the timer label in guest mode', async () => {
    await store.start(1_000, 'médicaments privés');
    clock = new Date(clock.getTime() + 1_000);
    const say = vi.fn(async () => undefined);
    await runCookingTimerTick(clock, {
      store,
      say,
      homeMode: async () => 'guests',
      conductor: { claim: () => true },
    });
    expect(say).toHaveBeenCalledWith('Un minuteur de cuisine est terminé.');
    expect(say.mock.calls[0]![0]).not.toContain('médicaments');
  });

  it('routes a due timer to the phone in away mode', async () => {
    await store.start(1_000, 'four');
    clock = new Date(clock.getTime() + 1_000);
    const say = vi.fn(async () => undefined);
    const notify = vi.fn(async () => undefined);
    await runCookingTimerTick(clock, {
      store,
      say,
      notify,
      homeMode: async () => 'away',
    });
    expect(say).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('four'));
  });
});
