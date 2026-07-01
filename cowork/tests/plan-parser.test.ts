import { describe, expect, it } from 'vitest';
import { parsePlanSteps, planRequestPrompt, buildExecutionPrompt } from '../src/renderer/components/plan-parser';

describe('parsePlanSteps', () => {
  it('parses a numbered plan, stripping the lead-in and markdown', () => {
    const reply = [
      'Voici le plan :',
      '1. **Lire** le fichier `config.ts`',
      '2. Ajouter la nouvelle option',
      '3) Écrire un test',
    ].join('\n');
    expect(parsePlanSteps(reply)).toEqual([
      'Lire le fichier config.ts',
      'Ajouter la nouvelle option',
      'Écrire un test',
    ]);
  });

  it('parses bulleted lists too', () => {
    expect(parsePlanSteps('- étape une\n* étape deux\n• étape trois')).toEqual([
      'étape une',
      'étape deux',
      'étape trois',
    ]);
  });

  it('falls back to prose lines when there are no list markers', () => {
    const reply = 'Voici le plan:\nRefactor the parser\nAdd a regression test';
    expect(parsePlanSteps(reply)).toEqual(['Refactor the parser', 'Add a regression test']);
  });

  it('returns [] for empty/garbage', () => {
    expect(parsePlanSteps('')).toEqual([]);
    // @ts-expect-error non-string input
    expect(parsePlanSteps(undefined)).toEqual([]);
  });
});

describe('prompt builders', () => {
  it('planRequestPrompt frames a plan-only turn and includes the task', () => {
    const p = planRequestPrompt('  ajouter le dark mode  ');
    expect(p).toContain('ajouter le dark mode');
    expect(p).toMatch(/pas d'outils|UNIQUEMENT le plan/i);
  });

  it('buildExecutionPrompt numbers the approved steps', () => {
    const p = buildExecutionPrompt('ajouter X', ['faire A', 'faire B']);
    expect(p).toContain('1. faire A');
    expect(p).toContain('2. faire B');
    expect(p).toMatch(/approuvé/i);
    expect(p).toContain('ajouter X');
  });
});
