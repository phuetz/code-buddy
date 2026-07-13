import { describe, expect, it, vi } from 'vitest';

import { AvatarEventBus } from '../../src/avatar/avatar-event-bus.js';
import {
  buildAvatarSyncMessage,
  canReadAvatarEvents,
  canReportAvatarStatus,
  wireAvatarGatewayBridge,
} from '../../src/avatar/avatar-gateway-bridge.js';
import { planAvatarPerformance } from '../../src/avatar/avatar-protocol.js';

describe('avatar Gateway bridge', () => {
  it('broadcasts performance events only through the avatar:read scope', () => {
    const bus = new AvatarEventBus();
    const broadcast = vi.fn();
    const unsubscribe = wireAvatarGatewayBridge(broadcast, bus);

    const event = bus.publish({
      type: 'avatar.turn.started',
      turnId: 'turn-1',
      cue: planAvatarPerformance('Bonjour.'),
    });

    expect(broadcast).toHaveBeenCalledWith(
      {
        type: 'avatar:event',
        payload: event,
        timestamp: event.timestamp,
      },
      'avatar:read'
    );

    unsubscribe();
    bus.publish({ type: 'avatar.turn.silent', turnId: 'turn-1' });
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('skips an unfinished turn on reconnect because its audio cannot be replayed', () => {
    const bus = new AvatarEventBus();
    const event = bus.publish({
      type: 'avatar.turn.started',
      turnId: 'turn-2',
      cue: planAvatarPerformance('Continuons.'),
    });
    const sync = buildAvatarSyncMessage(bus.history(), new Date('2026-07-13T12:00:00Z'));

    expect(sync.payload.events).toEqual([]);
    expect(sync.payload.latestSequence).toBe(event.sequence);
    expect(sync.payload.audioReplay).toBe(false);
    expect(sync.payload.recovery).toBe('replay_complete_turns_then_wait_next');
    expect(sync.payload.ignoredTurnIds).toEqual(['turn-2']);
    expect(canReadAvatarEvents(['avatar:read'])).toBe(true);
    expect(canReadAvatarEvents(['admin'])).toBe(true);
    expect(canReadAvatarEvents(['chat'])).toBe(false);
    expect(canReportAvatarStatus(['avatar:write'])).toBe(true);
    expect(canReportAvatarStatus(['admin'])).toBe(true);
    expect(canReportAvatarStatus(['avatar:read'])).toBe(false);
  });

  it('replays complete control lifecycles while keeping renderer telemetry text-free', () => {
    const bus = new AvatarEventBus();
    const cue = planAvatarPerformance('Bonjour.');
    const started = bus.publish({ type: 'avatar.turn.started', turnId: 'turn-3', cue });
    const completed = bus.publish({
      type: 'avatar.speech.completed',
      turnId: 'turn-3',
      text: 'Bonjour.',
      durationMs: 500,
    });
    const sync = buildAvatarSyncMessage(bus.history(), new Date('2026-07-13T12:00:00Z'), [
      {
        rendererId: 'darkstar',
        protocolVersion: 1,
        runtime: 'unreal',
        capabilities: {
          audioDrivenAnimation: true,
          wavStream: true,
          affect: true,
          gestures: true,
          gaze: true,
          interruptionAck: true,
        },
        phase: 'ready',
        lastSequence: completed.sequence,
        droppedAudioChunks: 0,
        connected: true,
        connectedAt: '2026-07-13T11:59:00.000Z',
        lastSeenAt: '2026-07-13T12:00:00.000Z',
      },
    ]);
    expect(sync.payload.events).toEqual([started, completed]);
    expect(sync.payload.ignoredTurnIds).toEqual([]);
    expect(sync.payload.renderers[0]).toMatchObject({ rendererId: 'darkstar', phase: 'ready' });
  });
});
