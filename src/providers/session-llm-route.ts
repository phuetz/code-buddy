/**
 * Route LLM de la session en cours (processus).
 *
 * Les tâches auxiliaires (leçons, mémoire, consolidation…) ne doivent pas
 * redécouvrir un fournisseur « connecté » (OAuth ChatGPT) différent de celui
 * que l'utilisateur a choisi pour la session. L'agent publie ici la clé, le
 * modèle et l'URL réellement utilisés. Aucune clé n'est journalisée.
 */

export interface SessionLlmRoute {
  apiKey: string;
  model: string;
  baseURL: string;
  /** Identifiant catalogue éventuel (`openrouter`, `grok`, `ollama`…). */
  provider?: string;
}

let current: SessionLlmRoute | null = null;

export function setSessionLlmRoute(route: SessionLlmRoute | null): void {
  if (!route) {
    current = null;
    return;
  }
  const apiKey = route.apiKey.trim();
  const model = route.model.trim();
  const baseURL = route.baseURL.trim().replace(/\/+$/, '');
  if (!apiKey || !model || !baseURL) {
    current = null;
    return;
  }
  current = {
    apiKey,
    model,
    baseURL,
    ...(route.provider?.trim() ? { provider: route.provider.trim() } : {}),
  };
}

export function getSessionLlmRoute(): SessionLlmRoute | null {
  return current ? { ...current } : null;
}

/** Efface la route seulement si elle appartient encore à ce client. */
export function clearSessionLlmRouteIfMatches(baseURL: string, apiKey?: string): void {
  if (!current) return;
  const normalized = baseURL.trim().replace(/\/+$/, '');
  if (current.baseURL !== normalized) return;
  if (apiKey !== undefined && current.apiKey !== apiKey) return;
  current = null;
}
