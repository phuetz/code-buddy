/**
 * NLI-style relation classifier for the knowledge graph: given a new discovery and a topical
 * neighbour, decide whether it SUPPORTS (corroborates), CONTRADICTS (opposing result), or is
 * merely RELATED. Embeddings find same-topic neighbours; only a judge tells "works" from
 * "doesn't work" — this is the "ce qui marche / ne marche pas" signal across any domain.
 *
 * Lazy + graceful: with no provider configured it declines (everything stays `related_to`),
 * never throws. $0 on a local model.
 *
 * @module research/relation-classifier
 */

import type { RelationClassifier } from '../memory/collective-knowledge-graph.js';

interface MinimalClient {
  chat(
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[],
  ): Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
}

export function makeLlmRelationClassifier(): RelationClassifier {
  let clientPromise: Promise<MinimalClient | null> | null = null;
  const getClient = (): Promise<MinimalClient | null> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const { createAuxiliaryClient } = await import('../providers/auxiliary-llm.js');
          return createAuxiliaryClient('relation') as unknown as MinimalClient;
        } catch {
          return null;
        }
      })();
    }
    return clientPromise;
  };

  return async (subjectText, neighborText): Promise<'supports' | 'contradicts' | 'related_to'> => {
    const client = await getClient();
    if (!client) return 'related_to';
    try {
      const prompt = [
        'Tu compares deux découvertes scientifiques.',
        `A: ${subjectText.slice(0, 500)}`,
        `B: ${neighborText.slice(0, 500)}`,
        'Est-ce que A CONFIRME B (résultats concordants), CONTREDIT B (résultats opposés sur la même question),',
        'ou est seulement RELIÉ (même sujet, sans confirmer ni contredire) ?',
        'Réponds par UN seul mot : SUPPORTS, CONTRADICTS, ou RELATED.',
      ].join('\n');
      const resp = await client.chat([{ role: 'user', content: prompt }], []);
      const t = (resp?.choices?.[0]?.message?.content ?? '').toUpperCase();
      if (t.includes('CONTRADICT')) return 'contradicts';
      if (t.includes('SUPPORT')) return 'supports';
      return 'related_to';
    } catch {
      return 'related_to';
    }
  };
}
