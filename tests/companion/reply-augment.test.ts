/**
 * Phase 4 of the interactions refonte: emotion-aware tone + anti-repetition, and the trait drift it
 * feeds. Pure detectors/guidance are unit-tested directly; the wiring into the hybrid reply is proven
 * end-to-end through the REAL relationship-state file (env-routed temp, no mocks) — an affectionate
 * utterance actually nudges Lisa's warmth up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  detectRelationalSignal,
  registerGuidanceForSignal,
  detectEmotion,
  emotionToSignal,
  emotionGuidance,
  emotionalContinuityGuidance,
  textEmotionGuidance,
  buildTextEmotionalPresenceContext,
  immediateEmotionAcknowledgement,
  openerKey,
  pushOpener,
  avoidOpenersGuidance,
} from '../../src/companion/reply-augment.js';
import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';
import {
  loadRelationshipState,
  personalityOf,
  DEFAULT_TRAITS,
} from '../../src/companion/relationship-state.js';

describe('detectRelationalSignal', () => {
  it('classifies the dominant emotional colour', () => {
    expect(detectRelationalSignal("je t'aime Lisa")).toBe('affection');
    expect(detectRelationalSignal('merci beaucoup')).toBe('gratitude');
    expect(detectRelationalSignal('haha tu es marrante')).toBe('joking');
    expect(detectRelationalSignal('honnêtement je me sens seul')).toBe('deep-talk');
    expect(detectRelationalSignal('quelle heure est-il')).toBe('neutral');
  });

  it('is accent-insensitive (STT drops accents)', () => {
    expect(detectRelationalSignal('ca marche pas, je galere')).toBe('frustration');
  });

  it('puts frustration FIRST so care is not missed on a mixed message', () => {
    expect(detectRelationalSignal('merci mais je galère vraiment là')).toBe('frustration');
  });
});

describe('registerGuidanceForSignal', () => {
  it('frustration → the caring playbook (present first, no rushed fix)', () => {
    const g = registerGuidanceForSignal('frustration');
    expect(g).toMatch(/pr[ée]cipite|pr[ée]sence|douceur/i);
  });
  it('neutral → no guidance', () => {
    expect(registerGuidanceForSignal('neutral')).toBe('');
  });
});

describe('detectEmotion (enriched)', () => {
  it('detects the new emotions', () => {
    expect(detectEmotion('je suis vraiment triste ce soir').emotion).toBe('sadness');
    expect(detectEmotion('je suis hyper stressé').emotion).toBe('anxiety');
    expect(detectEmotion('je suis épuisé, crevé').emotion).toBe('tired');
    expect(detectEmotion("c'est génial, j'ai réussi !").emotion).toBe('joy');
    expect(detectEmotion('quelle heure est-il').emotion).toBe('neutral');
  });

  it('flags intensity from markers', () => {
    expect(detectEmotion('je galère vraiment').intensity).toBe('high');
    expect(detectEmotion('je galère un peu').intensity).toBe('normal');
  });

  it('negatives take priority (frustration first)', () => {
    expect(detectEmotion('merci mais je suis à bout').emotion).toBe('frustration');
  });

  it('understands local negation instead of inventing sadness or fatigue', () => {
    expect(detectEmotion('je ne suis pas triste').emotion).toBe('neutral');
    expect(detectEmotion('je ne suis plus fatigué').emotion).toBe('neutral');
    expect(detectEmotion('je ne vais pas bien, je suis triste').emotion).toBe('sadness');
    expect(detectEmotion("je n'ai pas le moral").emotion).toBe('sadness');
  });

  it('also recognizes common English emotional cues', () => {
    expect(detectEmotion('I am completely stuck on this').emotion).toBe('frustration');
    expect(detectEmotion('I feel anxious about the release').emotion).toBe('anxiety');
    expect(detectEmotion('thanks, that really helped').emotion).toBe('gratitude');
    expect(detectEmotion('I am not sad').emotion).toBe('neutral');
    expect(detectEmotion("I don't feel tired").emotion).toBe('neutral');
  });
});

describe('emotionToSignal (backward-compatible mapping)', () => {
  it('maps fine emotions to the coarse trait-drift signal', () => {
    expect(emotionToSignal('sadness')).toBe('deep-talk');
    expect(emotionToSignal('anxiety')).toBe('frustration');
    expect(emotionToSignal('tired')).toBe('frustration');
    expect(emotionToSignal('joy')).toBe('joking');
    // detectRelationalSignal still returns the historical values via the mapping
    expect(detectRelationalSignal('je suis triste')).toBe('deep-talk');
    expect(detectRelationalSignal('je suis fatigué')).toBe('frustration');
  });
});

describe('emotionGuidance (rich tone + proactive humour)', () => {
  it('leads with acknowledgment on sadness and offers to lighten the mood', () => {
    const g = emotionGuidance({ emotion: 'sadness', intensity: 'normal' });
    expect(g).toMatch(/accueille|triste/i);
    expect(g).toMatch(/changer les id[ée]es|blague/i); // proactive humour offer
  });

  it('strengthens the register at high intensity', () => {
    expect(emotionGuidance({ emotion: 'frustration', intensity: 'high' })).toMatch(
      /vraiment|priorit[ée]/i
    );
  });

  it('joy shares enthusiasm and does not offer humour', () => {
    const g = emotionGuidance({ emotion: 'joy', intensity: 'normal' });
    expect(g).toMatch(/enthousiasme|bonne humeur/i);
    expect(g).not.toMatch(/changer les id[ée]es/i);
  });

  it('neutral → empty', () => {
    expect(emotionGuidance({ emotion: 'neutral', intensity: 'normal' })).toBe('');
  });
});

describe('immediateEmotionAcknowledgement', () => {
  it('provides a short first sign of presence for difficult emotions only', () => {
    expect(immediateEmotionAcknowledgement({ emotion: 'sadness', intensity: 'high' })).toBe(
      'Je suis là avec toi.'
    );
    expect(immediateEmotionAcknowledgement({ emotion: 'anxiety', intensity: 'normal' })).toMatch(
      /doucement/i
    );
    expect(immediateEmotionAcknowledgement({ emotion: 'neutral', intensity: 'normal' })).toBeNull();
    expect(immediateEmotionAcknowledgement({ emotion: 'joy', intensity: 'normal' })).toBeNull();
  });
});

describe('emotionalContinuityGuidance', () => {
  it('keeps gentle continuity for a neutral follow-up after sadness', () => {
    const guidance = emotionalContinuityGuidance('oui, je vois', [
      { role: 'user', content: 'je suis vraiment triste ce soir' },
      { role: 'assistant', content: 'Je suis là avec toi.' },
    ]);
    expect(guidance).toMatch(/tristesse|chaleur/i);
    expect(guidance).toMatch(/ne ram[eè]ne pas|de force/i);
  });

  it('does not override a new explicit emotion or revive an old one', () => {
    expect(
      emotionalContinuityGuidance("maintenant je suis très heureux", [
        { role: 'user', content: 'je suis triste' },
      ])
    ).toBe('');
    expect(
      emotionalContinuityGuidance('quelle heure est-il', [
        { role: 'user', content: 'je suis triste' },
        { role: 'user', content: 'parlons du projet' },
        { role: 'user', content: 'le build passe' },
      ])
    ).toBe('');
  });
});

describe('text emotional presence context', () => {
  it('acknowledges frustration once, then keeps the assistant concrete', () => {
    const guidance = textEmotionGuidance(detectEmotion("j'en peux plus, je suis bloqué"));
    expect(guidance).toMatch(/acknowledgement|concrete help/i);

    const context = buildTextEmotionalPresenceContext("j'en peux plus, je suis bloqué", []);
    expect(context).toMatch(/user.s language|human and specific/i);
    expect(context).toMatch(/never mention emotion detection/i);
  });

  it('is empty for an emotionally neutral turn with no recent signal', () => {
    expect(buildTextEmotionalPresenceContext('ouvre le fichier package.json', [])).toBe('');
  });

  it('carries warmth across one neutral follow-up without reviving the subject', () => {
    const context = buildTextEmotionalPresenceContext('d’accord, continuons', [
      { role: 'user', content: 'je suis vraiment triste ce soir' },
      { role: 'assistant', content: 'Je suis là.' },
    ]);
    expect(context).toMatch(/chaleur|ne ram[eè]ne pas/i);
  });
});

describe('opener ring', () => {
  it('openerKey normalizes to the first few words', () => {
    expect(openerKey('Bonne question ! Alors, voyons voir…')).toBe('bonne question alors voyons');
  });
  it('pushOpener dedups and caps', () => {
    let ring: string[] = [];
    ring = pushOpener(ring, 'Bonne question, voyons ça');
    ring = pushOpener(ring, 'Bonne question, voyons ça'); // same opener → dedup
    expect(ring.length).toBe(1);
    for (let i = 0; i < 10; i++) ring = pushOpener(ring, `phrase numero ${i} bla`);
    expect(ring.length).toBeLessThanOrEqual(6);
  });
  it('avoidOpenersGuidance is empty for an empty ring, else names the openers', () => {
    expect(avoidOpenersGuidance([])).toBe('');
    expect(avoidOpenersGuidance(['bonne question alors'])).toContain('bonne question alors');
  });
});

describe('hybrid reply evolves Lisa’s traits per utterance (real state file, opt-in)', () => {
  let tmp: string;
  let statePath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'replyaug-'));
    statePath = join(tmp, 'relationship-state.json');
    process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE = statePath;
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'true';
  });
  afterEach(() => {
    delete process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE;
    delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('an affectionate utterance nudges warmth up; feature-off leaves it untouched', async () => {
    // Injected seams → no model, no network. The evolution runs at the top of the reply, gated.
    const reply = makeHybridReply({
      // Exercise the awaited companion path. Instant shortcuts intentionally
      // evolve traits in the background so they never add spoken latency.
      fastReply: () => null,
      chitchat: async () => 'coucou',
      agentReply: async () => 'coucou',
      classify: () => false,
    });
    await reply("je t'aime Lisa, tu me manques");
    const warmth = personalityOf(loadRelationshipState(statePath)).traits.warmth;
    expect(warmth).toBeGreaterThan(DEFAULT_TRAITS.warmth);

    // With the flag off, no state is written (default path untouched).
    delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    const tmp2 = mkdtempSync(join(tmpdir(), 'replyaug2-'));
    const state2 = join(tmp2, 'relationship-state.json');
    process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE = state2;
    try {
      const reply2 = makeHybridReply({
        fastReply: () => 'ok',
        chitchat: async () => 'ok',
        agentReply: async () => 'ok',
        classify: () => false,
      });
      await reply2("je t'aime");
      // No file written → load returns the default baseline.
      expect(personalityOf(loadRelationshipState(state2)).traits.warmth).toBe(
        DEFAULT_TRAITS.warmth
      );
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
