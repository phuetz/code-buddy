import { expect, it } from 'vitest';
import { budgetFinalPayload, EVICTION_CHUNK } from '../../src/context/final-payload-budget.js';
import type { OpenAiChatPayload } from '../../src/codebuddy/providers/ollama-native-transport.js';

// Banc harnais 03/10 (A-27b-initial, requêtes 32-39) : la réduction finale,
// sans état, retirait « juste assez » de pensées anciennes ; chaque requête
// déplaçait la coupe d'un message et Ollama réévaluait ~93 K jetons (117 s)
// à chaque tour au lieu de réutiliser son cache de préfixe.

type Message = OpenAiChatPayload['messages'][number];

function group(i: number, thinking: string, observation: string): Message[] {
  return [
    { role: 'assistant', content: `step ${i}`, ollama_thinking: thinking, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'view_file', arguments: `{"path":"f${i}.ts"}` } }] },
    { role: 'tool', tool_call_id: `c${i}`, content: observation },
  ];
}

function payload(groups: number, thinking: (i: number) => string, observation: (i: number) => string): OpenAiChatPayload {
  const messages: Message[] = [
    { role: 'system', content: 'Follow the task.' },
    { role: 'user', content: 'Fix the module and verify it.' },
  ];
  for (let i = 0; i < groups; i++) messages.push(...group(i, thinking(i), observation(i)));
  return { model: 'qwen3.8:27b', max_tokens: 1024, messages };
}

const scope = { workDir: process.cwd(), sessionId: 'payload-prefix-stability' };

/** Include the previous latest group: changing it also rewinds a recurrent cache. */
function stableHead(first: OpenAiChatPayload): number {
  return first.messages.length;
}

it('garde la même tête de requête en requête quand les pensées anciennes sont retirées', () => {
  const thinking = (i: number) => `Reasoning ${i}: ` + 'inspect the module, compare call sites, plan edit. '.repeat(40);
  const observation = (i: number) => `export const value${i} = ${i};`;
  const first = budgetFinalPayload(payload(12, thinking, observation), 8192, scope).payload;
  const second = budgetFinalPayload(payload(13, thinking, observation), 8192, scope).payload;
  const head = stableHead(first);
  expect(head).toBeGreaterThan(10);
  expect(second.messages.slice(0, head)).toEqual(first.messages.slice(0, head));
});

it('évince les groupes anciens par blocs : la coupe ne bouge pas à chaque requête', () => {
  const thinking = () => 'short';
  const observation = (i: number) => Array.from({ length: 60 }, (_, k) => `line ${i}.${k} result=${(i * 31 + k * 7) % 97}`).join('\n');
  const first = budgetFinalPayload(payload(14, thinking, observation), 8192, scope).payload;
  const second = budgetFinalPayload(payload(15, thinking, observation), 8192, scope).payload;
  const evicted = (14 * 2 + 2 - first.messages.length) / 2;
  expect(evicted).toBeGreaterThan(0);
  expect(evicted % EVICTION_CHUNK).toBe(0);
  const head = stableHead(first);
  expect(second.messages.slice(0, head)).toEqual(first.messages.slice(0, head));
});
