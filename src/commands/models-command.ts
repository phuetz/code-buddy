/**
 * `buddy models list|show|refresh`
 *
 * Lit le TOML existant. N'écrit que le cache de contexte, à côté du fichier
 * indiqué ou via `--cache`. Les tests passent toujours un chemin explicite.
 */

import { existsSync, readFileSync } from 'node:fs';
import { Command } from 'commander';

import {
  CatalogueConfigError,
  type CatalogueDocument,
  type CatalogueEntry,
  aliasMap,
  builtinCatalogueEntries,
  defaultContextCachePath,
  defaultCatalogueConfigPath,
  discoverContextWindow,
  emptyContextCache,
  mergeCatalogue,
  parseCatalogueConfig,
  readContextCache,
  resolveRole,
  selectionFromDocument,
  writeContextCache,
} from '../config/model-catalogue.js';

export interface ModelsCommandIO {
  configText?: string;
  configPath?: string;
  profile?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: number;
  cachePath?: string;
  cacheText?: string;
  baseURL?: string;
  provider?: 'ollama' | 'openai';
  model?: string;
}

function loadDocument(options: ModelsCommandIO): CatalogueDocument {
  if (options.configText !== undefined) return parseCatalogueConfig(options.configText);
  const env = options.env ?? process.env;
  const path = options.configPath ?? (env.CODEBUDDY_CONFIG?.trim() || null);
  if (!path) {
    const discovered = defaultCatalogueConfigPath({ ...env, CODEBUDDY_CONFIG: undefined });
    if (!discovered) return parseCatalogueConfig('');
    return parseCatalogueConfig(readFileSync(discovered, 'utf8'));
  }
  if (!existsSync(path)) {
    throw new CatalogueConfigError(`fichier introuvable : ${path}`);
  }
  return parseCatalogueConfig(readFileSync(path, 'utf8'));
}

function mergedEntries(document: CatalogueDocument): Record<string, CatalogueEntry> {
  return mergeCatalogue(builtinCatalogueEntries(), document);
}

