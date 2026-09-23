/**
 * `buddy models list|show`
 *
 * Lit le TOML existant. N'écrit rien. Les tests passent toujours un chemin
 * ou un texte explicite. `refresh` et le cache JSON ne font pas partie de
 * cette version.
 */

import { existsSync, readFileSync } from 'node:fs';
import { Command } from 'commander';

import {
  CatalogueConfigError,
  type CatalogueDocument,
  type CatalogueEntry,
  aliasMap,
  builtinCatalogueEntries,
  capabilityOverlays,
  defaultCatalogueConfigPath,
  mergeCatalogue,
  parseCatalogueConfig,
  resolveRole,
  selectionFromDocument,
} from '../config/model-catalogue.js';
import { findModelToolConfig, getModelToolConfig } from '../config/model-tools.js';

export interface ModelsCommandIO {
  configText?: string;
  configPath?: string;
  profile?: string;
  env?: NodeJS.ProcessEnv;
}

function loadDocument(options: ModelsCommandIO): CatalogueDocument {
  if (options.configText !== undefined) return parseCatalogueConfig(options.configText, 'texte fourni');
  const env = options.env ?? process.env;
  const path = options.configPath ?? (env.CODEBUDDY_CONFIG?.trim() || null);
  if (!path) {
    const discovered = defaultCatalogueConfigPath({ ...env, CODEBUDDY_CONFIG: undefined });
    if (!discovered) return parseCatalogueConfig('', 'texte fourni');
    return parseCatalogueConfig(readFileSync(discovered, 'utf8'), discovered);
  }
  if (!existsSync(path)) {
    throw new CatalogueConfigError(
      `fichier introuvable : ${path}. Créez-le, ou retirez --config.`,
    );
  }
  return parseCatalogueConfig(readFileSync(path, 'utf8'), path);
}

function mergedEntries(document: CatalogueDocument): Record<string, CatalogueEntry> {
  return mergeCatalogue(builtinCatalogueEntries(), document);
}

function shownCapabilities(entry: CatalogueEntry, document: CatalogueDocument): {
  contextWindow: number;
  maxOutputTokens: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsToolCalls: boolean;
} {
  const key = entry.modelId || entry.id;
  const base = getModelToolConfig(key);
  const overlays = capabilityOverlays(document);
  const extra = overlays[entry.id.toLowerCase()] ?? (entry.modelId ? overlays[entry.modelId.toLowerCase()] : undefined);
  return {
    contextWindow: extra?.contextWindow ?? base.contextWindow ?? 32768,
    maxOutputTokens: extra?.maxOutputTokens ?? base.maxOutputTokens ?? 4096,
    supportsReasoning: extra?.supportsReasoning ?? Boolean(base.supportsReasoning),
    supportsVision: extra?.supportsVision ?? Boolean(base.supportsVision),
    supportsToolCalls: extra?.supportsToolCalls ?? Boolean(base.supportsToolCalls),
  };
}

function origin(entry: CatalogueEntry, document: CatalogueDocument, field: string, integrated: boolean): string {
  const patch = document.models[entry.id];
  if (patch?.present.has(field)) return 'configuration';
  return integrated ? 'intégré' : 'repli';
}

export function renderModelsList(options: ModelsCommandIO = {}): string {
  const document = loadDocument(options);
  const entries = mergedEntries(document);
  const lines = [
    'mode: merge',
    `principal: ${resolveRole(document) ?? '(non fixé)'}`,
    'modèles:',
  ];
  const ids = Object.keys(entries).sort();
  for (const id of ids) {
    const entry = entries[id];
    if (!entry) continue;
    const user = document.models[id] ? 'surcharge' : 'intégré';
    const shown = shownCapabilities(entry, document);
    lines.push(`- ${id} [${user}] contexte=${shown.contextWindow}`);
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
    aliases,
  });
  const entry = Object.values(entries).find((candidate) =>
    candidate.id.toLowerCase() === choice.model.toLowerCase()
    || candidate.modelId?.toLowerCase() === choice.model.toLowerCase(),
  ) ?? entries[choice.model];
  if (!entry) {
    throw new CatalogueConfigError(
      `« ${model} » est inconnu du catalogue. Déclarez-le dans [models.<nom>], ou choisissez un nom connu. Aucun autre modèle n'est affiché à sa place`,
    );
  }
  const shown = shownCapabilities(entry, document);
  const integrated = findModelToolConfig(entry.modelId || entry.id) !== null;
  const lines = [
    `id: ${entry.id}`,
    `contexte: ${shown.contextWindow} (${origin(entry, document, 'contextWindow', integrated)})`,
    `sortie: ${shown.maxOutputTokens} (${origin(entry, document, 'maxTokens', integrated)})`,
    `raisonnement: ${String(shown.supportsReasoning)} (${origin(entry, document, 'reasoning', integrated)})`,
    `vision: ${String(shown.supportsVision)} (${origin(entry, document, 'vision', integrated)})`,
    `outils: ${String(shown.supportsToolCalls)} (${origin(entry, document, 'tools', integrated)})`,
    `demandé: ${choice.requested}`,
    `source: ${choice.source}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function createModelsCommand(): Command {
  const models = new Command('models')
    .description('Lister ou afficher le catalogue de modèles');

  models.command('list')
    .description('Affiche le catalogue fusionné et le modèle principal')
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
    .description('Affiche la fiche réellement appliquée d\'un modèle')
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

  return models;
}

function failCommand(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
