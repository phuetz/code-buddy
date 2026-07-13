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
  selectLearnableHearingTexts,
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

describe('selectLearnableHearingTexts', () => {
  it('keeps addressed dialogue and rejects ambient television transcripts', () => {
    const heard = selectLearnableHearingTexts(
      [
        {
          summary: 'Heard: Je vous attends après la publicité',
          payload: { text: 'Je vous attends après la publicité', responded: false, decisionReason: 'ambient' },
        },
        {
          summary: 'Heard: Buddy, prépare mon résumé',
          payload: { text: 'Buddy, prépare mon résumé', responded: true, decisionReason: 'addressed' },
        },
        {
          summary: 'Heard: Pour vous qui regardez cette émission',
          payload: { text: 'Pour vous qui regardez cette émission', responded: false, decisionReason: 'ambient-in-window' },
        },
        {
          summary: 'Speech captured; STT returned no text',
          payload: { text: '', responded: true, sttEmpty: true },
        },
        {
          summary: 'Heard: Oui, continue',
          payload: { text: 'Oui, continue', responded: true, decisionReason: 'engaged' },
        },
      ],
      20
    );

    expect(heard).toEqual(['Buddy, prépare mon résumé', 'Oui, continue']);
  });

  it('uses summaries for legacy addressed percepts and keeps the newest bounded sample', () => {
    const heard = selectLearnableHearingTexts(
      [
        { summary: 'Heard: un', payload: { responded: true } },
        { summary: 'Heard: deux', payload: { responded: true } },
        { summary: 'Heard: trois', payload: { responded: true } },
      ],
      2
    );

    expect(heard).toEqual(['deux', 'trois']);
    expect(selectLearnableHearingTexts([], 0)).toEqual([]);
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
      dedupeStatePath: join(dir, 'voice-improvement-state.json'),
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

  it('reflects the same addressed dialogue only once in behavioral mode', async () => {
    const t = tmp();
    const reflectOnce = vi.fn(reflect);

    const first = await runVoiceImprovementCycle({
      mode: 'behavioral',
      readHeard: heard,
      reflect: reflectOnce,
      ...t,
    });
    const repeated = await runVoiceImprovementCycle({
      mode: 'behavioral',
      readHeard: heard,
      reflect: reflectOnce,
      ...t,
    });

    expect(first?.conversationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated).toBeNull();
    expect(reflectOnce).toHaveBeenCalledTimes(1);
  });

  it('reflects again when a new addressed turn changes the dialogue window', async () => {
    const t = tmp();
    const reflectTwice = vi.fn(reflect);
    let dialogue = ['salut', 'raconte-moi une blague'];
    const readHeard = async (): Promise<string[]> => dialogue;

    await runVoiceImprovementCycle({ mode: 'behavioral', readHeard, reflect: reflectTwice, ...t });
    dialogue = [...dialogue, 'merci'];
    const updated = await runVoiceImprovementCycle({
      mode: 'behavioral',
      readHeard,
      reflect: reflectTwice,
      ...t,
    });

    expect(updated).not.toBeNull();
    expect(reflectTwice).toHaveBeenCalledTimes(2);
  });
});