export function renderModelsList(options: ModelsCommandIO = {}): string {
  const document = loadDocument(options);
  const entries = mergedEntries(document);
  const lines = [
    `mode: ${document.mode}`,
    `principal: ${resolveRole(document, 'primary', options.profile) ?? '(catalogue intégré)'}`,
    `rapide: ${resolveRole(document, 'fast', options.profile) ?? '(non fixé)'}`,
    `vision: ${resolveRole(document, 'vision', options.profile) ?? '(non fixé)'}`,
    'modèles:',
  ];
  const ids = Object.keys(entries).sort();
  for (const id of ids) {
    const entry = entries[id];
    if (!entry) continue;
    const user = document.models[id] ? 'surcharge' : 'intégré';
    const context = entry.contextWindow ?? 'n/d';
    lines.push(`- ${id} [${user}] contexte=${context} fournisseur=${entry.provider ?? 'n/d'}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderModelShow(model: string, options: ModelsCommandIO = {}): string {
  const document = loadDocument(options);
  const entries = mergedEntries(document);
  const aliases = aliasMap(document);
  const choice = selectionFromDocument(document, {
    cli: model,
    profileName: options.profile,
    builtin: null,
    aliases,
  });
  const entry = Object.values(entries).find((candidate) =>
    candidate.id.toLowerCase() === choice.model.toLowerCase()
    || candidate.modelId?.toLowerCase() === choice.model.toLowerCase(),
  ) ?? entries[choice.model];
  if (!entry) {
    throw new CatalogueConfigError(`« ${model} » est inconnu du catalogue. Aucun autre modèle n'est affiché à sa place`);
  }
  const patch = document.models[entry.id];
  const origin = (field: string): string => (patch?.present.has(field) ? 'configuration' : 'intégré');
  const lines = [
    `id: ${entry.id}`,
    `modèle: ${entry.modelId ?? entry.id}`,
    `fournisseur: ${entry.provider ?? 'n/d'} (${origin('provider')})`,
    `contexte: ${entry.contextWindow ?? 'n/d'} (${origin('contextWindow')})`,
    `sortie: ${entry.maxTokens ?? 'n/d'} (${origin('maxTokens')})`,
    `raisonnement: ${String(entry.reasoning ?? 'n/d')} (${origin('reasoning')})`,
    `vision: ${String(entry.vision ?? 'n/d')} (${origin('vision')})`,
    `outils: ${String(entry.tools ?? 'n/d')} (${origin('tools')})`,
    `demandé: ${choice.requested}`,
    `source: ${choice.source}`,
  ];
  return `${lines.join('\n')}\n`;
}

export async function refreshModelContext(options: ModelsCommandIO = {}): Promise<{ message: string; cachePath: string }> {
  const model = options.model?.trim();
  const baseURL = options.baseURL?.trim();
  if (!model) throw new CatalogueConfigError('refresh exige un nom de modèle');
  if (!baseURL) throw new CatalogueConfigError('refresh exige une adresse de fournisseur');
  const provider = options.provider ?? 'ollama';
  if (provider !== 'ollama' && provider !== 'openai') {
    throw new CatalogueConfigError(`fournisseur de découverte « ${provider} » inconnu`);
  }
  const document = loadDocument(options);
  const cachePath = options.cachePath
    ?? (options.configPath ? defaultContextCachePath(options.configPath) : null);
  if (!cachePath) {
    throw new CatalogueConfigError('refresh exige --cache ou --config, pour ne pas écrire dans un profil non choisi');
  }
  const cache = options.cacheText !== undefined
    ? readContextCache(options.cacheText)
    : (existsSync(cachePath) ? readContextCache(readFileSync(cachePath, 'utf8')) : emptyContextCache());
  const discovered = await discoverContextWindow({
    source: provider,
    baseURL,
    model,
    cache,
    now: options.now ?? Date.now(),
    ttlMs: document.ttlSeconds * 1000,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
  if (!options.cacheText) writeContextCache(cachePath, discovered.cache);
  const via = discovered.fromCache ? 'cache' : 'fournisseur';
  return {
    cachePath,
    message: `contexte de « ${model} » : ${discovered.contextWindow} (source ${via})\n`,
  };
}

export function createModelsCommand(): Command {
  const models = new Command('models')
    .description('Lister, afficher ou rafraîchir le catalogue de modèles');

  models.command('list')
    .description('Affiche le catalogue fusionné et les rôles')
    .option('--config <path>', 'Fichier de configuration TOML')
    .option('--profile <name>', 'Profil nommé')
    .action((options: { config?: string; profile?: string }) => {
      try {
        process.stdout.write(renderModelsList({
          ...(options.config ? { configPath: options.config } : {}),
          ...(options.profile ? { profile: options.profile } : {}),
        }));
      } catch (error) {
        failCommand(error);
      }
    });

  models.command('show')
    .argument('<model>', 'Nom, alias ou identifiant')
    .description('Affiche la fiche fusionnée d\'un modèle')
    .option('--config <path>', 'Fichier de configuration TOML')
    .option('--profile <name>', 'Profil nommé')
    .action((model: string, options: { config?: string; profile?: string }) => {
      try {
        process.stdout.write(renderModelShow(model, {
          ...(options.config ? { configPath: options.config } : {}),
          ...(options.profile ? { profile: options.profile } : {}),
        }));
      } catch (error) {
        failCommand(error);
      }
    });

  models.command('refresh')
    .description('Redécouvre la fenêtre de contexte et met le cache à jour')
    .requiredOption('--model <model>', 'Modèle à interroger')
    .requiredOption('--base-url <url>', 'Adresse du fournisseur, par exemple http://127.0.0.1:11434')
    .option('--provider <kind>', 'ollama ou openai', 'ollama')
    .option('--config <path>', 'Fichier de configuration TOML')
    .option('--cache <path>', 'Fichier de cache à écrire')
    .action(async (options: { model: string; baseUrl: string; provider?: string; config?: string; cache?: string }) => {
      try {
        if (options.provider && options.provider !== 'ollama' && options.provider !== 'openai') {
          throw new CatalogueConfigError(`fournisseur de découverte « ${options.provider} » inconnu`);
        }
        const result = await refreshModelContext({
          model: options.model,
          baseURL: options.baseUrl,
          provider: options.provider === 'openai' ? 'openai' : 'ollama',
          ...(options.config ? { configPath: options.config } : {}),
          ...(options.cache ? { cachePath: options.cache } : {}),
        });
        process.stdout.write(result.message);
      } catch (error) {
        failCommand(error);
      }
    });

  return models;
}

function failCommand(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
