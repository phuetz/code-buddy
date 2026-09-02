/**
 * Preuve du trou logique : un état relationnel qui dérive sans borne.
 *
 * Mécanisme (src/companion/relationship-state.ts:259, 284-286) :
 * 1. Contrairement à `mood` et `traits` qui sont bornés à [0, 100] via `clamp01`
 *    et régulés par un amortissement (`DECAY = 0.08`), le compteur de sessions
 *    d'interactions / retrouvailles `sessions` s'incrémente de manière strictement
 *    monotone et sans AUCUNE borne supérieure :
 *      `return { ...state, sessions: personalityOf(state).sessions + 1 };`
 *    Alors que `rapportTier` plafonne à 60 ('vieil ami'), `sessions` dérive à l'infini
 *    (100, 10 000, 10^9...), sans aucun plafond de saturation ni décroissance.
 * 2. `saveRelationshipState` persiste l'objet `state` brut par `JSON.stringify(state)`
 *    sans appliquer la normalisation/bornage de `personalityOf`, permettant à un état
 *    altéré ou dérivé sans borne de s'écrire directement sur le disque.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  recordReunion,
  personalityOf,
  saveRelationshipState,
  loadRelationshipState,
  type RelationshipState,
} from '../../src/companion/relationship-state.js';

describe('Revue G3 — État relationnel : dérive sans borne du compteur de sessions et persistance non bornée', () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'cb-revue-rel-'));
    statePath = path.join(tmpDir, 'relationship-state.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('le compteur de sessions s’incrémente sans plafond ni saturation lors de retrouvailles répétées', () => {
    let state: RelationshipState = { celebratedMilestones: [], sessions: 0 };

    // Simuler des interactions / retrouvailles répétées au fil de la vie du compagnon
    for (let i = 0; i < 200; i++) {
      state = recordReunion(state);
    }

    // Le rapportTier maximal ('vieil ami') est atteint à 60 sessions.
    // L'état relationnel DOIT posséder une borne supérieure saine (ex: plafond à 100 sessions)
    // pour éviter une accumulation sans borne.
    const personality = personalityOf(state);
    expect(personality.sessions).toBeLessThanOrEqual(100);
  });

  it('saveRelationshipState persiste un état non borné ou aberrant directement sur le disque sans le borner', () => {
    // État avec des valeurs dérivées hors bornes
    const runawayState: RelationshipState = {
      celebratedMilestones: [],
      mood: 500, // Dérive hors de [0, 100]
      sessions: 999999, // Dérive non bornée
      traits: { warmth: 999 } as any,
    };

    saveRelationshipState(runawayState, statePath);

    const loaded = loadRelationshipState(statePath);

    // Le fichier JSON sur disque ne devrait jamais contenir des métriques relationnelles hors-bornes
    expect(loaded.mood).toBeLessThanOrEqual(100);
    expect(loaded.sessions).toBeLessThanOrEqual(100);
    expect(loaded.traits?.warmth).toBeLessThanOrEqual(100);
  });
});
