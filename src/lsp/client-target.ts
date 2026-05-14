import type { AICompletionConfig } from './ai-completion-provider.js';
import {
  detectProviderFromEnv,
  selectModelForDetectedProvider,
  selectModelForExplicitBaseURL,
} from '../utils/provider-detector.js';

export interface CodeBuddyLSPSettings {
  apiKey: string;
  baseURL?: string;
  model: string;
  enableDiagnostics: boolean;
  enableCompletions: boolean;
  maxTokens: number;
  /** AI inline completion settings */
  aiCompletion?: Partial<AICompletionConfig>;
}

export interface CodeBuddyLSPClientTarget {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export function resolveCodeBuddyLSPClientTarget(
  settings: CodeBuddyLSPSettings,
): CodeBuddyLSPClientTarget | null {
  if (settings.apiKey) {
    return {
      apiKey: settings.apiKey,
      model: selectModelForExplicitBaseURL(settings.baseURL, settings.model) || settings.model,
      baseURL: settings.baseURL,
    };
  }

  const provider = detectProviderFromEnv();
  if (!provider) {
    return null;
  }

  return {
    apiKey: provider.apiKey,
    model: selectModelForDetectedProvider(provider, settings.model),
    baseURL: provider.baseURL,
  };
}
