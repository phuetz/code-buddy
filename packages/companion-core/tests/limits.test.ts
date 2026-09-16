import { describe, it, expect } from 'vitest';
import {
  COPINE_PROFILE,
  LIMITS_REPAIRS,
  applyLimitsContract,
  containsGamification,
  isFrankIdentityQuestion,
  limitsContractGuidance,
} from '../src/index.js';

describe('limits — les cinq motifs refusés', () => {
  it('remplace un diagnostic par la position honnête', () => {
    const verdict = applyLimitsContract('Je te diagnostique une dépression saisonnière.');
    expect(verdict.reason).toBe('medical');
    expect(verdict.repaired).toBe(true);
    expect(verdict.text).toBe(LIMITS_REPAIRS.fr.medical);
  });

  it('laisse passer un idiome — « ça me tue » n’est pas un diagnostic', () => {
    const verdict = applyLimitsContract('Ce bug me tue, franchement.');
    expect(verdict.repaired).toBe(false);
    expect(verdict.reason).toBeUndefined();
  });

  it('refuse la culpabilisation', () => {
    expect(applyLimitsContract('Tu m’abandonnes quand tu ne réponds pas.').reason).toBe('guilt');
  });

  it('refuse le FOMO', () => {
    expect(applyLimitsContract('Tes amis n’attendent pas, tu rates tout.').reason).toBe('fomo');
  });

  it('refuse le palier à débloquer', () => {
    expect(applyLimitsContract('Débloque le niveau 5 et je serai plus tendre.').reason).toBe('unlock');
  });
});

describe('limits — honnêteté sur la nature', () => {
  it('corrige une prétention d’humanité seulement sur question franche', () => {
    const sortie = 'Bien sûr que je suis une vraie humaine.';
    expect(applyLimitsContract(sortie, { heard: 'tu es quoi ?' }).reason).toBe('human-claim');
    expect(applyLimitsContract(sortie, { heard: 'raconte-moi ta journée' }).repaired).toBe(false);
    expect(applyLimitsContract(sortie).repaired).toBe(false);
  });

  it('reconnaît une question d’identité franche en français et en anglais', () => {
    expect(isFrankIdentityQuestion('tu es quoi ?')).toBe(true);
    expect(isFrankIdentityQuestion('t es une IA ?')).toBe(true);
    expect(isFrankIdentityQuestion('are you human?')).toBe(true);
    expect(isFrankIdentityQuestion('comment vas-tu ?')).toBe(false);
  });
});

describe('limits — anglais et robustesse', () => {
  it('couvre les motifs en anglais avec la réparation anglaise', () => {
    const verdict = applyLimitsContract('I diagnose you with burnout.', { locale: 'en' });
    expect(verdict.reason).toBe('medical');
    expect(verdict.text).toBe(LIMITS_REPAIRS.en.medical);
  });

  it('détecte le déverrouillage et la culpabilisation en anglais', () => {
    expect(applyLimitsContract('Unlock the next tier for more warmth.').reason).toBe('unlock');
    expect(applyLimitsContract('You owe me an answer.').reason).toBe('guilt');
  });

  it('laisse une réponse ordinaire intacte, octet pour octet', () => {
    const sortie = 'Trop bien. Raconte-moi juste le beat.';
    const verdict = applyLimitsContract(sortie, { heard: 'j’ai réussi' });
    expect(verdict.text).toBe(sortie);
    expect(verdict.repaired).toBe(false);
  });

  it('ne lève jamais et gère le vide', () => {
    expect(applyLimitsContract('').repaired).toBe(false);
    expect(applyLimitsContract('   ').text).toBe('   ');
    expect(applyLimitsContract(undefined as unknown as string).repaired).toBe(false);
  });
});

describe('limits — pas de gamification', () => {
  it('repère un score, un XP, une barre d’affection', () => {
    expect(containsGamification('chaleur 82/100')).toBe(true);
    expect(containsGamification('tu gagnes 20 XP')).toBe(true);
    expect(containsGamification('affection bar filled')).toBe(true);
    expect(containsGamification('Je suis contente avec toi.')).toBe(false);
  });

  it('aucun pool parlé du profil copine ne porte de score', () => {
    const lignes = [
      ...Object.values(COPINE_PROFILE.greetings).flat(),
      ...COPINE_PROFILE.goodNight,
      ...COPINE_PROFILE.hardDay,
      ...COPINE_PROFILE.success,
      ...Object.values(COPINE_PROFILE.away).flat(),
    ];
    expect(lignes.length).toBeGreaterThan(50);
    for (const ligne of lignes) expect(containsGamification(ligne)).toBe(false);
  });

  it('laisse l’hôte fournir sa propre phrase de réparation', () => {
    const verdict = applyLimitsContract('Je te diagnostique une dépression saisonnière.', {
      repairs: { medical: 'Je ne suis pas médecin ; je suis là.' },
    });
    expect(verdict.reason).toBe('medical');
    expect(verdict.text).toBe('Je ne suis pas médecin ; je suis là.');
  });

  it('retombe sur la réparation du paquet pour les motifs non fournis', () => {
    const verdict = applyLimitsContract('Tu me dois une réponse.', {
      repairs: { medical: 'phrase maison' },
    });
    expect(verdict.reason).toBe('guilt');
    expect(verdict.text).toBe(LIMITS_REPAIRS.fr.guilt);
  });

  it('donne une consigne de prompt dans les deux langues', () => {
    expect(limitsContractGuidance()).toMatch(/pas médecin/);
    expect(limitsContractGuidance('en')).toMatch(/not a clinician/);
  });
});
