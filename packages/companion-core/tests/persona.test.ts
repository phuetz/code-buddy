import { describe, it, expect } from 'vitest';
import {
  COPINE_PROFILE,
  companionProfileSchema,
  createPersonaRegistry,
  interpolateName,
  loadPersonaProfile,
  openerKey,
  pickGreeting,
  pickLine,
  safeLoadPersonaProfile,
  safeLoadPersonaProfileJson,
  seededRng,
  constantRng,
  nicknamesForTier,
} from '../src/index.js';

describe('persona — profil validé', () => {
  it('accepte le profil copine intégré', () => {
    const profile = loadPersonaProfile(COPINE_PROFILE);
    expect(profile.id).toBe('copine');
    expect(profile.locale).toBe('fr');
    expect(profile.greetings.morning.length).toBeGreaterThan(0);
  });

  it('applique la locale par défaut quand elle manque', () => {
    const { locale: _ignored, ...sansLocale } = COPINE_PROFILE;
    expect(loadPersonaProfile(sansLocale).locale).toBe('fr');
  });

  it('refuse un score visible dans une réplique parlée', () => {
    const result = safeLoadPersonaProfile({
      ...COPINE_PROFILE,
      success: ['Bravo, chaleur 82/100.'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toMatch(/success/);
  });

  it('refuse un pool de bonjour vide', () => {
    const result = safeLoadPersonaProfile({
      ...COPINE_PROFILE,
      greetings: { ...COPINE_PROFILE.greetings, morning: [] },
    });
    expect(result.ok).toBe(false);
  });

  it('accepte la négation de la gamification hors pool parlé', () => {
    expect(COPINE_PROFILE.intimacyByTier['vieil ami']).toMatch(/débloquer/);
    expect(companionProfileSchema.safeParse(COPINE_PROFILE).success).toBe(true);
  });

  it('signale un JSON illisible sans lever', () => {
    const result = safeLoadPersonaProfileJson('{ pas du json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toMatch(/JSON illisible/);
  });

  it('lève sur un profil invalide via loadPersonaProfile', () => {
    expect(() => loadPersonaProfile({ id: '' })).toThrow(/profil de persona invalide/);
  });
});

describe('persona — registre', () => {
  it('résout un profil par identifiant, null sinon', () => {
    const registry = createPersonaRegistry();
    expect(registry.get('copine')?.id).toBe('copine');
    expect(registry.get('inconnue')).toBeNull();
    expect(registry.get(null)).toBeNull();
  });

  it('enregistre un profil supplémentaire et liste les identifiants', () => {
    const registry = createPersonaRegistry();
    registry.register({ ...COPINE_PROFILE, id: 'amie' });
    expect(registry.ids()).toEqual(['amie', 'copine']);
  });

  it('tryRegister rend les défauts sans lever', () => {
    const registry = createPersonaRegistry();
    const result = registry.tryRegister({ ...COPINE_PROFILE, id: '' });
    expect(result.ok).toBe(false);
    expect(registry.ids()).toEqual(['copine']);
  });
});

describe('persona — interpolation et tirage', () => {
  it('retire proprement le créneau de prénom quand aucun nom n’est fourni', () => {
    expect(interpolateName('Bonjour {{name}}. On y va ?')).toBe('Bonjour. On y va ?');
    expect(interpolateName('Il est tard, {{name}}. Ça va ?')).toBe('Il est tard. Ça va ?');
  });

  it('remplit le créneau quand un nom est fourni', () => {
    expect(interpolateName('Re {{name}}.', 'Alex')).toBe('Re Alex.');
  });

  it('ne renvoie jamais un prénom codé en dur', () => {
    const rendu = COPINE_PROFILE.greetings.morning.map((l) => interpolateName(l)).join(' ');
    expect(rendu).not.toMatch(/\{\{name\}\}/);
    expect(rendu).not.toMatch(/undefined/);
  });

  it('tire une ligne déterministe avec un générateur injecté', () => {
    const pool = ['un', 'deux', 'trois'];
    expect(pickLine(pool, { rng: constantRng(0) })).toBe('un');
    expect(pickLine(pool, { rng: constantRng(0.99) })).toBe('trois');
  });

  it('évite les ouvertures déjà dites', () => {
    const pool = ['Bonjour toi. Ça va ?', 'Salut. Bien dormi ?'];
    expect(pickLine(pool, { rng: constantRng(0), avoid: ['bonjour toi ca va'] })).toBe(
      'Salut. Bien dormi ?',
    );
  });

  it('retombe sur le pool complet plutôt que de rester muet', () => {
    const pool = ['Bonjour toi.'];
    expect(pickLine(pool, { rng: constantRng(0), avoid: ['bonjour toi'] })).toBe('Bonjour toi.');
    expect(pickLine([], { rng: constantRng(0) })).toBe('');
  });

  it('calcule une clé d’ouverture insensible aux accents', () => {
    expect(openerKey('Bonjour toi, ça va ?')).toBe('bonjour toi ca va');
  });

  it('tire un bonjour reproductible pour une graine donnée', () => {
    const a = pickGreeting(COPINE_PROFILE, 'morning', { rng: seededRng(7) });
    const b = pickGreeting(COPINE_PROFILE, 'morning', { rng: seededRng(7) });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('n’accorde pas de surnom au palier le plus bas', () => {
    expect(nicknamesForTier(COPINE_PROFILE, 'nouveau')).toEqual([]);
    expect(nicknamesForTier(COPINE_PROFILE, 'complice').length).toBeGreaterThan(0);
  });
});
