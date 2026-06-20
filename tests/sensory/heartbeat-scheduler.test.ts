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
      for (let n = 1; n <= 6; n++) beat(n);
      await tick();
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
      for (let n = 1; n <= 4; n++) beat(n);
      await tick();
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
});
