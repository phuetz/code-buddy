/**
 * I3 — confidence-gated register (MySoulmate's confidence idea, ported additively).
 * A lone ambiguous token stays at the gentle register; a strongly-corroborated read (or an explicit
 * intensity marker) escalates. Backward-compatible: `.emotion`/`.intensity` are unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  detectEmotion,
  emotionGuidance,
  STRONG_EMOTION_CONFIDENCE,
} from '../../src/companion/reply-augment.js';

describe('detectEmotion confidence', () => {
  it('is 0 for neutral / empty', () => {
    expect(detectEmotion('quelle heure est-il').confidence).toBe(0);
    expect(detectEmotion('').confidence).toBe(0);
  });

  it('is modest for a lone token', () => {
    const read = detectEmotion('je galère un peu');
    expect(read.emotion).toBe('frustration');
    expect(read.intensity).toBe('normal');
    expect(read.confidence).toBeLessThan(STRONG_EMOTION_CONFIDENCE);
    expect(read.confidence).toBeGreaterThan(0.5);
  });

  it('climbs with an intensity marker', () => {
    const weak = detectEmotion('je galère').confidence ?? 0;
    const strong = detectEmotion('je galère vraiment').confidence ?? 0;
    expect(strong).toBeGreaterThan(weak);
  });

  it('climbs with corroborating markers', () => {
    const read = detectEmotion('je galère, je bloque, j’y arrive pas');
    expect(read.emotion).toBe('frustration');
    expect(read.confidence).toBeGreaterThanOrEqual(STRONG_EMOTION_CONFIDENCE);
  });
});

describe('emotionGuidance escalation', () => {
  it('escalates on explicit high intensity (unchanged)', () => {
    expect(emotionGuidance({ emotion: 'frustration', intensity: 'high' })).toMatch(
      /vraiment affecté/i
    );
  });

  it('does NOT escalate a lone normal-intensity token', () => {
    const g = emotionGuidance(detectEmotion('je galère un peu'));
    expect(g).not.toMatch(/vraiment affecté/i);
  });

  it('escalates a strongly-corroborated read even without an intensity word', () => {
    const g = emotionGuidance(detectEmotion('je galère, je bloque, j’y arrive pas'));
    expect(g).toMatch(/vraiment affecté/i);
  });

  it('ignores confidence for a bare literal (backward-compatible)', () => {
    // No confidence field → treated as not-strong.
    expect(emotionGuidance({ emotion: 'sadness', intensity: 'normal' })).not.toMatch(
      /priorité absolue/i
    );
  });
});
