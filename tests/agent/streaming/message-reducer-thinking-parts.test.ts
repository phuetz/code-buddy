import { describe, it, expect } from 'vitest';
import { reduceStreamChunk } from '../../../src/agent/streaming/message-reducer.js';

/**
 * Séquence RÉELLE capturée le 04/09/2026 sur Mistral Medium 3.5 (`mistral-medium-latest`)
 * avec un prompt de mission : des parties de réflexion en tableau, puis un appel d'outil.
 * Avant le correctif, `content` restait un tableau dont les champs `type` étaient
 * concaténés à chaque chunk et l'exécuteur plantait sur `.trim()`.
 */
const chunk = (delta: Record<string, unknown>) => ({ id: 'x', choices: [{ index: 0, delta }] });

describe('reduceStreamChunk - structured content parts', () => {
  it('flattens Mistral thinking parts into reasoning_content and keeps content a string', () => {
    let acc: Record<string, unknown> = {};
    acc = reduceStreamChunk(acc, chunk({ role: 'assistant', content: '' }));
    for (const piece of ['Je vais ', 'attaquer ', 'cette mission.']) {
      acc = reduceStreamChunk(
        acc,
        chunk({ content: [{ type: 'thinking', thinking: [{ type: 'text', text: piece }] }] }),
      );
    }
    acc = reduceStreamChunk(acc, chunk({ content: [{ type: 'thinking', thinking: [], closed: true }] }));
    acc = reduceStreamChunk(
      acc,
      chunk({ tool_calls: [{ id: 'call_1', type: 'function', index: 0, function: { name: 'bash', arguments: '{"command":"pwd"}' } }] }),
    );

    expect(typeof acc.content).toBe('string');
    expect(acc.content).toBe('');
    expect(acc.reasoning_content).toBe('Je vais attaquer cette mission.');
    expect((acc.tool_calls as Array<{ function: { name: string } }>)[0]?.function.name).toBe('bash');
    expect(() => (acc.content as string).trim()).not.toThrow();
  });

  it('flattens text parts into content (OpenAI-style multimodal reply)', () => {
    let acc: Record<string, unknown> = {};
    acc = reduceStreamChunk(acc, chunk({ content: [{ type: 'text', text: 'Bon' }] }));
    acc = reduceStreamChunk(acc, chunk({ content: [{ type: 'text', text: 'jour' }] }));
    acc = reduceStreamChunk(acc, chunk({ content: ' !' }));
    expect(acc.content).toBe('Bonjour !');
    expect(acc.reasoning_content).toBeUndefined();
  });

  it('keeps plain string content accumulation unchanged', () => {
    let acc: Record<string, unknown> = {};
    acc = reduceStreamChunk(acc, chunk({ content: 'Hello, ' }));
    acc = reduceStreamChunk(acc, chunk({ content: 'world' }));
    expect(acc.content).toBe('Hello, world');
  });
});
