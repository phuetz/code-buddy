import { describe, expect, it } from 'vitest';

import { VoiceTurnCoordinator } from '../../src/sensory/voice-turn-coordinator.js';

describe('VoiceTurnCoordinator', () => {
  it('correlates a full turn and persists no raw speech', () => {
    let now = 1_700_000_000_000;
    const coordinator = new VoiceTurnCoordinator({ persist: false, now: () => now++ });

    coordinator.transition('voice_1', 'listening', { aecActive: true });
    coordinator.transition('voice_1', 'transcribing', { captureMs: 734 });
    coordinator.transition('voice_1', 'deciding', {
      decisionReason: 'addressed',
      wordCount: 8,
    });
    coordinator.transition('voice_1', 'thinking');
    coordinator.transition('voice_1', 'speaking', { firstAudioMs: 420 });
    const snapshot = coordinator.transition('voice_1', 'completed', {
      spoke: true,
      totalMs: 1_480,
    });

    expect(snapshot.phase).toBe('completed');
    expect(snapshot.activeTurnId).toBeUndefined();
    expect(snapshot.counters).toEqual({
      captured: 1,
      accepted: 1,
      spoken: 1,
      suppressed: 0,
      interrupted: 0,
      failed: 0,
      abandoned: 0,
    });
    expect(JSON.stringify(snapshot)).not.toContain('raw speech');
  });

  it('bounds history and sanitizes free-form reasons', () => {
    const coordinator = new VoiceTurnCoordinator({ persist: false, maxRecent: 8 });
    for (let index = 0; index < 12; index++) {
      coordinator.transition(`turn_${index}`, 'suppressed', {
        suppressionReason: 'Echo from speakers: secret sentence',
      });
    }
    const snapshot = coordinator.snapshot();
    expect(snapshot.recent).toHaveLength(8);
    expect(snapshot.recent.at(-1)?.suppressionReason).toBe(
      'echo-from-speakers-secret-sentence',
    );
    expect(snapshot.counters.suppressed).toBe(12);
  });

  it('keeps a newer acoustic turn active when the previous turn finishes', () => {
    const coordinator = new VoiceTurnCoordinator({ persist: false });
    coordinator.transition('turn_1', 'thinking');
    coordinator.transition('turn_2', 'listening');
    const snapshot = coordinator.transition('turn_1', 'completed', { spoke: true });

    expect(snapshot.phase).toBe('listening');
    expect(snapshot.activeTurnId).toBe('turn_2');
  });

  // Audit 2026-09-24, B1: every caller path that never closes a turn used to
  // leave it active forever (≈ 6 500 in 36 h), the phase stuck on `listening`.
  it('does not let never-closed listening turns pile up or pin the phase', () => {
    let now = 1_700_000_000_000;
    const coordinator = new VoiceTurnCoordinator({ persist: false, now: () => now++ });
    for (let index = 0; index < 1000; index++) {
      coordinator.transition(`echo_${index}`, 'listening');
    }
    coordinator.transition('real', 'listening');
    coordinator.transition('real', 'thinking');
    const snapshot = coordinator.transition('real', 'completed', { spoke: true });

    expect(snapshot.phase).toBe('completed');
    expect(snapshot.activeTurnId).toBeUndefined();
    expect(snapshot.counters.abandoned).toBe(1000);
  });

  it('expires a listening turn that stays silent for 30 s', () => {
    let now = 1_700_000_000_000;
    const coordinator = new VoiceTurnCoordinator({ persist: false, now: () => now });
    coordinator.transition('ghost', 'listening');
    now += 31_000;
    coordinator.transition('other', 'thinking');
    const snapshot = coordinator.transition('other', 'completed');

    expect(snapshot.phase).toBe('completed');
    expect(snapshot.activeTurnId).toBeUndefined();
    expect(snapshot.counters.abandoned).toBe(1);
  });

  it('keeps a long agent turn active while it is still under 15 minutes', () => {
    let now = 1_700_000_000_000;
    const coordinator = new VoiceTurnCoordinator({ persist: false, now: () => now });
    coordinator.transition('agent', 'thinking');
    now += 10 * 60_000;
    coordinator.transition('ping', 'listening');
    const snapshot = coordinator.transition('ping', 'suppressed');

    expect(snapshot.phase).toBe('thinking');
    expect(snapshot.activeTurnId).toBe('agent');
    expect(snapshot.counters.abandoned).toBe(0);
  });
});
