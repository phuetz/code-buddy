/**
 * Relie un alias résolu à la session : clé, URL et modèle réellement utilisés.
 * Sans provider ni base_url, la clé et l'URL détectées restent inchangées.
 * Une clé manquante n'emprunte pas la clé d'un autre fournisseur.
 * Une clé ou une URL déjà posées sur la ligne de commande restent prioritaires.
 */

import { resolveProviderFromCatalog } from '../providers/provider-catalog.js';
import { CatalogueConfigError, type StartupModelDecision } from './model-catalogue.js';

type EnvLike = Record<string, string | undefined>;

export interface SessionLaunch {
  apiKey: string;
  baseURL: string;
  model: string;
}

export function sessionLaunchFromDecision(
  current: { apiKey: string; baseURL: string; model: string },
  decision: Pick<StartupModelDecision, 'model' | 'provider' | 'baseUrl'>,
  env: EnvLike,
  cli: { apiKey?: string; baseURL?: string } = {},
): SessionLaunch {
  const model = decision.model?.trim() || current.model;
  const cliKey = cli.apiKey?.trim() ?? '';
  const cliUrl = cli.baseURL?.trim() ?? '';
  if (!decision.provider && !decision.baseUrl) {
    return { apiKey: current.apiKey, baseURL: current.baseURL, model };
  }

  let apiKey = cliKey || current.apiKey;
  let baseURL = cliUrl || current.baseURL;

  if (decision.provider && !cliKey) {
    const resolved = resolveProviderFromCatalog({
      env,
      providerOverride: decision.provider,
      requireConfigured: true,
      hasChatGptOAuth: false,
    });
    if (!resolved?.apiKey.trim()) {
      throw new CatalogueConfigError(
        `l'alias vers « ${model} » demande le fournisseur « ${decision.provider} », mais aucune clé n'est disponible pour lui. La session ne change pas de fournisseur en silence.`,
      );
    }
    apiKey = resolved.apiKey;
    if (!decision.baseUrl && !cliUrl) baseURL = resolved.baseURL;
  }

  if (decision.baseUrl && !cliUrl) baseURL = decision.baseUrl;

  if (!apiKey.trim()) {
    throw new CatalogueConfigError(
      `l'alias vers « ${model} » change l'accès au modèle, mais aucune clé n'est disponible. La session ne démarre pas avec une autre clé.`,
    );
  }
  return { apiKey, baseURL, model };
}
