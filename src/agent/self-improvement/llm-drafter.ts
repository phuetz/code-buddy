/**
 * Real LLM-backed lesson drafter. Wires the self-improvement proposer to the
 * agent's own model so the engine can DISCOVER novel improvements from run
 * friction — then the deterministic empirical gate validates each draft. Lazy
 * and graceful: if no provider is configured, the drafter declines (returns
 * null) and the engine simply finds no LLM proposal, never crashes.
 *
 * @module agent/self-improvement/llm-drafter
 */

import { buildLessonDraftPrompt, type LessonDraft, type LessonDrafter } from './proposer.js';

interface MinimalClient {
  chat(
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[],
  ): Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
}

export function createLlmDrafter(options: { explicitModel?: string } = {}): LessonDrafter {
  let clientPromise: Promise<MinimalClient | null> | null = null;

  const getClient = (): Promise<MinimalClient | null> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const { resolveCommandProvider } = await import('../../commands/llm-provider-resolution.js');
          const resolved = resolveCommandProvider(options.explicitModel ? { explicitModel: options.explicitModel } : {});
          if (resolved?.apiKey) {
            const { CodeBuddyClient } = await import('../../codebuddy/client.js');
            return new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL) as unknown as MinimalClient;
          }
          const { detectProviderFromEnv } = await import('../../utils/provider-detector.js');
          const { CodeBuddyClient } = await import('../../codebuddy/client.js');
          const detected = detectProviderFromEnv();
          if (!detected) return null;
          return new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL) as unknown as MinimalClient;
        } catch {
          return null;
        }
      })();
    }
    return clientPromise;
  };

  return async (scenario, experiences): Promise<LessonDraft | null> => {
    const client = await getClient();
    if (!client) return null;
    try {
      // Ground the draft in the collective AI knowledge base (CKG) when it has been fed —
      // ingested AI research makes self-improvement easier and better-founded. Optional/empty-safe.
      let knowledge: string[] = [];
      try {
        const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
        const q = `${scenario.query ?? ''} ${scenario.description ?? ''}`.trim();
        // Hybrid (semantic+keyword) retrieval — degrades to keyword if embeddings are unavailable.
        knowledge = (await getCollectiveKnowledgeGraph().recallHybrid(q, { limit: 3 })).map((r) => r.text);
      } catch {
        /* CKG optional — proceed with no external knowledge */
      }
      const prompt = buildLessonDraftPrompt(scenario, experiences, knowledge);
      const response = await client.chat([{ role: 'user', content: prompt }], []);
      const text = response?.choices?.[0]?.message?.content?.trim();
      if (!text) return null;
      // The empirical gate enforces relevance/structure downstream; here we only
      // pass through the model's text as a RULE lesson.
      return { category: 'RULE', content: text };
    } catch {
      return null;
    }
  };
}
