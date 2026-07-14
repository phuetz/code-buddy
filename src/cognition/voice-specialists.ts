import { CodeBuddyClient } from '../codebuddy/client.js';
import type { CognitiveMesh } from './cognitive-mesh.js';
import { CognitiveBudgetLedger } from './budget-reservations.js';
import {
  LlmCognitiveSpecialist,
  type CognitiveChatClient,
} from './llm-specialist.js';

export interface CognitiveModelRoute {
  apiKey: string;
  model: string;
  baseURL: string;
}

export interface VoiceSpecialistRegistration {
  enabled: boolean;
  reason: string;
  specialistIds: string[];
  budget: CognitiveBudgetLedger;
}

export function isLoopbackCognitiveRoute(baseURL: string): boolean {
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

function defaultClient(route: CognitiveModelRoute): CognitiveChatClient {
  const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL, {
    enableFallbacks: false,
    enableCredentialPool: false,
  });
  return {
    chat: async (messages, options) => {
      const response = await client.chat(messages as never, [], {
        signal: options.signal,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        // A local-only transcript must never enter cross-provider fallback.
        disableProviderFallback: true,
      });
      return {
        content: response.choices?.[0]?.message?.content ?? '',
        promptTokens: response.usage?.prompt_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };
    },
  };
}

export function registerDefaultVoiceSpecialists(
  mesh: CognitiveMesh,
  route: CognitiveModelRoute,
  options: {
    enabled?: boolean;
    maxActivationsPerHour?: number;
    clientFactory?: (route: CognitiveModelRoute, specialistId: string) => CognitiveChatClient;
    budget?: CognitiveBudgetLedger;
  } = {},
): VoiceSpecialistRegistration {
  const requestedMaxActivations = Number(options.maxActivationsPerHour ?? 30);
  const maxActivationsPerHour = Number.isFinite(requestedMaxActivations)
    ? Math.max(1, Math.floor(requestedMaxActivations))
    : 30;
  const budget = options.budget ?? new CognitiveBudgetLedger({
    maxActivationsPerHour,
    maxUsdPerHour: 0,
  });
  if (options.enabled === false) {
    return { enabled: false, reason: 'disabled', specialistIds: [], budget };
  }
  if (!isLoopbackCognitiveRoute(route.baseURL)) {
    return { enabled: false, reason: 'route-not-loopback', specialistIds: [], budget };
  }

  const providerGroup = `local-cognition:${new URL(route.baseURL).origin}`;
  const definitions = [
    {
      id: 'conversation-reflector',
      role: 'réflexion conversationnelle',
      outputKind: 'hypothesis' as const,
      systemPrompt:
        "Tu es la réflexion silencieuse de Lisa. Formule en une phrase française l'idée, le besoin ou la nuance durable qui pourrait rendre le prochain échange plus profond. Ne rédige pas une réponse à l'utilisateur. N'invente aucun fait.",
    },
    {
      id: 'conversation-critic',
      role: 'critique de réponse',
      outputKind: 'proposal' as const,
      systemPrompt:
        "Tu es le critique silencieux de Lisa. Identifie en une phrase française une faiblesse concrète de sa réponse ou un angle utile à reprendre au prochain tour. Si la réponse est déjà bonne, indique la meilleure piste d'approfondissement. N'invente aucun fait.",
    },
  ];
  const clientFactory = options.clientFactory ?? ((selectedRoute) => defaultClient(selectedRoute));
  for (const definition of definitions) {
    const specialist = new LlmCognitiveSpecialist({
      ...definition,
      model: route.model,
      providerGroup,
      privacyClearance: 'local-only',
      subscriptions: ['result'],
      client: clientFactory(route, definition.id),
      budget,
      estimatedUsd: 0,
      maxTokens: 140,
      minInputChars: 60,
      ttlMs: 10 * 60_000,
    });
    mesh.register(specialist.definition());
  }
  return {
    enabled: true,
    reason: 'local-persistent-specialists',
    specialistIds: definitions.map((definition) => definition.id),
    budget,
  };
}
