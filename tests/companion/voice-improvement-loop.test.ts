/**
 * Voice-assistant improvement loop tests — pure reflection normalization + the
 * cycle with injected heard/reflect and isolated temp stores (no LLM, no daemon).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeReflection,
  runVoiceImprovementCycle,
  type VoiceReflection,
} from '../../src/companion/voice-improvement-loop.js';
import { loadVoiceGuidance } from '../../src/companion/voice-guidance.js';
import { getUserModel, resetUserModels } from '../../src/memory/user-model.js';

describe('normalizeReflection', () => {
  it('keeps valid fields, caps facts at 3', () => {
    const r = normalizeReflection({
      facts: ['a', 'b', 'c', 'd'],
      guidance: 'Réponds court.',
      signal: 'joking',
    });
    expect(r.facts).toEqual(['a', 'b', 'c']);
    expect(r.guidance).toBe('Réponds court.');
    expect(r.signal).toBe('joking');
  });

  it('coerces an invalid/absent signal to neutral', () => {
    expect(normalizeReflection({ signal: 'ecstatic' }).signal).toBe('neutral');
    expect(normalizeReflection({}).signal).toBe('neutral');
  });

  it('drops empty/oversized facts and non-arrays', () => {
    expect(normalizeReflection({ facts: ['ok', '  ', 'x'.repeat(200)] }).facts).toEqual(['ok']);
    expect(normalizeReflection({ facts: 'nope' }).facts).toEqual([]);
  });
});

describe('runVoiceImprovementCycle', () => {
  const reflection: VoiceReflection = {
    facts: ['préfère des réponses courtes'],
    guidance: 'Réponds en une à deux phrases.',
    signal: 'joking',
  };
  const heard = async (): Promise<string[]> => ['salut', 'raconte-moi une blague'];
  const reflect = async (): Promise<VoiceReflection> => reflection;

  beforeEach(() => resetUserModels());

  function tmp() {
    const dir = mkdtempSync(join(tmpdir(), 'vil-'));
    return {
      cwd: dir,
      guidancePath: join(dir, 'voice-guidance.json'),
      relationshipStatePath: join(dir, 'relationship-state.json'),
    };
  }

  it('returns null when there is too little heard', async () => {
    const res = await runVoiceImprovementCycle({ readHeard: async () => ['un seul'], reflect });
    expect(res).toBeNull();
  });

  it('dry mode: reports but persists nothing and never accepts facts', async () => {
    const t = tmp();
    const res = await runVoiceImprovementCycle({ mode: 'dry', readHeard: heard, reflect, ...t });
    expect(res).not.toBeNull();
    expect(res!.guidanceApplied).toBe(false);
    expect(res!.acceptedFacts).toEqual([]);
    expect(loadVoiceGuidance(t.guidancePath)).toEqual([]);
    expect(getUserModel(t.cwd).getStats().byStatus.accepted).toBe(0);
  });

  it('behavioral mode: applies guidance + drift, proposes facts but does NOT accept them', async () => {
    const t = tmp();
    const res = await runVoiceImprovementCycle({
      mode: 'behavioral',
      readHeard: heard,
      reflect,
      ...t,
    });
    expect(res!.guidanceApplied).toBe(true);
    expect(res!.driftApplied).toBe(true);
    expect(loadVoiceGuidance(t.guidancePath)[0]?.text).toBe('Réponds en une à deux phrases.');
    const stats = getUserModel(t.cwd).getStats();
    expect(stats.byStatus.accepted).toBe(0); // heartbeat never accepts
    expect(stats.byStatus.pending).toBeGreaterThan(0); // proposed, pending review
  });

  it('all mode: accepts the proposed facts (explicit human --apply)', async () => {
    const t = tmp();
    const res = await runVoiceImprovementCycle({ mode: 'all', readHeard: heard, reflect, ...t });
    expect(res!.acceptedFacts).toEqual(['préfère des réponses courtes']);
    expect(getUserModel(t.cwd).getStats().byStatus.accepted).toBeGreaterThan(0);
  });
});
