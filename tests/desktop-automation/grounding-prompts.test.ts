/**
 * Invites de l'ancrage visuel et lecture des réponses.
 *
 * L'ancienne lecture de la liste fermée prenait le premier entier de la
 * réponse (`reply.match(/\b\d+\b/)`) : un petit modèle qui répond par une
 * coordonnée ou qui cite une position avant le numéro désignait un élément
 * inexistant ou le mauvais.
 */
import { describe, expect, it } from 'vitest';
import {
  buildClosedListPrompt,
  buildCoordinatePrompt,
  isCoordinateGroundingEnabled,
  isVisualRegionsEnabled,
  parseClosedListReply,
  parseCoordinateReply,
} from '../../src/desktop-automation/grounding-prompts.js';

const refs = [1, 2, 3, 4, 5, 6];

describe('parseClosedListReply', () => {
  it('accepte un numéro nu, entre crochets ou entouré de texte', () => {
    expect(parseClosedListReply('4', refs)).toBe(4);
    expect(parseClosedListReply('[4]', refs)).toBe(4);
    expect(parseClosedListReply('The answer is 4.', refs)).toBe(4);
  });

  it('rend null pour « none » ou une réponse vide', () => {
    expect(parseClosedListReply('none', refs)).toBeNull();
    expect(parseClosedListReply('"none"', refs)).toBeNull();
    expect(parseClosedListReply('', refs)).toBeNull();
    expect(parseClosedListReply(undefined, refs)).toBeNull();
  });

  it("n'accepte qu'un numéro présent dans la liste", () => {
    // Réponses observables d'un petit modèle : une coordonnée au lieu d'un numéro.
    expect(parseClosedListReply('220', refs)).toBeNull();
    expect(parseClosedListReply('x=288', refs)).toBeNull();
  });

  it('préfère le numéro entre crochets à une position citée avant', () => {
    // L'ancienne lecture rendait 288.
    expect(parseClosedListReply('The Valider button at (288, 161) is [4].', refs)).toBe(4);
    expect(parseClosedListReply('center=(288,161) so 4', refs)).toBe(4);
  });

  it('ignore le raisonnement d’un modèle « thinking »', () => {
    expect(parseClosedListReply('<think>maybe 2 or 3</think>4', refs)).toBe(4);
  });
});

describe('parseCoordinateReply', () => {
  it('lit un JSON, même dans un bloc de code', () => {
    expect(parseCoordinateReply('```json\n{"x": 225, "y": 200}\n```')).toEqual({ x: 225, y: 200 });
    expect(parseCoordinateReply('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 });
  });
  it('se rabat sur les paires x/y', () => {
    expect(parseCoordinateReply('x: 12, y: 34')).toEqual({ x: 12, y: 34 });
    expect(parseCoordinateReply('nothing here')).toBeNull();
  });
});

describe('buildClosedListPrompt', () => {
  const cands = [
    { ref: 1, role: 'text', name: 'Compteur : 0', center: { x: 270, y: 120 }, size: { width: 84, height: 14 }, source: 'visual-region' },
    { ref: 4, role: 'button', name: 'Valider', center: { x: 288, y: 161 }, size: { width: 62, height: 31 }, source: 'visual-region' },
    { ref: 7, role: 'button', name: '', center: { x: 20, y: 20 }, source: 'visual-region' },
  ];
  it('liste chaque région avec son numéro, son texte et sa position', () => {
    const p = buildClosedListPrompt('clique sur le bouton Valider', cands, 'button');
    expect(p).toContain('[4] role="button" name="Valider" center=(288,161) size=62x31');
    expect(p).toContain('[7] role="button" name="(no text)" center=(20,20)');
    expect(p).toContain('numbered regions cut from the screenshot');
    expect(p).toContain('Look at the screenshot');
  });
  it('sans image, ne parle pas de capture au modèle', () => {
    const p = buildClosedListPrompt('clique sur le bouton Valider', cands, 'button', false);
    expect(p).not.toContain('Look at the screenshot');
    expect(p).not.toContain('in the provided screenshot');
  });
  it("garde l'invite historique pour l'arbre d'accessibilité", () => {
    const p = buildClosedListPrompt('Save', [{ ref: 12, role: 'button', name: 'Save' }]);
    expect(p).toContain('Here are the candidate elements present in the screenshot:');
    expect(p).toContain('[12] role="button" name="Save"');
  });
  it('l’invite en coordonnées reste celle de 0 à 1000', () => {
    expect(buildCoordinatePrompt('Valider')).toContain('from 0 to 1000');
  });
});

describe('drapeaux', () => {
  it('coordonnées : seulement sur demande', () => {
    expect(isCoordinateGroundingEnabled({})).toBe(false);
    expect(isCoordinateGroundingEnabled({ CODEBUDDY_VISION_GROUNDING: '1' })).toBe(false);
    expect(isCoordinateGroundingEnabled({ CODEBUDDY_VISION_GROUNDING_COORDS: '1' })).toBe(true);
  });
  it('régions : suivent l’ancrage visuel, refus ou activation explicites', () => {
    expect(isVisualRegionsEnabled({})).toBe(false);
    expect(isVisualRegionsEnabled({ CODEBUDDY_VISION_GROUNDING: '1' })).toBe(true);
    expect(isVisualRegionsEnabled({ CODEBUDDY_REAL_COMPUTER_USE: '1' })).toBe(true);
    expect(isVisualRegionsEnabled({ CODEBUDDY_VISION_GROUNDING: '1', CODEBUDDY_VISUAL_REGIONS: '0' })).toBe(false);
    expect(isVisualRegionsEnabled({ CODEBUDDY_VISUAL_REGIONS: '1' })).toBe(true);
  });
});
