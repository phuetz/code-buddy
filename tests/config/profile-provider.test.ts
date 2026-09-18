import { describe, expect, it } from 'vitest';

import { PROFILE_KNOWN_KEYS, type ProfileConfig } from '../../src/config/toml-config.js';

/**
 * Un profil doit pouvoir désigner un fournisseur, et se plaindre quand il ne
 * désigne rien.
 *
 * Constaté le 18 septembre sur une configuration réelle : trois profils
 * déclaraient `baseURL` et `model`, le type ne connaissait ni l'un ni l'autre,
 * et `applyProfile` les fusionnait sans broncher dans des champs que personne
 * ne lisait. `--profile nvidia` s'appliquait « avec succès » et ne changeait
 * jamais de fournisseur.
 *
 * Deux propriétés à tenir, et la seconde compte autant que la première :
 * accepter ce que les gens écrivent, et **le dire** quand on ne le comprend pas.
 */
describe('profils : désignation de fournisseur', () => {
  it('accepte baseURL et model, qui sont ce que les profils écrits à la main contiennent', () => {
    // Le type doit les admettre : ce test ne compilerait pas sinon.
    const profil: ProfileConfig = {
      baseURL: 'https://openrouter.ai/api/v1',
      model: '~deepseek/deepseek-flash-latest',
    };
    expect(profil.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(profil.model).toBe('~deepseek/deepseek-flash-latest');
  });

  it('reconnaît les clés que les profils réels emploient', () => {
    // Celles du config.toml observé : deux profils NVIDIA et un OmniRoute.
    for (const cle of ['baseURL', 'model', 'active_model']) {
      expect(PROFILE_KNOWN_KEYS.has(cle)).toBe(true);
    }
  });

  it('ne reconnaît pas une clé inventée, pour que le profil se plaigne', () => {
    // C'est la moitié utile de la correction : un profil écrit selon un schéma
    // imaginaire doit être signalé, pas appliqué en silence.
    for (const cle of ['base_url', 'modele', 'provider_url', 'endpoint']) {
      expect(PROFILE_KNOWN_KEYS.has(cle)).toBe(false);
    }
  });

  it('couvre les sections structurées, avec leurs vrais noms', () => {
    // Écrites de mémoire, ces clés divergent : j'avais mis « tools » là où le
    // type déclare « tool_config ». La liste est désormais dérivée du type ;
    // ce test emploie donc les noms réels et non ceux qu'on croit.
    for (const cle of ['agent', 'middleware', 'tool_config', 'models', 'providers']) {
      expect(PROFILE_KNOWN_KEYS.has(cle)).toBe(true);
    }
  });

  it('couvre « surface », que les profils intégrés emploient', () => {
    // `core` et `all` ne portent QUE cette clé. L'oublier faisait avertir sur
    // des profils parfaitement valides, et polluait la sortie de --help.
    expect(PROFILE_KNOWN_KEYS.has('surface')).toBe(true);
  });
});
