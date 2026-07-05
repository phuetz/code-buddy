import { describe, expect, it } from 'vitest';

import { classifyIntent } from '../src/renderer/utils/intent-classify';

describe('classifyIntent', () => {
  it('classifies research prompts', () => {
    expect(classifyIntent('Cherche les meilleures sources pour un rapport IA').kind).toBe('research');
  });

  it('classifies build prompts', () => {
    expect(classifyIntent('Implémente un composant React et corrige le bug').kind).toBe('build');
  });

  it('classifies create prompts', () => {
    expect(classifyIntent('Crée un deck de slides pour cette présentation').kind).toBe('create');
  });

  it('classifies analyze prompts', () => {
    expect(classifyIntent('Analyse ce CSV et construis un tableau de métriques').kind).toBe('analyze');
  });

  it('classifies automation prompts', () => {
    expect(classifyIntent('Automatise ce workflow dans le browser').kind).toBe('automate');
  });

  it('classifies communication prompts', () => {
    expect(classifyIntent('Réponds au mail puis poste un message Slack').kind).toBe('communicate');
  });

  it('falls back for unknown prompts', () => {
    expect(classifyIntent('bonjour').kind).toBe('other');
  });
});
