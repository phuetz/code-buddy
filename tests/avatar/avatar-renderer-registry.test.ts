import { describe, expect, it } from 'vitest';

import {
  AvatarRendererRegistry,
  shouldStreamAvatarAudio,
} from '../../src/avatar/avatar-renderer-registry.js';

const HELLO = {
  rendererId: 'darkstar-metahuman',
  displayName: 'Lisa MetaHuman',
  protocolVersion: 1,
  runtime: 'unreal',
  runtimeVersion: '5.8',
  project: 'D:\\DEV\\AvatarStudio',
  capabilities: {
    audioDrivenAnimation: true,
    wavStream: true,
    affect: true,
    gestures: true,
    gaze: true,
    interruptionAck: true,
  },
};

describe('avatar renderer registry', () => {
  it('registers capabilities and accepts bounded playback feedback on the same connection', () => {
    const registry = new AvatarRendererRegistry();
    const registered = registry.register('ws-1', HELLO, new Date('2026-07-13T12:00:00Z'));
    expect(registered).toMatchObject({
      ok: true,
      renderer: {
        rendererId: 'darkstar-metahuman',
        runtime: 'unreal',
        runtimeVersion: '5.8',
        phase: 'ready',
        connected: true,
        capabilities: { wavStream: true, interruptionAck: true },
      },
    });

    const status = registry.report(
      'ws-1',
      {
        rendererId: 'darkstar-metahuman',
        phase: 'playing',
        activeTurnId: 'turn-1',
        lastSequence: 12,
        fps: 59.8,
        audioBufferMs: 84,
        mouthLatencyMs: 37,
        droppedAudioChunks: 0,
      },
      new Date('2026-07-13T12:00:01Z')
    );
    expect(status).toMatchObject({
      ok: true,
      renderer: {
        phase: 'playing',
        activeTurnId: 'turn-1',
        lastSequence: 12,
        fps: 59.8,
        mouthLatencyMs: 37,
      },
    });
    expect(JSON.stringify(status)).not.toContain('ws-1');
  });

  it('rejects spoofed status, unsafe ids, and incompatible protocol versions', () => {
    const registry = new AvatarRendererRegistry();
    expect(registry.register('ws-1', { ...HELLO, rendererId: '../escape' })).toMatchObject({
      ok: false,
    });
    expect(registry.register('ws-1', { ...HELLO, protocolVersion: 2 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('expected 1'),
    });
    expect(registry.register('ws-1', HELLO).ok).toBe(true);
    expect(
      registry.report('ws-attacker', {
        rendererId: 'darkstar-metahuman',
        phase: 'playing',
      })
    ).toMatchObject({ ok: false, error: expect.stringContaining('hello') });
  });

  it('marks a renderer unavailable when its Gateway connection closes', () => {
    const registry = new AvatarRendererRegistry();
    registry.register('ws-1', HELLO, new Date('2026-07-13T12:00:00Z'));
    registry.disconnectConnection('ws-1', new Date('2026-07-13T12:00:02Z'));
    expect(registry.list(new Date('2026-07-13T12:00:02Z'))[0]).toMatchObject({
      connected: false,
      phase: 'unavailable',
      reason: 'gateway_disconnected',
      disconnectedAt: '2026-07-13T12:00:02.000Z',
    });
  });

  it('bounds registry growth and prefers evicting disconnected renderers', () => {
    const registry = new AvatarRendererRegistry(2);
    registry.register('ws-1', { ...HELLO, rendererId: 'one' });
    registry.register('ws-2', { ...HELLO, rendererId: 'two' });
    registry.disconnectConnection('ws-1');
    registry.register('ws-3', { ...HELLO, rendererId: 'three' });
    expect(registry.list().map((renderer) => renderer.rendererId).sort()).toEqual(['three', 'two']);
  });

  it('auto-enables audio only for a live compatible renderer and honors hard overrides', () => {
    const registry = new AvatarRendererRegistry();
    registry.register('ws-1', HELLO);
    expect(shouldStreamAvatarAudio({}, registry.list())).toBe(true);
    expect(shouldStreamAvatarAudio({ CODEBUDDY_AVATAR_STREAM_AUDIO: 'false' }, registry.list()))
      .toBe(false);
    expect(shouldStreamAvatarAudio({ CODEBUDDY_AVATAR_STREAM_AUDIO: 'true' }, [])).toBe(true);
    registry.disconnectConnection('ws-1');
    expect(shouldStreamAvatarAudio({ CODEBUDDY_AVATAR_STREAM_AUDIO: 'auto' }, registry.list()))
      .toBe(false);
  });
});
