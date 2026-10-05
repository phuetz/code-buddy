/**
 * C1-1005: frozen corpus against the real StagnationDetector.
 * - Historical thresholds (30/3/60): documents the L05 false positive.
 * - Proposed defaults (45/5/80): all 20 trajectories match expectDetect.
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_STAGNATION_OPTIONS,
  StagnationDetector,
  type StagnationOptions,
} from '../../../src/agent/execution/stagnation-detector.js';
import { STAGNATION_CORPUS } from '../../fixtures/stagnation-corpus.js';

function fireTurn(observations: typeof STAGNATION_CORPUS[number]['observations'], options: StagnationOptions): number | null {
  const d = new StagnationDetector(options);
  for (let i = 0; i < observations.length; i++) {
    if (d.observe(observations[i]!)) return i + 1;
  }
  return null;
}

describe('corpus stagnation — seuils historiques (30/3/60)', () => {
  it('matrice: L05 est un faux positif; les 10 boucles sont détectées', () => {
    const cells: Record<string, string> = {};
    let TP = 0, FP = 0, TN = 0, FN = 0;
    for (const t of STAGNATION_CORPUS) {
      const turn = fireTurn(t.observations, { ...LEGACY_STAGNATION_OPTIONS });
      const detected = turn !== null;
      if (t.expectDetect && detected) { TP++; cells[t.id] = `TP@${turn}`; }
      else if (t.expectDetect && !detected) { FN++; cells[t.id] = 'FN'; }
      else if (!t.expectDetect && detected) { FP++; cells[t.id] = `FP@${turn}`; }
      else { TN++; cells[t.id] = 'TN'; }
    }
    expect(cells.L05).toMatch(/^FP@/);
    expect(TP).toBe(10);
    expect(FN).toBe(0);
    expect(FP).toBe(1);
    expect(TN).toBe(9);
    // Ideal expectDetect fails exactly on L05 under legacy thresholds:
    const mismatches = STAGNATION_CORPUS.filter((t) => {
      const detected = fireTurn(t.observations, { ...LEGACY_STAGNATION_OPTIONS }) !== null;
      return detected !== t.expectDetect;
    }).map((t) => t.id);
    expect(mismatches).toEqual(['L05']);
  });
});

describe('corpus stagnation — seuils proposés (défauts 45/5/80)', () => {
  it.each(STAGNATION_CORPUS.map((t) => [t.id, t.expectDetect, t.label, t] as const))(
    '%s expectDetect=%s — %s',
    (id, expectDetect, _label, trajectory) => {
      const turn = fireTurn(trajectory.observations, {});
      const detected = turn !== null;
      expect({ id, detected, turn }).toEqual({
        id,
        detected: expectDetect,
        turn: expectDetect ? expect.any(Number) : null,
      });
    },
  );

  it('matrice de confusion: TP=10 FP=0 TN=10 FN=0', () => {
    let TP = 0, FP = 0, TN = 0, FN = 0;
    for (const t of STAGNATION_CORPUS) {
      const detected = fireTurn(t.observations, {}) !== null;
      if (t.expectDetect && detected) TP++;
      else if (t.expectDetect && !detected) FN++;
      else if (!t.expectDetect && detected) FP++;
      else TN++;
    }
    expect({ TP, FP, TN, FN }).toEqual({ TP: 10, FP: 0, TN: 10, FN: 0 });
  });
});
