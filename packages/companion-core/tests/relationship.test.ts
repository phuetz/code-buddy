import { describe, it, expect } from 'vitest';
import {
  DECAY,
  DEFAULT_TRAITS,
  MAX_MOOD_STEP_PER_TURN,
  MAX_RELATIONSHIP_SESSIONS,
  MOOD_BASELINE,
  daysBetween,
  describeRapport,
  detectEmotion,
  detectRelationalSignal,
  emotionToSignal,
  emptyRelationshipState,
  evolveRelationship,
  evolveRelationshipWithDayInertia,
  markMilestonesUpTo,
  moodBand,
  normalizeRelationshipState,
  pendingMilestone,
  personalityOf,
  rapportTier,
  recordReunion,
  relationshipSummary,
} from '../src/index.js';

describe('relationship — jalons et durées', () => {
  it('compte les jours entiers, jamais négatifs', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(daysBetween(0, 3 * day + 1000)).toBe(3);
    expect(daysBetween(5 * day, 0)).toBe(0);
  });

  it('annonce le jalon le plus haut atteint, pas un retard', () => {
    expect(pendingMilestone(120, [])).toBe(100);
    expect(pendingMilestone(120, [7, 30, 100])).toBeNull();
    expect(pendingMilestone(3, [])).toBeNull();
  });

  it('solde le retard de jalons en une fois', () => {
    expect(markMilestonesUpTo([], 120)).toEqual([7, 30, 100]);
  });
});

describe('relationship — dérive sans cliquet', () => {
  it('converge vers baseline + delta/DECAY au lieu de monter sans fin', () => {
    let state = emptyRelationshipState();
    for (let i = 0; i < 200; i += 1) state = evolveRelationship(state, 'debugging-together');
    const { traits } = personalityOf(state);
    // depth : +3 par pas, DECAY 0,08 → 55 + 37,5. warmth : +2 → 62 + 25.
    expect(traits.depth).toBeCloseTo(DEFAULT_TRAITS.depth + 3 / DECAY, 5);
    expect(traits.warmth).toBeCloseTo(DEFAULT_TRAITS.warmth + 2 / DECAY, 5);
    expect(traits.depth).toBeLessThan(100);
    expect(traits.warmth).toBeLessThan(100);
  });

  it('redescend vers la ligne de base quand le signal cesse', () => {
    let state = emptyRelationshipState();
    for (let i = 0; i < 20; i += 1) state = evolveRelationship(state, 'affection');
    const haut = personalityOf(state).mood;
    for (let i = 0; i < 60; i += 1) state = evolveRelationship(state, 'neutral');
    const apres = personalityOf(state).mood;
    expect(apres).toBeLessThan(haut);
    expect(Math.abs(apres - MOOD_BASELINE)).toBeLessThan(1);
  });

  it('la frustration adoucit et fait baisser l’humeur', () => {
    const state = evolveRelationship(emptyRelationshipState(), 'frustration');
    const p = personalityOf(state);
    expect(p.mood).toBeLessThan(MOOD_BASELINE);
    expect(p.traits.warmth).toBeGreaterThan(DEFAULT_TRAITS.warmth);
  });

  it('reste pure : l’état d’entrée n’est pas muté', () => {
    const state = emptyRelationshipState();
    const copie = JSON.stringify(state);
    evolveRelationship(state, 'joking');
    expect(JSON.stringify(state)).toBe(copie);
  });
});

