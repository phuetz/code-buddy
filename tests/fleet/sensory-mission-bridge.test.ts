import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/events/event-bus.js';
import { createMissionObservationRoomPublisher, wireSensoryMissionBridge, type MissionObservation } from '../../src/fleet/sensory-mission-bridge.js';

describe('outbound sensory mission observations', () => {
  let bus: EventBus;
  let stop: () => void;
  const publish = vi.fn<(observation: MissionObservation, signal: AbortSignal) => Promise<void>>();
  function start(overrides = {}) {
    stop = wireSensoryMissionBridge({ enabled: true, missionId: 'robot:mission-1', bus, publish, intervalMs: 1000, ...overrides });
  }
  function emit(payload: Record<string, unknown> = { load1: 2 }, source = 'buddy-sense', kind = 'heartbeat', modality = 'vital') {
    bus.emit('sensory:perception', { source, metadata: { kind, modality, payload, tsMs: 42 } });
  }
  beforeEach(() => { vi.useFakeTimers(); bus = new EventBus(); publish.mockReset().mockResolvedValue(); stop = () => {}; });
  afterEach(() => { stop(); bus.dispose(); vi.useRealTimers(); });

  it.each([{ enabled: false }, { enabled: undefined }, { missionId: undefined }, { missionId: '../escape' }])('does nothing without explicit configuration %j', async (options) => {
    const subscribe = vi.spyOn(bus, 'on');
    start(options); emit();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(subscribe).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('publishes a structured snapshot with mission and stable provenance only', async () => {
    start();
    emit({ load1: 2, transcript: 'private', image: 'base64', lat: 12, command: 'move', beat: 10 });
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toEqual({ id: expect.any(String), missionId: 'robot:mission-1', type: 'observation', source: 'buddy-sense', kind: 'heartbeat', receivedAt: expect.any(Number), observedAt: 42, values: { load1: 2 } });
  });
  it('rejects remote, domain, missing sources and all non-vital kinds', async () => {
    start();
    for (const source of ['remote', 'domain-bridge', '', 'peer:robot']) emit({ load1: 2 }, source);
    emit({ load1: 2 }, 'buddy-sense', 'transcript_final', 'audio');
    emit({ load1: 2 }, 'buddy-sense', 'heartbeat', 'vision');
    emit({ load1: 2 }, 'system-vitals', 'heartbeat', 'system');
    await vi.advanceTimersByTimeAsync(5000);
    expect(publish).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -1, '2', { command: 'move' }])('rejects invalid allowlisted values %j', async (load1) => {
    start(); emit({ load1 }); await vi.advanceTimersByTimeAsync(1000);
    expect(publish).not.toHaveBeenCalled();
  });
  it('coalesces a burst to latest status and deduplicates delivered changes', async () => {
    start(); for (let i = 0; i < 1000; i++) emit({ load1: i });
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0].values).toEqual({ load1: 999 });
    emit({ load1: 999, beat: 2000 }); await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    emit({ load1: 1000 }); await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it('bounds a slow publisher to one in flight and four latest kinds', async () => {
    let resolve!: () => void;
    publish.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
    start(); emit(); await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 1000; i++) {
      emit({ load1: i });
      emit({ diskPct: 90 }, 'system-vitals', 'disk_low', 'system');
      emit({ rssMb: i }, 'system-vitals', 'resource_threshold', 'system');
      emit({ fleetUtilization: 1 }, 'system-vitals', 'fleet_saturated', 'system');
    }
    await vi.advanceTimersByTimeAsync(10000); expect(publish).toHaveBeenCalledTimes(1);
    resolve(); await vi.advanceTimersByTimeAsync(4000);
    expect(publish).toHaveBeenCalledTimes(5);
  });
  it('retries failed delivery at most three times with the same id', async () => {
    publish.mockRejectedValue(new Error('offline'));
    start(); emit(); await vi.advanceTimersByTimeAsync(10000);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(new Set(publish.mock.calls.map(([o]) => o.id)).size).toBe(1);
  });
  it('handles a synchronous publisher failure and stops queued work before it starts', async () => {
    publish.mockImplementationOnce(() => { throw new Error('offline'); });
    start(); emit(); await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    stop(); await vi.advanceTimersByTimeAsync(5000);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('does not lose a return to the previous state while another state is publishing', async () => {
    start(); emit({ load1: 1 }); await vi.advanceTimersByTimeAsync(1000);
    let resolve!: () => void;
    publish.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
    emit({ load1: 2 }); await vi.advanceTimersByTimeAsync(1000);
    emit({ load1: 1 }); resolve(); await vi.advanceTimersByTimeAsync(1000);
    expect(publish.mock.calls.map(([o]) => o.values.load1)).toEqual([1, 2, 1]);
  });
  it('tears down subscription and aborts pending publication without emitting perceptions', async () => {
    publish.mockImplementation(() => new Promise(() => {}));
    start(); emit(); await vi.advanceTimersByTimeAsync(1000);
    const off = vi.spyOn(bus, 'off'); const emitter = vi.spyOn(bus, 'emit');
    const call = publish.mock.calls[0];
    if (!call) throw new Error('Expected an in-flight publication');
    const signal = call[1];
    stop(); stop();
    expect(off).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(true);
    expect(emitter).not.toHaveBeenCalled();
    emit({ load1: 9 }); await vi.advanceTimersByTimeAsync(10000);
    expect(publish).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('publishes identical room content and timestamp on retry after an ambiguous acceptance', async () => {
    const send = vi.fn<(room: string, content: string, createdAt: number, signal: AbortSignal) => Promise<void>>()
      .mockRejectedValueOnce(new Error('acceptance lost')).mockResolvedValue();
    const onPerception = vi.fn(); bus.on('sensory:perception', onPerception);
    start({ publish: createMissionObservationRoomPublisher('robot-status', send), now: () => 12_345 });
    emit(); await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    const [room, content, createdAt] = send.mock.calls[0]!;
    expect(room).toBe('robot-status'); expect(createdAt).toBe(12);
    expect(JSON.parse(content)).toMatchObject({ id: expect.any(String), missionId: 'robot:mission-1', type: 'observation', receivedAt: 12_345, observedAt: 42 });
    expect(onPerception).toHaveBeenCalledTimes(1);
  });
  it('keeps room publish failures visible and refuses aborted sends', async () => {
    const send = vi.fn().mockRejectedValue(new Error('restricted: access revoked'));
    const callback = createMissionObservationRoomPublisher('robot-status', send);
    const observation: MissionObservation = { id: 'id', missionId: 'mission', type: 'observation', source: 'buddy-sense', kind: 'heartbeat', receivedAt: 1234, values: { load1: 2 } };
    const controller = new AbortController();
    await expect(callback(observation, controller.signal)).rejects.toThrow('access revoked');
    controller.abort();
    await expect(callback(observation, controller.signal)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(() => createMissionObservationRoomPublisher('../private', send)).toThrow('Invalid observation room');
  });
});
