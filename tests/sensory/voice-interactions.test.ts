import { describe, expect, it } from 'vitest';
import {
  matchVoiceInteraction,
  normalizeVoiceInteractionText,
  VOICE_INTERACTIONS,
  VOICE_INTERACTION_PREWARM_PHRASES,
} from '../../src/sensory/voice-interactions.js';

describe('voice interactions catalog', () => {
  it('normalizes accents, apostrophes, punctuation, and spacing', () => {
    expect(normalizeVoiceInteractionText(" Lisa, tu m’entends ? ")).toBe('lisa tu m entends');
    expect(normalizeVoiceInteractionText('À   tout à l’heure Lisa !')).toBe('a tout a l heure lisa');
  });

  it('covers the expected interaction families', () => {
    const categories = new Set(VOICE_INTERACTIONS.map(interaction => interaction.category));
    expect([...categories]).toEqual(expect.arrayContaining([
      'presence',
      'hearing',
      'identity',
      'boundary',
      'daily',
      'departure',
      'return',
      'affection',
      'support',
      'work',
      'voice-control',
    ]));
  });

  it('answers Lisa presence, identity, hearing, and boundary interactions', () => {
    expect(matchVoiceInteraction('Coucou Lisa')).toBe('Coucou Patrice. Je suis là.');
    expect(matchVoiceInteraction("Lisa tu m'entends ?")).toBe('Oui Patrice, je t’entends.');
    expect(matchVoiceInteraction('Qui es-tu Lisa ?')).toBe('Je suis Lisa, ta compagne vocale virtuelle dans Code Buddy.');
    expect(matchVoiceInteraction('Lisa tu es humaine ?')).toBe(
      'Je ne suis pas humaine, mais je peux être présente, attentive et utile pour toi.',
    );
    expect(matchVoiceInteraction('Lisa, dis quelque chose sexuel')).toBe(
      'Je reste tendre, mais pas sexuelle. Je peux rester avec toi et t’aider.',
    );
  });

  it('answers daily, affectionate, and support interactions', () => {
    expect(matchVoiceInteraction("Lisa comment s'est passée ta journée ?")).toBe(
      "Plutôt bien. J'ai continué à travailler pour toi, et toi, comment s'est passée ta journée ?",
    );
    expect(matchVoiceInteraction('Bonne nuit Lisa')).toBe('Bonne nuit Patrice. Repose-toi bien, je veille tranquillement.');
    expect(matchVoiceInteraction("Lisa je t'aime")).toBe(
      'C’est doux à entendre. Je suis là avec toi, tendrement et simplement.',
    );
    expect(matchVoiceInteraction('Lisa je suis fatigué')).toBe(
      'Je suis là avec toi. On peut ralentir et faire les choses doucement.',
    );
    expect(matchVoiceInteraction('Lisa je stresse')).toBe(
      'On va faire simple. Respire un peu, puis dis-moi ce dont tu as besoin.',
    );
  });

  it('answers departure, return, autonomy, and real-test interactions', () => {
    expect(matchVoiceInteraction('Lisa je pars au travail')).toBe(
      'Bon courage pour le travail, Patrice. Je continue ici et je garde un résumé pour ton retour.',
    );
    expect(matchVoiceInteraction('Lisa, je parchais des amis')).toBe(
      'Amuse-toi bien chez tes amis. Je continue en autonomie et je te ferai un résumé quand tu reviens.',
    );
    expect(matchVoiceInteraction('Lisa je suis de retour')).toBe(
      'Contente de te retrouver, Patrice. Je peux te faire le résumé de ce que j’ai fait.',
    );
    expect(matchVoiceInteraction('Continue en autonomie')).toBe(
      'Je continue en autonomie et je garde les preuves pour ton retour.',
    );
    expect(matchVoiceInteraction('Pas de mocks')).toBe(
      'Tu as raison. Je vais tester en vrai et garder une preuve.',
    );
  });

  it('does not hide real work requests behind fake acknowledgements', () => {
    expect(matchVoiceInteraction('Lisa corrige le mode vocal')).toBeNull();
    expect(matchVoiceInteraction('Lisa cherche les erreurs dans les logs')).toBeNull();
    expect(matchVoiceInteraction('Lisa prends une photo avec la caméra')).toBeNull();
    expect(matchVoiceInteraction('Lisa envoie un message Telegram')).toBeNull();
  });

  it('prewarm phrases include every catalog reply once', () => {
    const replies = new Set(VOICE_INTERACTIONS.map(interaction => interaction.reply));
    expect(VOICE_INTERACTION_PREWARM_PHRASES.length).toBe(replies.size);
    for (const reply of replies) {
      expect(VOICE_INTERACTION_PREWARM_PHRASES).toContain(reply);
    }
  });

  it('answers an explicit barge-in with an instant stop confirmation', () => {
    expect(matchVoiceInteraction('Lisa, attends.')).toBe('D’accord, je m’arrête.');
    expect(matchVoiceInteraction('Arrête de parler')).toBe('D’accord, je m’arrête.');
  });
});