describe('relationship — inertie journalière', () => {
  it('plafonne le pas d’humeur par tour', () => {
    const state = evolveRelationshipWithDayInertia(emptyRelationshipState(), 'affection', {
      localDate: '2026-01-02',
    });
    expect(Math.abs(personalityOf(state).mood - MOOD_BASELINE)).toBeLessThanOrEqual(
      MAX_MOOD_STEP_PER_TURN,
    );
  });

  it('ne saute pas de bande à chaque phrase neutre', () => {
    let state = emptyRelationshipState();
    const bandes = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      state = evolveRelationshipWithDayInertia(state, 'neutral', { localDate: '2026-01-02' });
      bandes.add(moodBand(personalityOf(state).mood));
    }
    expect(bandes.size).toBe(1);
  });

  it('ramène doucement vers la ligne de base au changement de jour', () => {
    let state = emptyRelationshipState();
    for (let i = 0; i < 12; i += 1) {
      state = evolveRelationshipWithDayInertia(state, 'frustration', { localDate: '2026-01-02' });
    }
    const veille = personalityOf(state).mood;
    const lendemain = evolveRelationshipWithDayInertia(state, 'neutral', { localDate: '2026-01-03' });
    expect(personalityOf(lendemain).mood).toBeGreaterThan(veille);
  });
});

describe('relationship — palier de phrasé, pas un score', () => {
  it('monte par retrouvailles et plafonne', () => {
    let state = emptyRelationshipState();
    for (let i = 0; i < 500; i += 1) state = recordReunion(state);
    expect(personalityOf(state).sessions).toBe(MAX_RELATIONSHIP_SESSIONS);
    expect(rapportTier(personalityOf(state).sessions)).toBe('vieil ami');
  });

  it('donne les quatre paliers aux bons seuils', () => {
    expect(rapportTier(0)).toBe('nouveau');
    expect(rapportTier(5)).toBe('familier');
    expect(rapportTier(20)).toBe('complice');
    expect(rapportTier(60)).toBe('vieil ami');
  });

  it('la description orale ne contient aucun chiffre', () => {
    const texte = describeRapport(evolveRelationship(emptyRelationshipState(), 'joking'));
    expect(texte).not.toMatch(/\d/);
  });

  it('le résumé de prompt reste chiffré (usage modèle uniquement)', () => {
    expect(relationshipSummary(emptyRelationshipState())).toMatch(/\/100/);
  });
});

describe('relationship — normalisation d’un enregistrement douteux', () => {
  it('borne les valeurs et jette ce qui n’est pas un nombre', () => {
    const state = normalizeRelationshipState({
      mood: 5000,
      sessions: -4,
      traits: { warmth: 'chaud', humor: 900 },
      celebratedMilestones: [7, 'trente'],
      moodLocalDate: 'pas-une-date',
    });
    expect(state.mood).toBe(100);
    expect(state.sessions).toBe(0);
    expect(state.traits?.humor).toBe(100);
    expect(state.traits?.warmth).toBeUndefined();
    expect(state.celebratedMilestones).toEqual([7]);
    expect(state.moodLocalDate).toBeUndefined();
  });

  it('rend un état vide sur une entrée absurde', () => {
    expect(normalizeRelationshipState(null).celebratedMilestones).toEqual([]);
    expect(normalizeRelationshipState('texte').celebratedMilestones).toEqual([]);
  });
});

describe('relationship — lecture émotionnelle', () => {
  it('donne la priorité au négatif dans un message mixte', () => {
    expect(detectEmotion('merci mais je galère vraiment').emotion).toBe('frustration');
  });

  it('respecte la négation', () => {
    expect(detectEmotion('je ne suis pas triste').emotion).toBe('neutral');
  });

  it('monte la confiance avec l’intensité', () => {
    const faible = detectEmotion('je suis fatigué');
    const fort = detectEmotion('je suis vraiment fatigué');
    expect(fort.confidence).toBeGreaterThan(faible.confidence);
    expect(fort.intensity).toBe('high');
  });

  it('lit aussi l’anglais', () => {
    expect(detectEmotion('I am exhausted').emotion).toBe('tired');
    expect(detectEmotion('thanks a lot').emotion).toBe('gratitude');
  });

  it('projette l’émotion sur le signal de dérive', () => {
    expect(emotionToSignal('anxiety')).toBe('frustration');
    expect(emotionToSignal('sadness')).toBe('deep-talk');
    expect(detectRelationalSignal('je t aime')).toBe('affection');
    expect(detectRelationalSignal('')).toBe('neutral');
  });
});
