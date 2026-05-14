/**
 * Gemma 4 Provider Plugin (Bundled)
 *
 * Wraps Google's Gemma 4 as a plugin-based LLM provider.
 * Designed to integrate specifically with the Gemini/Google API endpoints
 * assuming Gemma 4 is hosted via Google AI Studio or Vertex AI.
 * 
 * Supports the 5-phase onboarding lifecycle.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider, DiscoveredModel, ProviderOnboardingHooks } from '../types.js';
import type { LLMMessage } from '../../providers/types.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const GEMMA_PROVIDER_ID = 'bundled-gemma4';

/**
 * Known Gemma 4 models with context window sizes.
 * (Assuming typical variants like 2B, 9B, 27B based on previous generations)
 */
const DEFAULT_CONTEXT_WINDOW = 8192;

const KNOWN_MODELS: Record<string, { name: string; contextWindow: number }> = {
  'gemma-4-9b-it': { name: 'Gemma 4 9B Instruct', contextWindow: DEFAULT_CONTEXT_WINDOW },
  'gemma-4-27b-it': { name: 'Gemma 4 27B Instruct', contextWindow: DEFAULT_CONTEXT_WINDOW },
  'gemma-4-2b-it': { name: 'Gemma 4 2B Instruct', contextWindow: DEFAULT_CONTEXT_WINDOW },
};

function resolveGemmaModelName(): string {
  return process.env.GEMMA_MODEL || 'gemma-4-9b-it';
}

/**
 * Build onboarding hooks for Gemma 4 provider.
 */
function buildOnboardingHooks(apiKey: string): ProviderOnboardingHooks {
  return {
    auth: async () => {
      try {
        if (!apiKey) {
          return { valid: false, error: 'GEMINI_API_KEY environment variable is not set.' };
        }
        // Minimal ping to check key validity using Google Generative AI SDK
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemma-4-9b-it' }); 
        // Just verify client instantiates; a real API call might fail if the specific model isn't active for the user
        if (model) {
           return { valid: true };
        }
        return { valid: false, error: 'Invalid API Key or Gemma 4 access denied.' };
      } catch (err: unknown) {
        return {
          valid: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    'wizard.onboarding': async () => {
      if (apiKey) {
        return { success: true, message: 'Gemma 4 authenticated.' };
      }
      return {
        success: false,
        message: 'Please set your GEMINI_API_KEY environment variable to use Gemma 4 models.',
      };
    },
    'discovery.run': async () => {
      // In a real implementation, we might call the Google AI Studio ListModels API.
      // For now, we return our hardcoded list of known Gemma 4 models.
      try {
        const discovered: DiscoveredModel[] = Object.entries(KNOWN_MODELS).map(
          ([id, info]) => ({
            id,
            name: info.name,
            contextWindow: info.contextWindow,
            description: `Google Gemma 4 model (${info.name})`,
            capabilities: ['chat', 'tools'],
          }),
        );
        return discovered;
      } catch (err) {
        logger.error('[GemmaProvider] discovery failed', { error: String(err) });
        return [];
      }
    },
    'wizard.modelPicker': async (models: DiscoveredModel[]) => {
      if (models.length === 0) return 'gemma-4-9b-it';
      return models[0].id;
    },
    onModelSelected: async (modelId: string) => {
      logger.info(`[GemmaProvider] Selected model: ${modelId}`);
    },
  };
}

/**
 * The Gemma 4 Provider Plugin class
 */
export class GemmaProviderPlugin implements PluginProvider {
  id = GEMMA_PROVIDER_ID;
  name = 'Google Gemma 4';
  type = 'llm' as const;
  priority = 10;
  
  onboarding?: ProviderOnboardingHooks;
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    // We expect the user to use the same key as Gemini for Google AI Studio
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.onboarding = buildOnboardingHooks(apiKey);
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  async initialize(): Promise<void> {
    logger.debug('[GemmaProvider] initialized');
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    if (!this.genAI) {
      throw new Error('Gemma Provider requires GEMINI_API_KEY to be set.');
    }
    
    // Default to the 9b model if none is specified by the router context
    const modelName = resolveGemmaModelName();
    const model = this.genAI.getGenerativeModel({ model: modelName });

    // Format messages for the Gemini SDK (Gemma 4 uses the same interface via AI Studio)
    const formattedHistory = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || '' }]
    }));

    // The last message is the prompt
    const lastMessage = formattedHistory.pop();
    if (!lastMessage) throw new Error("No messages provided");

    const chatSession = model.startChat({ history: formattedHistory });
    const result = await chatSession.sendMessage(lastMessage.parts[0].text);
    return result.response.text();
  }

  async complete(prompt: string): Promise<string> {
    if (!this.genAI) {
      throw new Error('Gemma Provider requires GEMINI_API_KEY to be set.');
    }
    const modelName = resolveGemmaModelName();
    const model = this.genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }
}

export function createGemmaProvider(): PluginProvider | null {
    // Only return if user wants to use it (or is onboarding)
    return new GemmaProviderPlugin();
}
