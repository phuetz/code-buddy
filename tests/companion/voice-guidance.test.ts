/**
 * Voice guidance store tests — pure add/dedup/cap + format + round-trip.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addVoiceGuidance,
  formatVoiceGuidance,
  loadVoiceGuidance,
  saveVoiceGuidance,
  MAX_VOICE_GUIDANCE,
  type VoiceGuidanceItem,
} from '../../src/companion/voice-guidance.js';

describe('addVoiceGuidance', () => {
  it('adds newest-first', () => {
    const a = addVoiceGuidance('un', 1, []);
    const b = addVoiceGuidance('deux', 2, a);
    expect(b.map((x) => x.text)).toEqual(['deux', 'un']);
  });

  it('dedups case-insensitively (moves to front)', () => {
    const list = addVoiceGuidance('Réponds court', 2, [{ text: 'réponds court', at: 1 }]);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ text: 'Réponds court', at: 2 });
  });

  it('caps at MAX_VOICE_GUIDANCE', () => {
    let list: VoiceGuidanceItem[] = [];
    for (let i = 0; i < MAX_VOICE_GUIDANCE + 3; i++) list = addVoiceGuidance(`g${i}`, i, list);
    expect(list).toHaveLength(MAX_VOICE_GUIDANCE);
    expect(list[0].text).toBe(`g${MAX_VOICE_GUIDANCE + 2}`); // newest kept
  });

  it('is a no-op for empty/whitespace', () => {
    expect(addVoiceGuidance('   ', 1, [{ text: 'x', at: 0 }])).toEqual([{ text: 'x', at: 0 }]);
  });
});

describe('formatVoiceGuidance', () => {
  it('returns null when empty', () => {
    expect(formatVoiceGuidance([])).toBeNull();
  });

  it('renders a <voice_guidance> block', () => {
    const s = formatVoiceGuidance([{ text: 'Réponds en une phrase.', at: 1 }]);
    expect(s).toContain('<voice_guidance>');
    expect(s).toContain('- Réponds en une phrase.');
    expect(s).toContain('</voice_guidance>');
  });
});

describe('load/save round-trip', () => {
  it('persists and reloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vg-'));
    const path = join(dir, 'voice-guidance.json');
    saveVoiceGuidance([{ text: 'aller droit au but', at: 5 }], path);
    expect(loadVoiceGuidance(path)).toEqual([{ text: 'aller droit au but', at: 5 }]);
  });

  it('returns [] for a missing file', () => {
    expect(loadVoiceGuidance(join(tmpdir(), 'nope-does-not-exist.json'))).toEqual([]);
  });
});
