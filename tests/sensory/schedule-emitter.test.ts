/**
 * Schedule emitter (Phase 3) — hermetic, injected clock, no real timers.
 * Proves: a tick carries the right hhmm/weekday/minuteOfDay, the injected emit
 * is used (no global-bus side effect), and never-throws.
 */
import { describe, expect, it } from 'vitest';
import {
  runSchedulePass,
  tickPayloadOf,
  type TickPayload,
} from '../../src/sensory/schedule-emitter.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

describe('tickPayloadOf (pure)', () => {
  it('computes hhmm/weekday/minuteOfDay from a local Date', () => {
    // 2026-09-05 is a Saturday (getDay() === 6). 04:20 local.
    const p = tickPayloadOf(new Date(2026, 8, 5, 4, 20, 0));
    expect(p.hhmm).toBe('04:20');
    expect(p.weekday).toBe(6);
    expect(p.minuteOfDay).toBe(4 * 60 + 20);
    expect(typeof p.iso).toBe('string');
  });

  it('zero-pads single-digit hours and minutes', () => {
    const p = tickPayloadOf(new Date(2026, 0, 1, 9, 5, 0)); // 2026-01-01 09:05
    expect(p.hhmm).toBe('09:05');
    expect(p.weekday).toBe(4); // Thursday
    expect(p.minuteOfDay).toBe(9 * 60 + 5);
  });
});

describe('runSchedulePass', () => {
  it('emits ONE tick with the injected clock via the injected emit', () => {
    const emitted: TickPayload[] = [];
    const out = runSchedulePass({
      now: () => new Date(2026, 8, 5, 4, 20, 0),
      emit: (payload) => emitted.push(payload),
    });
    expect(out).not.toBeNull();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ hhmm: '04:20', weekday: 6, minuteOfDay: 260 });
  });

  it('a fully-injected pass never touches the real global bus', () => {
    const seen: unknown[] = [];
    const bus = getGlobalEventBus();
    const id = bus.on('sensory:perception', (evt) => seen.push(evt));
    runSchedulePass({
      now: () => new Date(2026, 8, 5, 12, 0, 0),
      emit: () => {
        /* swallow */
      },
    });
    bus.off(id);
    expect(seen).toHaveLength(0);
  });

  it('never throws when the clock throws (flag off / broken clock) → returns null', () => {
    const out = runSchedulePass({
      now: () => {
        throw new Error('no clock');
      },
    });
    expect(out).toBeNull();
  });
});
