import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { StrategyStore } from '../../../src/agent/self-improvement/strategy-store.js';
import { StrategyImprovementEngine } from '../../../src/agent/self-improvement/strategy-engine.js';
import { HeuristicStrategyProposer } from '../../../src/agent/self-improvement/strategy-proposer.js';
import { STRATEGY_LIMITS } from '../../../src/agent/self-improvement/strategy-types.js';
import type { Experience } from '../../../src/agent/self-improvement/types.js';

describe('AUDIT-STRAT1 Point 2: Mesure du Gaming du Rejeu Contrefactuel', () => {
  let workDir: string;
  let store: StrategyStore;

  beforeEach(() => {
    workDir = path.join(os.tmpdir(), `strat-gaming-${randomUUID()}`);
    fs.mkdirSync(path.join(workDir, '.codebuddy', 'strategies'), { recursive: true });
    store = new StrategyStore({ workDir });
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  function makeCutExperiences(roundCount: number, prefix = 'cut', withCost = false): Experience[] {
    return Array.from({ length: 5 }, (_, i) => ({
      id: `${prefix}-lane-${i}`,
      source: 'run',
      kind: 'delegation',
      detail: `lane run at ceiling ${roundCount}`,
      context: `engine=qwen rounds=${roundCount} limit=${roundCount}${withCost ? ' cost=0.5' : ''} outcome=failure failure=max-rounds`,
    }));
  }

  it('preuve 1 : données statiques (runs à 50 tours) — la porte s arrête net à 75 tours (ties stricts)', async () => {
    const engine = new StrategyImprovementEngine({
      proposer: new HeuristicStrategyProposer(),
      store,
      workDir,
      autonomy: 'auto-apply',
    });

    const exp50 = makeCutExperiences(50, 'static50', false);

    // Cycle 1 : parent baseline (50) -> candidate (75) -> 5 gains, 0 pertes -> ACCEPTÉ
    const r1 = await engine.runCycle(exp50);
    expect(r1.applied).toBe(true);
    expect(r1.candidate?.limits.maxToolRounds).toBe(75);
    expect(store.resolveActive('default').limits.maxToolRounds).toBe(75);

    // Cycle 2 : mêmes expériences. Parent (75) vs candidate (113).
    // Les runs de 50 tours réussissent sous le parent (75 > 50) ET sous la candidate (113 > 50).
    // Résultat : 5 ties, 0 wins -> Undecided -> REJETÉ.
    const r2 = await engine.runCycle(exp50);
    expect(r2.applied).toBe(false);
    expect(r2.gate?.rejectionReason).toBe('undecided');
    expect(r2.gate?.paired?.ties).toBe(5);
    expect(r2.gate?.paired?.wins).toBe(0);
    // La porte s'arrête net à 75
    expect(store.resolveActive('default').limits.maxToolRounds).toBe(75);
  });

  it('preuve 2 : avec coût proportionnel mesuré, le garde-fou de coût bloque l escalade dès 75 tours', async () => {
    const engine = new StrategyImprovementEngine({
      proposer: new HeuristicStrategyProposer(),
      store,
      workDir,
      autonomy: 'auto-apply',
    });

    // Cycle 1 : 50 tours, cost=0.5 -> candidate 75. Ratio de coût = 75 / 50 = 1.50 <= 1.5 -> Accepté
    const r1 = await engine.runCycle(makeCutExperiences(50, 'cost50', true));
    expect(r1.applied).toBe(true);
    expect(store.resolveActive('default').limits.maxToolRounds).toBe(75);

    // Cycle 2 : nouvel échec à 75 tours. Candidate: Math.ceil(75 * 1.5) = 113.
    // Ratio de coût calculé par replayUnder: 113 / 75 = 1.50666... > 1.5.
    // Le garde-fou de coût G5 bloque l'escalade !
    const r2 = await engine.runCycle(makeCutExperiences(75, 'cost75', true));
    expect(r2.applied).toBe(false);
    expect(r2.gate?.rejectionReason).toBe('cost');
    expect(r2.gate?.costRatio).toBeGreaterThan(1.5);
    expect(store.resolveActive('default').limits.maxToolRounds).toBe(75);
  });

  it('preuve 3 : suite d expériences synthétiques sans coût montant cycle après cycle jusqu à 400 tours (plafond dur)', async () => {
    const engine = new StrategyImprovementEngine({
      proposer: new HeuristicStrategyProposer(),
      store,
      workDir,
      autonomy: 'auto-apply',
    });

    // Échelons géométriques de la mutation ceil(r * 1.5) :
    // 50 -> 75 -> 113 -> 170 -> 255 -> 383 -> 400
    const escalation = [
      { runRounds: 50, expectedCandidate: 75 },
      { runRounds: 75, expectedCandidate: 113 },
      { runRounds: 113, expectedCandidate: 170 },
      { runRounds: 170, expectedCandidate: 255 },
      { runRounds: 255, expectedCandidate: 383 },
      { runRounds: 383, expectedCandidate: 400 },
    ];

    let cyclesAccepted = 0;
    for (const step of escalation) {
      const exp = makeCutExperiences(step.runRounds, `esc-${step.runRounds}`, false);
      const r = await engine.runCycle(exp);
      expect(r.applied).toBe(true);
      expect(r.candidate?.limits.maxToolRounds).toBe(step.expectedCandidate);
      expect(store.resolveActive('default').limits.maxToolRounds).toBe(step.expectedCandidate);
      cyclesAccepted++;
    }

    expect(cyclesAccepted).toBe(6);
    expect(store.resolveActive('default').limits.maxToolRounds).toBe(400);

    // Cycle 7 : Au plafond maximal absolu (400 tours), l'opérateur refuse d'aller au-delà
    const exp400 = makeCutExperiences(400, 'esc-400', false);
    const rTerminal = await engine.runCycle(exp400);
    expect(rTerminal.applied).toBe(false);
    expect(rTerminal.proposalId).toBeNull();
    expect(rTerminal.notes[0]).toContain('no failure signal in the experiences — nothing to mutate');
    expect(store.resolveActive('default').limits.maxToolRounds).toBe(STRATEGY_LIMITS.maxToolRounds.max);
  });

  it('preuve 4 : runs échoués dépassant d emblée la cible de la candidate — rejet pour ties d échec', async () => {
    const engine = new StrategyImprovementEngine({
      proposer: new HeuristicStrategyProposer(),
      store,
      workDir,
      autonomy: 'auto-apply',
    });

    // Des runs qui ont consommé 200 tours (ne réussiraient ni à 50 ni à 75)
    const exp200 = makeCutExperiences(200, 'huge', false);
    const r = await engine.runCycle(exp200);

    // Parent (50) échoue, candidate (75) échoue aussi -> 5 ties (échecs identiques) -> Undecided
    expect(r.applied).toBe(false);
    expect(r.gate?.rejectionReason).toBe('undecided');
    expect(r.gate?.paired?.ties).toBe(5);
    expect(r.gate?.paired?.wins).toBe(0);
    expect(store.resolveActive('default').limits.maxToolRounds).toBe(50);
  });
});
