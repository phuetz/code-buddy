import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { CodeBuddyClient } from '../codebuddy/client.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';

export const FactCategorySchema = z.enum([
  'Profil',      // User profile / roles
  'Besoins',     // Goals, tasks, requirements
  'Projet',      // Tech stack, framework, repository structures
  'Preferences', // Code style, formatting, tool preferences
  'Decisions',   // Architectural decisions
  'Conventions'  // Conventions, rules
]);

export type FactCategory = z.infer<typeof FactCategorySchema>;

export const FactSchema = z.object({
  category: FactCategorySchema,
  text: z.string(),
  source: z.string().optional(),
  updatedAt: z.coerce.date().optional()
});

export type Fact = z.infer<typeof FactSchema>;

export class FactsExtractionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'FactsExtractionError';
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export const ReconciliationActionSchema = z.object({
  action: z.enum(['ADD', 'UPDATE', 'DELETE', 'NONE']),
  targetIndex: z.number().optional(),
  fact: FactSchema.optional()
});

export type ReconciliationAction = z.infer<typeof ReconciliationActionSchema>;

export class FactsMemoryService {
  private client: CodeBuddyClient | null = null;

  constructor(client?: CodeBuddyClient) {
    if (client) {
      this.client = client;
    }
  }

  async isAvailable(): Promise<boolean> {
    const client = await this.getClient();
    return client !== null;
  }

  private async getClient(): Promise<CodeBuddyClient | null> {
    if (this.client) return this.client;
    // Skip auto-detecting client in unit tests to prevent timeouts/real API calls
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return null;
    }
    const detected = detectProviderFromEnv();
    if (!detected) {
      logger.warn('[FactsMemory] No LLM provider configuration found.');
      return null;
    }
    this.client = new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL);
    return this.client;
  }

  /**
   * Extract atom facts from a conversation or context block.
   */
  async extractFacts(conversationContext: string): Promise<Fact[]> {
    const client = await this.getClient();
    if (!client) {
      logger.warn('[FactsMemory] LLM Client not available for fact extraction.');
      throw new FactsExtractionError('Fact extraction impossible: LLM client not available');
    }

    const systemPrompt = `You are a structured fact extraction engine for an AI coding assistant.
Your task is to extract atomic, concise, single-sentence facts from the given conversation context.
Do NOT extract sensitive personal details.
Each fact must fall into one of these categories:
- 'Profil': User's background, role, or identity.
- 'Besoins': User's goals, immediate needs, or requirements.
- 'Projet': Information about the project architecture, files, stack, codebase.
- 'Preferences': Code style, formatting, libraries, or tool preferences.
- 'Decisions': Architectural or design decisions.
- 'Conventions': Coding conventions or guidelines.

Output the result strictly as a JSON array of objects with "category" and "text" fields.
Example:
[
  {"category": "Projet", "text": "The project uses ESM modules and Vitest for testing."}
]`;

    const userPrompt = `Extract facts from the following text:\n\n${conversationContext}`;

    try {
      const { generateJsonWithRetry } = await import('../utils/llm-retry.js');
      const generateFn = async (prompt: string): Promise<string> => {
        const response = await client.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ], undefined, { responseFormat: 'json' });
        return response.choices[0]?.message?.content || '';
      };

      const result = await generateJsonWithRetry<any[]>(generateFn, userPrompt);
      const parsed = z.array(FactSchema.partial()).parse(result);

      return parsed
        .filter((f): f is Fact => !!f.category && !!f.text)
        .map(f => ({
          category: f.category,
          text: f.text,
          source: 'auto-captured',
          updatedAt: new Date()
        }));
    } catch (error: unknown) {
      if (error instanceof FactsExtractionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[FactsMemory] Failed to extract facts: ${message}`);
      throw new FactsExtractionError(`Fact extraction impossible: ${message}`, { cause: error });
    }
  }

  /**
   * Reconcile current memory state with newly extracted facts.
   * Emits transaction actions (ADD, UPDATE, DELETE, NONE) to resolve obsolescences/contradictions.
   */
  async reconcileFacts(currentFacts: Fact[], newFacts: Fact[]): Promise<Fact[]> {
    if (newFacts.length === 0) return currentFacts;

    const client = await this.getClient();
    if (!client) {
      return currentFacts;
    }

    const systemPrompt = `You are a fact memory reconciliation engine.
Your task is to compare the current list of facts (currentFacts) and a new list of facts (newFacts).
Reconcile them and output a list of transaction actions to apply to currentFacts.
Supported transaction actions:
- 'ADD': Add a new fact that is not already represented in currentFacts.
- 'UPDATE': Update an existing fact in currentFacts (by its 0-based targetIndex) if the new fact provides updated/changed/corrected information.
- 'DELETE': Delete an existing fact in currentFacts (by its 0-based targetIndex) if the information is now obsolete or contradicted.
- 'NONE': Do nothing (e.g. if the new fact is already present or redundant).

Your output must be a JSON array of objects containing:
- "action": one of "ADD", "UPDATE", "DELETE", "NONE"
- "targetIndex": (required for UPDATE and DELETE) the 0-based index of the fact in currentFacts
- "fact": (required for ADD and UPDATE) the updated or new fact object with "category" and "text"

Output the result strictly as a JSON array of transaction actions.`;

    const userPrompt = `currentFacts:\n${JSON.stringify(currentFacts, null, 2)}\n\nnewFacts:\n${JSON.stringify(newFacts, null, 2)}`;

    try {
      const { generateJsonWithRetry } = await import('../utils/llm-retry.js');
      const generateFn = async (prompt: string): Promise<string> => {
        const response = await client.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ], undefined, { responseFormat: 'json' });
        return response.choices[0]?.message?.content || '';
      };

      const actions = await generateJsonWithRetry<ReconciliationAction[]>(generateFn, userPrompt);
      const parsedActions = z.array(ReconciliationActionSchema).parse(actions);

      const resultFacts = [...currentFacts];

      // Sort updates/deletes in descending order of index to avoid offset shift while modifying
      const sortedActions = [...parsedActions].sort((a, b) => {
        const idxA = a.targetIndex ?? -1;
        const idxB = b.targetIndex ?? -1;
        return idxB - idxA;
      });

      for (const item of sortedActions) {
        if (item.action === 'ADD' && item.fact) {
          resultFacts.push({
            category: item.fact.category,
            text: item.fact.text,
            source: item.fact.source || 'reconciliation',
            updatedAt: new Date()
          });
        } else if (item.action === 'UPDATE' && item.targetIndex !== undefined && item.fact) {
          const idx = item.targetIndex;
          const existing = resultFacts[idx];
          if (idx >= 0 && idx < resultFacts.length && existing) {
            resultFacts[idx] = {
              category: item.fact.category,
              text: item.fact.text,
              source: existing.source || 'reconciliation',
              updatedAt: new Date()
            };
          }
        } else if (item.action === 'DELETE' && item.targetIndex !== undefined) {
          const idx = item.targetIndex;
          if (idx >= 0 && idx < resultFacts.length) {
            resultFacts.splice(idx, 1);
          }
        }
      }

      return resultFacts;
    } catch (error: any) {
      // Audit 2026-09-02 : ne PAS retourner currentFacts ici — le nouveau fait
      // serait perdu alors que l'appelant annoncerait « Stored ». On propage :
      // remember() et autoCapture() ont chacun un catch avec un repli
      // d'écriture directe qui préserve le souvenir.
      logger.error(`[FactsMemory] Failed to reconcile facts: ${error.message}`);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
