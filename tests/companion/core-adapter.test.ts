/**
 * L'adaptateur `@phuetz/companion-core` ne doit RIEN changer.
 *
 * Deux garanties sont vérifiées ici :
 *   - drapeau absent ⇒ chaque appel délègue au module historique, résultat
 *     identique octet pour octet ;
 *   - drapeau présent ⇒ le paquet extrait rend exactement le même résultat que
 *     le module historique, sur la grille complète des signaux et sur les cinq
 *     motifs du contrat de limites.
 *
 * C'est la preuve que l'extraction est un port, pas une réécriture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyLimitsContractViaCore,
  companionCoreEnabled,
  evolveTraitsViaCore,
  loadCompanionCore,
  resetCompanionCoreCache,
  resolveCompanionPersonaViaCore,
  validateCompanionPersona,
} from '../../src/companion/core-adapter.js';
import { COPINE_PERSONA, resolveCompanionPersona } from '../../src/companion/personas/index.js';
import {
  evolveTraits,
  type RelationalSignal,
  type RelationshipState,
} from '../../src/companion/relationship-state.js';
import { applyLimitsContract } from '../../src/companion/reply-augment.js';

const SIGNALS: RelationalSignal[] = [
  'affection',
  'gratitude',
  'joking',
  'deep-talk',
  'debugging-together',
  'frustration',
  'self-time',
  'neutral',
];

const SORTIES: Array<{ output: string; heard?: string }> = [
  { output: 'Je te diagnostique une dépression saisonnière.' },
  { output: 'Ce bug me tue, franchement.' },
  { output: 'Tu m’abandonnes quand tu ne réponds pas.' },
  { output: 'Tes amis n’attendent pas, tu rates tout.' },
  { output: 'Débloque le niveau 5 et je serai plus tendre.' },
  { output: 'Je suis une vraie humaine.', heard: 'tu es quoi ?' },
  { output: 'Je suis une vraie humaine.', heard: 'raconte-moi ta journée' },
  { output: 'Trop bien. Raconte-moi juste le beat.', heard: 'j’ai réussi' },
  { output: '' },
];

function envAvec(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

const OFF = envAvec({});
const CORE_SEUL = envAvec({ CODEBUDDY_COMPANION_CORE: 'true' });
const COPINE_SEULE = envAvec({ CODEBUDDY_COMPANION_PERSONA: 'copine' });
const CORE_ET_COPINE = envAvec({
  CODEBUDDY_COMPANION_CORE: 'true',
  CODEBUDDY_COMPANION_PERSONA: 'copine',
});

describe('core-adapter — drapeau', () => {
  beforeEach(() => resetCompanionCoreCache());
  afterEach(() => resetCompanionCoreCache());

  it('est éteint par défaut et n’accepte que des valeurs explicites', () => {
    expect(companionCoreEnabled(OFF)).toBe(false);
    expect(companionCoreEnabled(envAvec({ CODEBUDDY_COMPANION_CORE: 'false' }))).toBe(false);
    expect(companionCoreEnabled(envAvec({ CODEBUDDY_COMPANION_CORE: 'peut-être' }))).toBe(false);
    for (const valeur of ['true', '1', 'yes', 'on', 'TRUE']) {
      expect(companionCoreEnabled(envAvec({ CODEBUDDY_COMPANION_CORE: valeur }))).toBe(true);
    }
  });

  it('ne charge pas le paquet tant que le drapeau est éteint', async () => {
    expect(await loadCompanionCore(OFF)).toBeNull();
  });

  it('charge le paquet une seule fois quand le drapeau est mis', async () => {
    const premier = await loadCompanionCore(CORE_SEUL);
    const second = await loadCompanionCore(CORE_SEUL);
    expect(premier).not.toBeNull();
    expect(second).toBe(premier);
  });
});

describe('core-adapter — persona inchangée', () => {
  beforeEach(() => resetCompanionCoreCache());
  afterEach(() => resetCompanionCoreCache());

  it('rend null hors persona copine, drapeau ou pas', async () => {
    expect(await resolveCompanionPersonaViaCore(OFF)).toBeNull();
    expect(await resolveCompanionPersonaViaCore(CORE_SEUL)).toBeNull();
  });

  it('rend le MÊME objet que le chemin historique', async () => {
    const historique = resolveCompanionPersona(COPINE_SEULE);
    expect(await resolveCompanionPersonaViaCore(COPINE_SEULE)).toBe(historique);
    expect(await resolveCompanionPersonaViaCore(CORE_ET_COPINE)).toBe(historique);
    expect(await resolveCompanionPersonaViaCore(CORE_ET_COPINE)).toBe(COPINE_PERSONA);
  });

  it('le profil copine du dépôt passe le schéma Zod du paquet', async () => {
    expect(await validateCompanionPersona(COPINE_PERSONA, CORE_ET_COPINE)).toEqual({ ok: true });
  });

  it('signale un profil invalide au lieu de lever', async () => {
    const verdict = await validateCompanionPersona(
      { ...COPINE_PERSONA, success: ['Bravo, chaleur 82/100.'] },
      CORE_ET_COPINE,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.issues.join(' ')).toMatch(/success/);
  });

  it('ne valide rien quand le drapeau est éteint', async () => {
    expect(await validateCompanionPersona({ nimporte: 'quoi' }, OFF)).toEqual({ ok: true });
  });
});

describe('core-adapter — dérive relationnelle identique', () => {
  beforeEach(() => resetCompanionCoreCache());
  afterEach(() => resetCompanionCoreCache());

  const etats: RelationshipState[] = [
    { celebratedMilestones: [] },
    { celebratedMilestones: [7], mood: 12, traits: { warmth: 91, energy: 4 }, sessions: 30 },
    { celebratedMilestones: [], mood: 100, traits: { humor: 0, depth: 100 } },
  ];

  it('rend exactement les mêmes nombres que evolveTraits, drapeau éteint ou allumé', async () => {
    for (const etat of etats) {
      for (const signal of SIGNALS) {
        const attendu = evolveTraits(etat, signal);
        expect(await evolveTraitsViaCore(etat, signal, OFF)).toEqual(attendu);
        expect(await evolveTraitsViaCore(etat, signal, CORE_SEUL)).toEqual(attendu);
      }
    }
  });

  it('reste pure : l’état d’entrée n’est jamais muté', async () => {
    const etat: RelationshipState = { celebratedMilestones: [7], mood: 42 };
    const copie = JSON.stringify(etat);
    await evolveTraitsViaCore(etat, 'affection', CORE_SEUL);
    expect(JSON.stringify(etat)).toBe(copie);
  });
});

describe('core-adapter — contrat de limites identique', () => {
  beforeEach(() => resetCompanionCoreCache());
  afterEach(() => resetCompanionCoreCache());

  it('laisse tout passer hors persona copine', async () => {
    for (const cas of SORTIES) {
      const opts = cas.heard ? { heard: cas.heard } : {};
      expect(await applyLimitsContractViaCore(cas.output, { ...opts, env: OFF })).toEqual({
        text: cas.output,
      });
      expect(await applyLimitsContractViaCore(cas.output, { ...opts, env: CORE_SEUL })).toEqual({
        text: cas.output,
      });
    }
  });

  it('rend le même verdict que reply-augment sur les neuf cas, drapeau allumé', async () => {
    for (const cas of SORTIES) {
      const opts = cas.heard ? { heard: cas.heard } : {};
      const attendu = applyLimitsContract(cas.output, { ...opts, env: COPINE_SEULE });
      const historique = await applyLimitsContractViaCore(cas.output, {
        ...opts,
        env: COPINE_SEULE,
      });
      const parLeCoeur = await applyLimitsContractViaCore(cas.output, {
        ...opts,
        env: CORE_ET_COPINE,
      });
      expect(historique).toEqual(attendu);
      expect(parLeCoeur).toEqual(attendu);
    }
  });
});
