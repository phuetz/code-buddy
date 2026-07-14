import { describe, expect, it, vi } from 'vitest';
import { CognitiveBudgetLedger } from '../../src/cognition/budget-reservations.js';
import { LlmCognitiveSpecialist } from '../../src/cognition/llm-specialist.js';
import { GlobalWorkspace } from '../../src/cognition/global-workspace.js';

describe('LlmCognitiveSpecialist', () => {
  it('produces only a bounded tentative draft and forwards cancellation', async () => {
    const client = {
      chat: vi.fn(async (_messages, options: { signal: AbortSignal }) => {
        expect(options.signal.aborted).toBe(false);
        return { content: '<think>privé</think> Une piste utile. '.repeat(100), promptTokens: 20, totalTokens: 30 };
      }),
    };
    const specialist = new LlmCognitiveSpecialist({
      id: 'reflector',
      role: 'reflection',
      model: 'local-model',
      providerGroup: 'gpu:local',
      privacyClearance: 'local-only',
      subscriptions: ['result'],
      systemPrompt: 'Réfléchis.',
      client,
      budget: new CognitiveBudgetLedger({ maxActivationsPerHour: 2, maxUsdPerHour: 0 }),
      outputKind: 'hypothesis',
      minInputChars: 1,
    });
    const workspace = new GlobalWorkspace();
    const utterance = workspace.publish({
      kind: 'utterance', producerId: 'voice', correlationId: 'turn', salience: 1,
      confidence: 1, privacy: 'local-only', provenance: { source: 'test' },
      ttlMs: 60_000, payload: { content: 'Parlons de la mémoire.' },
    })!;
    const result = workspace.publish({
      kind: 'result', producerId: 'voice', correlationId: 'turn', salience: 1,
      confidence: 1, privacy: 'local-only', provenance: { source: 'test' },
      ttlMs: 60_000, payload: { content: 'Oui, approfondissons ce sujet.' },
    })!;
    const drafts = await specialist.definition().activate({
      trigger: result,
      workspace: [utterance, result],
      signal: new AbortController().signal,
    });
    expect(client.chat).toHaveBeenCalledOnce();
    expect(drafts).toHaveLength(1);
    expect(drafts?.[0]).toMatchObject({ kind: 'hypothesis', privacy: 'local-only' });
    expect(String((drafts?.[0]?.payload as { summary: string }).summary)).not.toContain('<think>');
    expect((drafts?.[0]?.payload as { summary: string }).summary.length).toBeLessThanOrEqual(700);
  });

  it('does not spend budget or call the model for tiny turns', async () => {
    const client = { chat: vi.fn() };
    const budget = new CognitiveBudgetLedger({ maxActivationsPerHour: 1, maxUsdPerHour: 0 });
    const specialist = new LlmCognitiveSpecialist({
      id: 'critic', role: 'critic', model: 'local', providerGroup: 'gpu',
      privacyClearance: 'local-only', subscriptions: ['result'], systemPrompt: 'Critique.',
      client, budget, minInputChars: 100,
    });
    const workspace = new GlobalWorkspace();
    const result = workspace.publish({
      kind: 'result', producerId: 'voice', correlationId: 'short', salience: 1,
      confidence: 1, privacy: 'local-only', provenance: { source: 'test' },
      ttlMs: 60_000, payload: { content: 'Merci.' },
    })!;
    expect(await specialist.definition().activate({
      trigger: result, workspace: [result], signal: new AbortController().signal,
    })).toEqual([]);
    expect(client.chat).not.toHaveBeenCalled();
    expect(budget.snapshot('critic').activations).toBe(0);
  });
});
