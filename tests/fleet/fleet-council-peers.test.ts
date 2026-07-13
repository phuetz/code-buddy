import { describe, it, expect } from 'vitest';
import { gatherPeerAnswers, type CouncilPeer } from '../../src/commands/council.js';

function peer(id: string, impl: CouncilPeer['listener']['request']): CouncilPeer {
  return { id, listener: { request: impl } };
}

describe('gatherPeerAnswers — fold remote machines into the council', () => {
  it('collects answers from healthy peers and tags them by peer:model', async () => {
    const peers = [
      peer('peerA', async () => ({ text: 'réponse A', modelRequested: 'qwen2.5:7b', usage: { total_tokens: 42 } })),
      peer('peerB', async () => ({ text: 'réponse B', modelRequested: 'gemma4' })),
    ];
    const { answers, errors } = await gatherPeerAnswers('q', peers, 1000);
    expect(errors).toHaveLength(0);
    expect(answers.map((a) => a.modelName)).toEqual(['peerA:qwen2.5:7b', 'peerB:gemma4']);
    expect(answers[0]!.content).toBe('réponse A');
    expect(answers[0]!.tokensUsed).toBe(42);
    expect(answers.every((a) => a.cost === 0)).toBe(true);
  });

  it('drops a failing/slow/empty peer into errors — never crashes the council', async () => {
    const peers = [
      peer('ok', async () => ({ text: 'good', modelRequested: 'm' })),
      peer('boom', async () => {
        throw new Error('peer timeout >45s');
      }),
      peer('empty', async () => ({ text: '   ', modelRequested: 'm' })),
    ];
    const { answers, errors } = await gatherPeerAnswers('q', peers, 1000);
    expect(answers.map((a) => a.modelId)).toEqual(['ok']);
    expect(errors.map((e) => e.id).sort()).toEqual(['boom', 'empty']);
    expect(errors.find((e) => e.id === 'boom')!.message).toMatch(/timeout/);
  });

  it('sanitizes peer output before it reaches the council judge', async () => {
    const peers = [
      peer('local-model', async () => ({
        text: '<think>private reasoning</think>réponse',
        modelRequested: 'qwen',
      })),
    ];

    const { answers, errors } = await gatherPeerAnswers('q', peers, 1000);

    expect(errors).toHaveLength(0);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.content).toBe('réponse');
  });

  it('treats peer output emptied by sanitization as a failed answer', async () => {
    const peers = [
      peer('reasoning-only', async () => ({
        text: '<think>private reasoning</think>',
        modelRequested: 'qwen',
      })),
    ];

    const { answers, errors } = await gatherPeerAnswers('q', peers, 1000);

    expect(answers).toHaveLength(0);
    expect(errors).toEqual([{ id: 'reasoning-only', message: 'réponse vide' }]);
  });

  it('returns empty when there are no peers', async () => {
    const { answers, errors } = await gatherPeerAnswers('q', [], 1000);
    expect(answers).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
