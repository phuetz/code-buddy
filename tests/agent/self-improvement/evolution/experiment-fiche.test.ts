import { describe, expect, it } from 'vitest';
import { parseExperimentFiche, parseProposalFicheInput, selectExperimentLane } from '../../../../src/agent/self-improvement/evolution/experiment-fiche.js';
import { completeFiche, usageBrief } from './experiment-fixture.js';

describe('DGM experiment fiche', () => {
  it('accepts an observed-first usage brief but refuses one without evidence or thresholds', () => {
    expect(parseProposalFicheInput(usageBrief).lane).toBe('usage');
    expect(() => parseExperimentFiche(usageBrief)).toThrow();
    expect(() => parseProposalFicheInput({ ...usageBrief, problem: { statement: 'Unproven failure' } })).toThrow();
    expect(() => parseProposalFicheInput({ ...usageBrief, acceptance: undefined })).toThrow();
  });
  it('accepts a complete typed fiche and rejects each missing required section', () => {
    expect(parseExperimentFiche(completeFiche).feature.id).toBe('context-rag');
    for (const key of ['problem', 'research', 'feature', 'hypothesis', 'comparison', 'acceptance'] as const) {
      const incomplete = { ...completeFiche } as Record<string, unknown>;
      delete incomplete[key];
      expect(() => parseExperimentFiche(incomplete), key).toThrow();
    }
    expect(() => parseExperimentFiche({ ...completeFiche, surprise: true })).toThrow();
  });

  it('rejects missing evidence, source files, unequal comparison and unmeasurable acceptance', () => {
    expect(() => parseExperimentFiche({ ...completeFiche, problem: { statement: completeFiche.problem.statement } })).toThrow();
    expect(() => parseExperimentFiche({ ...completeFiche, feature: { id: 'context-rag', files: [] } })).toThrow();
    expect(() => parseExperimentFiche({ ...completeFiche, comparison: {
      ...completeFiche.comparison, equalBudget: { ...completeFiche.comparison.equalBudget, runsPerArm: 0 },
    } })).toThrow();
    expect(() => parseExperimentFiche({ ...completeFiche, acceptance: { ...completeFiche.acceptance, minResult: 'good' } })).toThrow();
  });

  it('allocates the next unit toward the configurable target, defaulting to 80/20', () => {
    expect(selectExperimentLane({ usage: 0, research: 0 })).toBe('usage');
    expect(selectExperimentLane({ usage: 4, research: 0 })).toBe('research');
    expect(selectExperimentLane({ usage: 4, research: 1 })).toBe('usage');
    expect(selectExperimentLane({ usage: 1, research: 1 }, { usageShare: 0.25 })).toBe('research');
    expect(selectExperimentLane({ usage: 4, research: 0 }, { usageShare: 0.8 }, 4)).toBe('usage');
    expect(() => selectExperimentLane({ usage: 0, research: 0 }, { usageShare: 1.1 })).toThrow();
  });
});
