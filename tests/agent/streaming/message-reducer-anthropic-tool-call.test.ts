/**
 * D3 (validation Anthropic du 2026-10-08) — l'endpoint OpenAI-compatible
 * d'Anthropic répète `"type":"function"` dans CHAQUE delta de `tool_calls`.
 * Le réducteur concaténait toute chaîne rencontrée : l'assistant renvoyé au
 * tour 2 portait `"type":"functionfunctionfunction…"` → 400
 * `messages.2.assistant.tool_calls.0.type: Input should be 'function'`.
 *
 * Le flux ci-dessous est un enregistrement réel (haiku-5-5, 08/10/2026).
 */
import { describe, expect, it } from 'vitest';
import { reduceStreamChunk } from '../../../src/agent/streaming/index.js';
import { sseChunks } from '../../helpers/anthropic-replay.js';

function reduceAll(chunks: unknown[]): Record<string, unknown> {
  return chunks.reduce<Record<string, unknown>>((acc, c) => reduceStreamChunk(acc, c), {});
}

describe('reduceStreamChunk — flux d’outil enregistré chez Anthropic', () => {
  it('garde type, id et nom à leur première valeur', () => {
    const message = reduceAll(sseChunks('stream-tool-call.sse'));
    const toolCalls = message.tool_calls as Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.type).toBe('function');
    expect(toolCalls[0]?.id).toBe('toolu_01G6nHVcSDk6pYdUxtK8RCoo');
    expect(toolCalls[0]?.function?.name).toBe('get_weather');
    expect(JSON.parse(toolCalls[0]?.function?.arguments ?? '')).toEqual({ city: 'Paris' });
    expect(message.role).toBe('assistant');
  });

  it('ne répète pas le rôle ni l’identifiant quand un fournisseur les renvoie à chaque delta', () => {
    const chunk = (delta: Record<string, unknown>): unknown => ({ choices: [{ index: 0, delta }] });
    const message = reduceAll([
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '' } }] }),
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path"' } }] }),
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: ':"a.txt"}' } }] }),
    ]);
    const call = (message.tool_calls as Array<Record<string, unknown>>)[0] as {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    };
    expect(message.role).toBe('assistant');
    expect(call.id).toBe('call_1');
    expect(call.type).toBe('function');
    expect(call.function.name).toBe('read_file');
    expect(call.function.arguments).toBe('{"path":"a.txt"}');
  });

  it('continue de recoller un nom d’outil réellement fragmenté', () => {
    const chunk = (name: string): unknown => ({
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name } }] } }],
    });
    const message = reduceAll([chunk('get_'), chunk('weather')]);
    const call = (message.tool_calls as Array<{ function: { name: string } }>)[0];
    expect(call?.function.name).toBe('get_weather');
  });

  it('concatène toujours le texte du contenu', () => {
    const message = reduceAll(sseChunks('stream-text-pong.sse'));
    expect(message.content).toBe('pong');
  });
});
