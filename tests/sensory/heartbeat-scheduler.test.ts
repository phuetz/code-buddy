import { describe, it, expect } from 'vitest';
import { HeartbeatScheduler } from '../../src/sensory/heartbeat-scheduler.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

function beat(n: number): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'vital', kind: 'heartbeat', payload: { beat: n, uptime_ms: n * 100, load1: 0.5 } },
  });
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('HeartbeatScheduler — heartbeat-paced treatments', () => {
  it('fires a treatment every N beats', async () => {
    const s = new HeartbeatScheduler();
    const fired: number[] = [];
    s.register({ name: 'every3', everyBeats: 3, handler: (ctx) => void fired.push(ctx.beat) });
    s.start();
    try {
      // Beats are spaced (as they are in reality, ~1s apart) so each is processed before the next —
      // a synchronous burst would be the overlap case the in-flight guard deliberately collapses.
      for (let n = 1; n <= 6; n++) {
        beat(n);
        await tick();
      }
      expect(fired).toEqual([3, 6]); // fired on beats 3 and 6
    } finally {
      s.stop();
    }
  });

  it('runs multiple treatments at different cadences, and passes vital signs', async () => {
    const s = new HeartbeatScheduler();
    const fast: number[] = [];
    let lastLoad: number | null | undefined;
    s.register({ name: 'every1', everyBeats: 1, handler: (ctx) => void fast.push(ctx.beat) });
    s.register({ name: 'every2', everyBeats: 2, handler: (ctx) => { lastLoad = ctx.load1; } });
    s.start();
    try {
      for (let n = 1; n <= 4; n++) {
        beat(n);
        await tick();
      }
      expect(fast).toEqual([1, 2, 3, 4]); // every beat
      expect(lastLoad).toBe(0.5); // vital sign reached the treatment
    } finally {
      s.stop();
    }
  });

  it('unregister stops a treatment; non-heartbeat events are ignored', async () => {
    const s = new HeartbeatScheduler();
    const fired: number[] = [];
    s.register({ name: 't', everyBeats: 1, handler: (ctx) => void fired.push(ctx.beat) });
    s.start();
    try {
      beat(1);
      await tick();
      s.unregister('t');
      beat(2);
      // a non-vital event must not trigger anything
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'audio', kind: 'speech_start', payload: { beat: 9 } } });
      await tick();
      expect(fired).toEqual([1]);
    } finally {
      s.stop();
    }
  });

  it('rejects an invalid cadence', () => {
    const s = new HeartbeatScheduler();
    expect(() => s.register({ name: 'bad', everyBeats: 0, handler: () => {} })).toThrow();
  });

  it('skips only the slow treatment while it is still running (no self-overlap)', async () => {
    const s = new HeartbeatScheduler();
    const runs: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    s.register({
      name: 'slow',
      everyBeats: 1,
      handler: async (ctx) => {
        runs.push(ctx.beat);
        await gate; // hold the beat "in flight" past the next beat
      },
    });
    s.start();
    try {
      beat(1); // starts the slow treatment
      await tick();
      beat(2); // arrives while beat 1 is still running → must be skipped (no overlap/race)
      await tick();
      expect(runs).toEqual([1]);
      release(); // let beat 1 finish
      await tick();
      beat(3); // a fresh, non-overlapping beat runs normally
      await tick();
      expect(runs).toEqual([1, 3]);
    } finally {
      release();
      s.stop();
    }
  });

  it('starts due organs in parallel and lets fast organs keep receiving beats', async () => {
    const s = new HeartbeatScheduler();
    const started: string[] = [];
    const fastBeats: number[] = [];
    let releaseVision!: () => void;
    let releaseMemory!: () => void;
    const visionGate = new Promise<void>((resolve) => {
      releaseVision = resolve;
    });
    const memoryGate = new Promise<void>((resolve) => {
      releaseMemory = resolve;
    });
    s.register({
      name: 'vision-organ',
      everyBeats: 1,
      handler: async () => {
        started.push('vision');
        await visionGate;
      },
    });
    s.register({
      name: 'memory-organ',
      everyBeats: 1,
      handler: async () => {
        started.push('memory');
        await memoryGate;
      },
    });
    s.register({
      name: 'reflex-organ',
      everyBeats: 1,
      handler: (ctx) => {
        fastBeats.push(ctx.beat);
      },
    });
    s.start();
    try {
      beat(1);
      await tick();
      expect(started).toEqual(['vision', 'memory']);
      expect(fastBeats).toEqual([1]);

      // Both long organs are still busy. Their own duplicate run is skipped,
      // but the independent reflex organ continues on the next heartbeat.
      beat(2);
      await tick();
      expect(started).toEqual(['vision', 'memory']);
      expect(fastBeats).toEqual([1, 2]);
    } finally {
      releaseVision();
      releaseMemory();
      s.stop();
    }
  });

  it('isolates a throwing treatment — the pacemaker keeps the others running', async () => {
    const s = new HeartbeatScheduler();
    const fired: string[] = [];
    s.register({
      name: 'bad',
      everyBeats: 1,
      handler: () => {
        throw new Error('boom');
      },
    });
    s.register({ name: 'good', everyBeats: 1, handler: () => void fired.push('good') });
    s.start();
    try {
      beat(1);
      await tick();
      expect(fired).toEqual(['good']); // the throwing treatment didn't stop the good one
    } finally {
      s.stop();
    }
  });
});
