/**
 * The camera Telegram captions must not be the exact same phrase every time.
 * Both pickers rotate over a pool and never repeat consecutively.
 */
import { describe, it, expect } from 'vitest';
import { CAMERA_MESSAGES, pickCameraMessage } from '../../src/sensory/semantic-vision-reaction.js';
import { MOTION_PREFIXES, pickMotionPrefix } from '../../src/sensory/vision-reaction.js';

// Deterministic pseudo-rng.
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('camera alert captions are varied', () => {
  it('pickCameraMessage stays in the pool and never repeats consecutively', () => {
    const rng = seeded(7);
    let prev = '';
    for (let i = 0; i < 40; i++) {
      const msg = pickCameraMessage('person_entered', rng);
      expect(CAMERA_MESSAGES.person_entered).toContain(msg);
      expect(msg, `consecutive repeat at ${i}`).not.toBe(prev);
      prev = msg;
    }
  });

  it('each event kind has a rich pool (>= 3 phrasings)', () => {
    for (const kind of Object.keys(CAMERA_MESSAGES)) {
      expect(CAMERA_MESSAGES[kind]!.length, kind).toBeGreaterThanOrEqual(3);
      expect(new Set(CAMERA_MESSAGES[kind]).size, `${kind} dupes`).toBe(CAMERA_MESSAGES[kind]!.length);
    }
  });

  it('an unknown kind returns the kind itself (no crash)', () => {
    expect(pickCameraMessage('unknown-kind')).toBe('unknown-kind');
  });

  it('pickMotionPrefix rotates without consecutive repeats', () => {
    const rng = seeded(3);
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const p = pickMotionPrefix(rng);
      expect(MOTION_PREFIXES).toContain(p);
      expect(p, `consecutive repeat at ${i}`).not.toBe(prev);
      prev = p;
    }
  });
});
