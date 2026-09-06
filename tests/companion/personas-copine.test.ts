/**
 * C8 — persona « copine » : pools + spokenPrompt, opt-in, byte-identique par défaut.
 * Fixtures génériques (pas de prénom, pas de nom d'animal, pas de donnée de santé).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COPINE_PERSONA,
  companionPersonaId,
  interpolatePersonaName,
  isCopinePersona,
  resolveCompanionPersona,
} from '../../src/companion/personas/index.js';
import { emotionGuidance, detectEmotion } from '../../src/companion/reply-augment.js';
import {
  buildCompanionVoiceCharacterBlock,
  buildProgressiveIntimacyGuidance,
} from '../../src/companion/companion-voice-character.js';
import {
  buildArrivalOpener,
  templatePool,
} from '../../src/sensory/arrival-opener.js';
import { getActivePersonaVoice, resetPersonaManager } from '../../src/personas/persona-manager.js';

const INTIMATE =
  /tabou|sensuel|sensuelle|explicite|sexe|nude|nues?|déshabill|mon amour|chéri|cheri|18\+|sans tabous/i;
const JARGON = /<[^>]+>|\/100|\blisa_state\b|\brapportTier\b/i;
const FIRST_NAME = /\b(patrice|ambre)\b/i;

const morningNow = new Date(2026, 5, 30, 8, 0, 0).getTime();

const DEFAULT_MORNING_FIRST = 'Bonjour {{name}}. Contente de commencer la journée avec toi.';

describe('C8 companion persona resolver', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    delete process.env.CODEBUDDY_USER_NAME;
  });

  it('unset / unknown → null (persona actuelle)', () => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    expect(companionPersonaId()).toBeNull();
    expect(isCopinePersona()).toBe(false);
    expect(resolveCompanionPersona()).toBeNull();

    process.env.CODEBUDDY_COMPANION_PERSONA = 'debugger';
    expect(resolveCompanionPersona()).toBeNull();
  });

  it('CODEBUDDY_COMPANION_PERSONA=copine → profil copine', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    expect(isCopinePersona()).toBe(true);
    const profile = resolveCompanionPersona();
    expect(profile?.id).toBe('copine');
    expect(profile?.spokenPrompt).toMatch(/petite copine/i);
    expect(profile?.spokenPrompt).not.toMatch(INTIMATE);
    expect(profile?.spokenPrompt).not.toMatch(JARGON);
  });

  it('interpolatePersonaName drops {{name}} without CODEBUDDY_USER_NAME (no hardcoded first name)', () => {
    delete process.env.CODEBUDDY_USER_NAME;
    expect(interpolatePersonaName('Bonjour {{name}}.')).toBe('Bonjour.');
    process.env.CODEBUDDY_USER_NAME = 'toi';
    expect(interpolatePersonaName('Bonjour {{name}}.')).toBe('Bonjour toi.');
  });
});

describe('C8 copine profile is diversified data, not intimate code', () => {
  it('every greeting pool has ≥ 7 unique lines, no intimate / jargon / first name', () => {
    for (const [slot, pool] of Object.entries(COPINE_PERSONA.greetings)) {
      expect(pool.length, slot).toBeGreaterThanOrEqual(7);
      expect(new Set(pool).size, slot).toBe(pool.length);
      for (const line of pool) {
        expect(line, slot).not.toMatch(INTIMATE);
        expect(line, slot).not.toMatch(JARGON);
        expect(line, slot).not.toMatch(FIRST_NAME);
      }
    }
  });

  it('hard-day / success / good-night / away pools are varied and clean', () => {
    for (const [name, pool] of [
      ['hardDay', COPINE_PERSONA.hardDay],
      ['success', COPINE_PERSONA.success],
      ['goodNight', COPINE_PERSONA.goodNight],
      ['away.morning', COPINE_PERSONA.away.morning],
      ['away.thought', COPINE_PERSONA.away.thought],
      ['away.evening', COPINE_PERSONA.away.evening],
    ] as const) {
      expect(pool.length, name).toBeGreaterThanOrEqual(7);
      expect(new Set(pool).size, name).toBe(pool.length);
      for (const line of pool) {
        expect(line, name).not.toMatch(INTIMATE);
        expect(line, name).not.toMatch(JARGON);
        expect(line, name).not.toMatch(FIRST_NAME);
      }
    }
  });

  it('nicknames stay empty until complice (rare, never a grind unlock)', () => {
    expect(COPINE_PERSONA.nicknames.nouveau).toEqual([]);
    expect(COPINE_PERSONA.nicknames.familier).toEqual([]);
    expect(COPINE_PERSONA.nicknames.complice.length).toBeGreaterThanOrEqual(1);
    expect(COPINE_PERSONA.intimacyByTier['vieil ami']).not.toMatch(/sensuel|18\+/i);
  });
});

describe('C8 arrival pools — default unchanged, copine swaps data', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
  });

  it('byte-identical default: historical morning first template', () => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    expect(templatePool('morning')[0]).toBe(DEFAULT_MORNING_FIRST);
    const opener = buildArrivalOpener({ now: morningNow, rng: () => 0 });
    expect(opener.template).toBe(DEFAULT_MORNING_FIRST);
  });

  it('persona copine uses copine morning pool, not the historical first line', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    const pool = templatePool('morning');
    expect(pool).toEqual([...COPINE_PERSONA.greetings.morning]);
    expect(pool[0]).not.toBe(DEFAULT_MORNING_FIRST);
    const opener = buildArrivalOpener({ now: morningNow, rng: () => 0 });
    expect(COPINE_PERSONA.greetings.morning).toContain(opener.template);
    expect(opener.text).not.toMatch(INTIMATE);
    expect(opener.text).not.toMatch(/comment puis-je t['’]aider/i);
  });
});

describe('C8 spokenPrompt overlay + voice spine', () => {
  beforeEach(() => {
    resetPersonaManager();
  });
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    resetPersonaManager();
  });

  it('default spokenPrompt is unchanged (no copine overlay)', () => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    const voice = getActivePersonaVoice();
    if (voice.spokenPrompt) {
      expect(voice.spokenPrompt).not.toBe(COPINE_PERSONA.spokenPrompt);
    }
    const block = buildCompanionVoiceCharacterBlock({
      personaId: 'lisa',
      includeFewShot: false,
      includeIntimacy: false,
    });
    expect(block).toMatch(/Ani|Mika|petite amie/i);
    expect(block).not.toContain(COPINE_PERSONA.voiceSpine.split('\n')[1] ?? 'petite copine numérique, pas un assistant');
  });

  it('persona copine overlays spokenPrompt and the copine spine (no palier)', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    const voice = getActivePersonaVoice();
    expect(voice.spokenPrompt).toContain('petite copine numérique');
    expect(voice.spokenPrompt).not.toMatch(INTIMATE);
    const block = buildCompanionVoiceCharacterBlock({
      personaId: 'lisa',
      includeFewShot: true,
      turnIndex: 0,
      includeIntimacy: false,
    });
    expect(block).toContain('petite copine numérique, pas un assistant');
    expect(block).not.toMatch(INTIMATE);
    expect(block).toMatch(/j['’]ai réussi → Lisa: Trop bien/i);
  });

  it('copine intimacy has no /100 and no adult palier', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    const text = buildProgressiveIntimacyGuidance({
      firstSeenAt: 1,
      lastPresentAt: 1,
      celebratedMilestones: [],
      sessions: 60,
      mood: 90,
    });
    expect(text).toMatch(/très proche/i);
    expect(text).not.toMatch(/\/100/);
    expect(text).not.toMatch(/sensuel|18\+/i);
    expect(text).not.toMatch(/rapportTier/i);
  });
});

describe('C8 hard-day and success registers (persona-gated)', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
  });

  it('default emotion guidance stays the historical playbook', () => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    const hard = emotionGuidance(detectEmotion('je suis crevé, une journée dure'));
    expect(hard).toMatch(/fatigué|souffler/i);
    expect(hard).not.toMatch(/Je t’entends\. On n’est pas obligés de réparer tout de suite/);
    const win = emotionGuidance(detectEmotion("c'est génial, j'ai réussi"));
    expect(win).toMatch(/enthousiasme|bonne humeur/i);
    expect(win).not.toMatch(/Trop bien\. Un beat, pas un discours/);
  });

  it('copine: journée dure accueille avant de réparer ; succès = un beat', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    const hard = emotionGuidance(detectEmotion('je suis crevé, une journée dure'));
    expect(hard).toMatch(/t['’]entends|accueillir|réparer/i);
    expect(hard).not.toMatch(/lance les tests/i);
    const win = emotionGuidance(detectEmotion("c'est génial, j'ai réussi"));
    expect(win).toMatch(/beat|trop bien|discours/i);
  });
});
