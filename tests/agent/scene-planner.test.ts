/**
 * scene-planner — LLM plan (injected) + normalization.
 */
import { describe, it, expect } from 'vitest';
import {
  planScenes,
  normalizeScenes,
  buildPlannerSystemPrompt,
} from '../../src/agent/film/scene-planner.js';

describe('normalizeScenes', () => {
  it('accepts {scenes:[...]} or a bare array and cleans entries', () => {
    const raw = {
      scenes: [
        { title: 'Intro', narration: 'Bonjour', visual: { kind: 'text' } },
        {
          title: 'Archi',
          narration: 'Voici',
          visual: { kind: 'diagram', mermaid: 'flowchart LR\nA-->B' },
        },
      ],
    };
    const out = normalizeScenes(raw, 6);
    expect(out).toHaveLength(2);
    expect(out[1]!.visual).toEqual({ kind: 'diagram', mermaid: 'flowchart LR\nA-->B' });
  });

  it('drops a diagram without mermaid down to a text card', () => {
    const out = normalizeScenes([{ title: 'X', narration: 'y', visual: { kind: 'diagram' } }], 6);
    expect(out[0]!.visual).toEqual({ kind: 'text' });
  });

  it('skips empty entries and defaults missing fields', () => {
    const out = normalizeScenes([{}, { narration: 'seule' }], 6);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Sans titre');
    expect(out[0]!.narration).toBe('seule');
  });
});

describe('planScenes (injected LLM)', () => {
  it('returns planned scenes from the model JSON', async () => {
    const canned = JSON.stringify({
      scenes: [
        {
          title: 'Le tri rapide',
          subtitle: 'diviser pour régner',
          narration: 'Le tri rapide partitionne autour d un pivot.',
          visual: { kind: 'text' },
        },
        {
          title: 'Partition',
          narration: 'On place les petits à gauche.',
          visual: { kind: 'diagram', mermaid: 'flowchart TD\nP-->L\nP-->R' },
        },
      ],
    });
    let seenSystem = '';
    const scenes = await planScenes(
      'le tri rapide',
      { count: 2 },
      {
        chat: async (system) => {
          seenSystem = system;
          return canned;
        },
      }
    );
    expect(scenes).toHaveLength(2);
    expect(scenes[0]!.title).toBe('Le tri rapide');
    expect(scenes[1]!.visual.kind).toBe('diagram');
    expect(seenSystem).toContain('scénariste');
  });

  it('tolerates JSON wrapped in prose/fences (via generateJsonWithRetry)', async () => {
    const scenes = await planScenes(
      'x',
      { count: 1 },
      {
        chat: async () =>
          'Voici le plan:\n```json\n{"scenes":[{"title":"A","narration":"b"}]}\n```',
      }
    );
    expect(scenes[0]!.title).toBe('A');
  });

  it('throws when the model yields no usable scenes', async () => {
    await expect(planScenes('x', {}, { chat: async () => '{"scenes":[]}' })).rejects.toThrow(
      /aucune scène/i
    );
  });
});

describe('buildPlannerSystemPrompt', () => {
  it('mentions the count, language and JSON contract', () => {
    const p = buildPlannerSystemPrompt(5, 'français');
    expect(p).toContain('5 scènes');
    expect(p).toContain('français');
    expect(p).toContain('"scenes"');
  });
});
