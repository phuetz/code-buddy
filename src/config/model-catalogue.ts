/**
 * Catalogue de modèles surchargeable.
 *
 * S'appuie sur le TOML existant (`config.toml`, profils, `--profile`).
 * Le catalogue intégré reste la base. Une surcharge n'écrit que les champs
 * présents : le reste est conservé. Rien ici ne lit ni n'écrit le profil
 * réel si l'appelant fournit le texte ou un chemin explicite.
 *
 * Cette version ne découvre pas les modèles et n'écrit pas de cache.
 * `provider` sur une entrée `[models.*]` reste une colonne historique : il ne
 * choisit pas le fournisseur. `provider` et `base_url` sur un alias, eux, sont
 * le fournisseur et l'URL de la session. `model_id` utilisateur est refusé,
 * sauf s'il répète l'identifiant intégré.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findRuntimeProvider } from '../providers/provider-catalog.js';
import { installCataloguePriceOverlays, type ModelPricing } from './model-pricing.js';
import { findModelToolConfig, installModelCatalogueOverlays } from './model-tools.js';
import { ownValue } from './own-lookup.js';
import { getModelRegistry } from './model-registry.js';
import { DEFAULT_CONFIG, parseTOML, registerCatalogueWriteCheck, resolveUserConfigFile } from './toml-config.js';

export class CatalogueConfigError extends Error {
  constructor(detail: string) {
    super(`Configuration de modèle invalide : ${detail}`);
    this.name = 'CatalogueConfigError';
  }
}

export type CatalogueSource = 'cli' | 'env' | 'profile' | 'user' | 'settings' | 'detected';

export interface CatalogueEntry {
  id: string;
  provider?: string;
  modelId?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  tools?: boolean;
  input?: Array<'text' | 'image'>;
  costInputPerMillion?: number;
  costOutputPerMillion?: number;
  description?: string;
}

export interface CataloguePatch {
  id: string;
  present: ReadonlySet<string>;
  values: Partial<CatalogueEntry>;
}

export interface CatalogueRoles {
  primary?: string;
}

/** Cible d'un alias. `provider` et `baseUrl` absents : la session garde le fournisseur détecté. */
export interface ModelAliasTarget {
  model: string;
  provider?: string;
  baseUrl?: string;
}

export interface CatalogueDocument {
  mode: 'merge';
  activeModel?: string;
  roles: CatalogueRoles;
  aliases: Record<string, ModelAliasTarget>;
  models: Record<string, CataloguePatch>;
  profiles: Record<string, { activeModel?: string }>;
}

export interface PriorityInput {
  cli?: string | null;
  env?: string | null;
  profile?: string | null;
  user?: string | null;
  settings?: string | null;
  detected?: string | null;
}

export interface ResolvedChoice {
  model: string;
  source: CatalogueSource;
  /** Jeton d'origine si un alias a été résolu. Identique à `model` sinon. */
  requested: string;
  /** Vrai si au moins un alias a été suivi avant la lecture du catalogue. */
  viaAlias: boolean;
  /** Fournisseur demandé par l'alias le plus proche du nom saisi. */
  provider?: string;
  /** URL demandée par l'alias le plus proche du nom saisi. */
  baseUrl?: string;
}

export interface StartupDetectedProvider {
  provider: string;
  defaultModel: string;
}

export interface StartupModelRequest {
  argv?: readonly string[];
  /** Modèle déjà lu par l'appelant (`--model`). Gagne sur `argv`. */
  cli?: string | null;
  env?: NodeJS.ProcessEnv;
  configText?: string;
  configPath?: string | null;
  allowUserHome?: boolean;
  readDefaultPath?: boolean;
  settingsModel?: string | null;
  detected?: StartupDetectedProvider | null;
  isCompatible?: (model: string, provider: string | undefined) => boolean;
}

export interface StartupModelDecision {
  model: string | null;
  source: CatalogueSource | 'none';
  /** Vrai si le modèle vient d'un alias résolu avant le catalogue. */
  viaAlias?: boolean;
  /** Présent seulement si l'alias choisit le fournisseur de la session. */
  provider?: string;
  /** Présent seulement si l'alias choisit l'URL de la session. */
  baseUrl?: string;
}

const ENTRY_KEYS = [
  'provider',
  'modelId',
  'contextWindow',
  'maxTokens',
  'reasoning',
  'vision',
  'tools',
  'input',
  'costInputPerMillion',
  'costOutputPerMillion',
  'description',
] as const;

/** Valeur écrite par le fichier généré. Ce n'est pas un choix explicite. */
export const GENERATED_ACTIVE_MODEL = DEFAULT_CONFIG.active_model;

/** Fusion champ à champ. Les champs absents du patch restent. */
export function mergeCatalogueEntry(
  base: CatalogueEntry | null,
  patch: CataloguePatch,
): CatalogueEntry {
  const merged: CatalogueEntry = { ...(base ?? { id: patch.id }), id: patch.id };
  for (const key of patch.present) {
    if (key === 'id') continue;
    const value = patch.values[key as keyof CatalogueEntry];
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

export function mergeCatalogue(
  builtin: Readonly<Record<string, CatalogueEntry>>,
  document: CatalogueDocument,
): Record<string, CatalogueEntry> {
  const merged: Record<string, CatalogueEntry> = { ...builtin };
  for (const [id, patch] of Object.entries(document.models)) {
    const base = ownValue<CatalogueEntry>(builtin, id) ?? findBuiltinByModelId(builtin, id);
    merged[id] = mergeCatalogueEntry(base, patch);
  }
  return merged;
}

/**
 * Fusionne deux documents déjà analysés. `over` (le projet) gagne champ par champ.
 * On n'assemble pas les textes : une clé racine du second fichier ne tombe pas
 * dans la dernière section du premier.
 */
export function mergeCatalogueDocuments(
  base: CatalogueDocument,
  over: CatalogueDocument,
): CatalogueDocument {
  const models: Record<string, CataloguePatch> = { ...base.models };
  for (const [id, patch] of Object.entries(over.models)) {
    const previous = ownValue<CataloguePatch>(models, id);
    if (!previous) {
      models[id] = patch;
      continue;
    }
    models[id] = {
      id,
      present: new Set<string>([...previous.present, ...patch.present]),
      values: { ...previous.values, ...patch.values },
    };
  }
  const profiles = { ...base.profiles };
  for (const [name, profile] of Object.entries(over.profiles)) {
    const previous = ownValue<CatalogueDocument['profiles'][string]>(profiles, name);
    profiles[name] = { ...previous, ...profile };
  }
  const roles: CatalogueRoles = { ...base.roles };
  if (over.roles.primary) roles.primary = over.roles.primary;
  return {
    mode: 'merge',
    ...(over.activeModel ?? base.activeModel ? { activeModel: over.activeModel ?? base.activeModel } : {}),
    roles,
    aliases: { ...base.aliases, ...over.aliases },
    models,
    profiles,
  };
}

/**
 * Premier jeton non vide. Le résultat est ce jeton (ou sa cible d'alias),
 * jamais un autre modèle « de secours ».
 * Ordre réel du démarrage : voir `resolveStartupModel`, qui est le seul appelant
 * de production. Il ne remplit pas de niveau au-delà de `detected`.
 */
export function resolveModelByPriority(
  input: PriorityInput,
  aliases: ReadonlyMap<string, ModelAliasTarget> = new Map(),
): ResolvedChoice {
  const ordered: Array<[CatalogueSource, string | null | undefined]> = [
    ['cli', input.cli],
    ['env', input.env],
    ['profile', input.profile],
    ['user', input.user],
    ['settings', input.settings],
    ['detected', input.detected],
  ];
  for (const [source, raw] of ordered) {
    const requested = raw?.trim();
    if (!requested) continue;
    const resolved = resolveAliasChain(requested, aliases);
    return {
      model: resolved.model,
      source,
      requested,
      viaAlias: resolved.viaAlias,
      ...(resolved.provider ? { provider: resolved.provider } : {}),
      ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
    };
  }
  throw new CatalogueConfigError(
    'aucun modèle n\'est défini (ligne de commande, environnement, profil, configuration, réglage sauvé ou fournisseur détecté)',
  );
}

export function parseCatalogueConfig(content: string, source = 'texte fourni'): CatalogueDocument {
  assertClosedSections(content, source);
  const meaningful = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (meaningful.length === 0) {
    return emptyDocument();
  }
  const recognized = meaningful.filter((line) => /^\[[^\]]+\]$/.test(line) || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line));
  if (recognized.length === 0) {
    throw new CatalogueConfigError(
      `le fichier ne contient aucune clé TOML reconnaissable (${source}). Écrivez des clés du type active_model = "nom" ou des sections [models.nom].`,
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseTOML(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CatalogueConfigError(
      `analyse TOML impossible (${source}) : ${detail}. Corrigez la ligne signalée et relancez.`,
    );
  }
  return documentFromParsed(parsed, source);
}

export function selectionFromDocument(
  document: CatalogueDocument,
  options: {
    cli?: string | null;
    env?: string | null;
    profileName?: string | null;
    settings?: string | null;
    detected?: string | null;
    aliases?: ReadonlyMap<string, ModelAliasTarget>;
  } = {},
): ResolvedChoice {
  const profileName = options.profileName ?? null;
  assertProfileSelectable(document, profileName);
  const profile = lookupProfile(document, profileName);
  const aliases = options.aliases ?? aliasMap(document);
  const choice = resolveModelByPriority(
    {
      cli: options.cli,
      env: options.env,
      profile: profileName ? profile.activeModel : null,
      user: explicitUserModel(document),
      settings: options.settings,
      detected: options.detected,
    },
    aliases,
  );
  if (choice.viaAlias || choice.source === 'profile' || choice.source === 'user') {
    assertKnownModel(choice.model, document, aliases, choice.source, choice.requested);
  }
  return choice;
}

export function resolveRole(document: CatalogueDocument): string | null {
  return explicitUserModel(document);
}

export function builtinCatalogueEntries(): Record<string, CatalogueEntry> {
  const entries: Record<string, CatalogueEntry> = {};
  for (const [id, model] of Object.entries(DEFAULT_CONFIG.models)) {
    entries[id] = {
      id,
      provider: model.provider,
      ...(model.model_id ? { modelId: model.model_id } : {}),
      contextWindow: model.max_context_tokens,
      costInputPerMillion: model.price_per_m_input,
      costOutputPerMillion: model.price_per_m_output,
      ...(model.description ? { description: model.description } : {}),
    };
  }
  return entries;
}

export function aliasMap(
  document: CatalogueDocument,
  extra?: ReadonlyMap<string, string>,
): Map<string, ModelAliasTarget> {
  const map = new Map<string, ModelAliasTarget>();
  const base = extra ?? getModelRegistry().getAliases();
  for (const [alias, target] of base) map.set(alias.toLowerCase(), { model: target });
  for (const [alias, target] of Object.entries(document.aliases)) {
    map.set(alias.toLowerCase(), target);
  }
  return map;
}

export function canonicalModelId(entry: CatalogueEntry): string {
  return entry.modelId?.trim() || entry.id;
}

export function defaultCatalogueConfigPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.CODEBUDDY_CONFIG?.trim();
  const candidate = resolveUserConfigFile(env);
  if (explicit) {
    if (!existsSync(candidate)) {
      throw new CatalogueConfigError(
        `fichier introuvable : ${explicit}. Créez-le, ou retirez CODEBUDDY_CONFIG pour revenir au fichier par défaut.`,
      );
    }
    return candidate;
  }
  return existsSync(candidate) ? candidate : null;
}

/**
 * Relit le TOML et échoue clairement s'il est invalide.
 * Sans `allowUserHome`, seul `CODEBUDDY_CONFIG` ou `CODEBUDDY_HOME` est lu :
 * le profil de la session n'est pas ouvert par accident.
 */
export function assertUserCatalogue(
  env: NodeJS.ProcessEnv = process.env,
  allowUserHome = false,
): CatalogueDocument | null {
  return readCatalogueDocument({ allowUserHome, readDefaultPath: allowUserHome }, env);
}

/**
 * Modèle explicitement choisi dans le TOML (profil, puis configuration).
 * `null` si ce niveau ne fixe rien — l'appelant garde alors l'environnement,
 * le réglage sauvé ou le fournisseur détecté.
 * Le `active_model` du fichier généré (`grok-code-fast`) ne compte pas.
 */
export function selectConfiguredModel(options: {
  argv?: readonly string[];
  configText?: string;
  configPath?: string | null;
  env?: NodeJS.ProcessEnv;
  readDefaultPath?: boolean;
  allowUserHome?: boolean;
} = {}): string | null {
  const env = options.env ?? process.env;
  const document = readCatalogueDocument(options, env);
  if (!document) return null;
  const profileName = profileNameFromArgv(options.argv ?? []);
  assertProfileSelectable(document, profileName);
  const profile = lookupProfile(document, profileName);
  const profileModel = profileName ? profile.activeModel : null;
  const userModel = explicitUserModel(document);
  if (!profileModel && !userModel) return null;
  const aliases = aliasMap(document);
  const choice = resolveModelByPriority(
    { profile: profileModel, user: userModel },
    aliases,
  );
  assertKnownModel(choice.model, document, aliases, choice.source, choice.requested);
  const merged = mergeCatalogue(builtinCatalogueEntries(), document);
  const entry = findEntry(merged, choice.model);
  return entry ? canonicalModelId(entry) : choice.model;
}

/**
 * Chaîne unique du démarrage. `loadModel` dans `src/index.ts` appelle cette
 * fonction et s'arrête dès qu'elle rend un modèle. Le fournisseur Ollama
 * n'est pas tranché ici : sans choix explicite, l'appelant garde sa sonde
 * des modèles installés.
 */
export function resolveStartupModel(request: StartupModelRequest = {}): StartupModelDecision {
  const env = request.env ?? process.env;
  const document = readCatalogueDocument(request, env);
  const profileName = profileNameFromArgv(request.argv ?? []);
  assertProfileSelectable(document, profileName);
  const profile = lookupProfile(document, profileName);
  const aliases = document ? aliasMap(document) : aliasMap(emptyDocument());
  const cli = firstText(request.cli) ?? modelFromArgv(request.argv ?? []);
  const envModel = firstText(env.CODEBUDDY_MODEL) ?? firstText(env.GROK_MODEL);
  const profileModel = profileName ? profile.activeModel : null;
  const userModel = document ? explicitUserModel(document) : null;
  if (cli || envModel || profileModel || userModel) {
    const choice = resolveModelByPriority(
      { cli, env: envModel, profile: profileModel, user: userModel },
      aliases,
    );
    ensureAliasTarget(choice, document);
    if (document && (choice.source === 'profile' || choice.source === 'user')) {
      if (!choice.viaAlias) {
        assertKnownModel(choice.model, document, aliases, choice.source, choice.requested);
      }
      const merged = mergeCatalogue(builtinCatalogueEntries(), document);
      const entry = findEntry(merged, choice.model);
      return startupDecision(entry ? canonicalModelId(entry) : choice.model, choice.source, choice);
    }
    return startupDecision(choice.model, choice.source, choice);
  }

  if (request.detected?.provider === 'ollama') {
    return { model: null, source: 'none' };
  }

  const compatible = request.isCompatible ?? (() => true);
  const settings = firstText(request.settingsModel);
  const detectedModel = firstText(request.detected?.defaultModel);
  const settingsOk = Boolean(settings) && compatible(settings ?? '', request.detected?.provider);
  if (!settingsOk && !detectedModel) return { model: null, source: 'none' };
  const choice = resolveModelByPriority(
    {
      settings: settingsOk ? settings : null,
      detected: detectedModel,
    },
    aliases,
  );
  ensureAliasTarget(choice, document);
  return startupDecision(choice.model, choice.source, choice);
}

export function capabilityOverlays(document: CatalogueDocument): Record<string, {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  supportsToolCalls?: boolean;
}> {
  const merged = mergeCatalogue(builtinCatalogueEntries(), document);
  const overlays: Record<string, {
    contextWindow?: number;
    maxOutputTokens?: number;
    supportsReasoning?: boolean;
    supportsVision?: boolean;
    supportsToolCalls?: boolean;
  }> = {};
  for (const [id, patch] of Object.entries(document.models)) {
    const entry = merged[id];
    if (!entry) continue;
    const overlay: {
      contextWindow?: number;
      maxOutputTokens?: number;
      supportsReasoning?: boolean;
      supportsVision?: boolean;
      supportsToolCalls?: boolean;
    } = {};
    if (patch.present.has('contextWindow') && entry.contextWindow !== undefined) overlay.contextWindow = entry.contextWindow;
    if (patch.present.has('maxTokens') && entry.maxTokens !== undefined) overlay.maxOutputTokens = entry.maxTokens;
    if (patch.present.has('reasoning') && entry.reasoning !== undefined) overlay.supportsReasoning = entry.reasoning;
    if (patch.present.has('vision') && entry.vision !== undefined) overlay.supportsVision = entry.vision;
    if (patch.present.has('tools') && entry.tools !== undefined) overlay.supportsToolCalls = entry.tools;
    if (Object.keys(overlay).length === 0) continue;
    overlays[id.toLowerCase()] = overlay;
    if (entry.modelId) overlays[entry.modelId.toLowerCase()] = overlay;
  }
  return overlays;
}

export function priceOverlays(document: CatalogueDocument): Record<string, ModelPricing> {
  const merged = mergeCatalogue(builtinCatalogueEntries(), document);
  const overlays: Record<string, ModelPricing> = {};
  for (const [id, patch] of Object.entries(document.models)) {
    if (!patch.present.has('costInputPerMillion') || !patch.present.has('costOutputPerMillion')) continue;
    const price: ModelPricing = {
      inputPerMillion: patch.values.costInputPerMillion ?? 0,
      outputPerMillion: patch.values.costOutputPerMillion ?? 0,
    };
    overlays[id.toLowerCase()] = price;
    const entry = merged[id];
    if (entry?.modelId) overlays[entry.modelId.toLowerCase()] = price;
  }
  return overlays;
}

/** Applique les surcharges de capacités et de prix. `null` les retire. */
export function activateCatalogue(document: CatalogueDocument | null): void {
  installModelCatalogueOverlays(document ? capabilityOverlays(document) : null);
  installCataloguePriceOverlays(document ? priceOverlays(document) : null);
}

/** Relit le TOML, applique les surcharges, et échoue clairement s'il est invalide. */
export function loadAndActivateUserCatalogue(
  env: NodeJS.ProcessEnv = process.env,
  allowUserHome = false,
): CatalogueDocument | null {
  const document = assertUserCatalogue(env, allowUserHome);
  activateCatalogue(document);
  return document;
}

function explicitConfigPath(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.CODEBUDDY_CONFIG?.trim();
  const home = env.CODEBUDDY_HOME?.trim();
  if (!explicit && !home) return null;
  const candidate = resolveUserConfigFile(env);
  if (explicit && !existsSync(candidate)) {
    throw new CatalogueConfigError(
      `fichier introuvable : ${explicit}. Créez-le, ou retirez CODEBUDDY_CONFIG pour revenir au fichier par défaut.`,
    );
  }
  return existsSync(candidate) ? candidate : null;
}

function readCatalogueDocument(
  options: {
    configText?: string;
    configPath?: string | null;
    readDefaultPath?: boolean;
    allowUserHome?: boolean;
  },
  env: NodeJS.ProcessEnv,
): CatalogueDocument | null {
  if (options.configText !== undefined) {
    return parseCatalogueConfig(options.configText, 'texte fourni');
  }
  if (options.configPath) {
    return parseCatalogueConfig(readCatalogueFile(options.configPath), options.configPath);
  }
  if (options.readDefaultPath === false && !options.allowUserHome) return null;
  const userPath = options.allowUserHome ? defaultCatalogueConfigPath(env) : explicitConfigPath(env);
  let document = userPath ? parseCatalogueConfig(readCatalogueFile(userPath), userPath) : null;
  if (!options.allowUserHome) return document;
  const projectPath = join(process.cwd(), '.codebuddy', 'config.toml');
  if (!existsSync(projectPath) || projectPath === userPath) return document;
  const project = parseCatalogueConfig(readCatalogueFile(projectPath), projectPath);
  return document ? mergeCatalogueDocuments(document, project) : project;
}

function readCatalogueFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new CatalogueConfigError(
        `fichier introuvable : ${filePath}. Créez-le, ou retirez le chemin de la configuration.`,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new CatalogueConfigError(
      `lecture impossible de ${filePath} (${detail}). Vérifiez les droits du fichier et relancez.`,
    );
  }
}

function assertClosedSections(content: string, source: string): void {
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? '';
    if (!trimmed.startsWith('[')) continue;
    if (/^\[[^\]]+\]$/.test(trimmed)) continue;
    throw new CatalogueConfigError(
      `section non fermée « ${trimmed} » (${source}, ligne ${index + 1}). Fermez le crochet, par exemple [catalogue].`,
    );
  }
}

function emptyDocument(): CatalogueDocument {
  return {
    mode: 'merge',
    roles: {},
    aliases: {},
    models: {},
    profiles: {},
  };
}

function documentFromParsed(parsed: Record<string, unknown>, source: string): CatalogueDocument {
  const document = emptyDocument();
  const catalogue = asRecord(parsed.catalogue);
  if (parsed.catalogue !== undefined && !catalogue) {
    throw new CatalogueConfigError(`la section [catalogue] doit être une table (${source}).`);
  }
  if (catalogue) {
    for (const key of Object.keys(catalogue)) {
      if (key === 'mode') continue;
      throw new CatalogueConfigError(
        `clé « ${key} » inconnue dans [catalogue] (${source}). Cette version ne lit que mode = "merge". Retirez la clé.`,
      );
    }
    if (catalogue.mode !== undefined) {
      const mode = String(catalogue.mode).trim().toLowerCase();
      if (mode === 'replace') {
        throw new CatalogueConfigError(
          `mode « replace » n'est pas pris en charge dans cette version (${source}). Écrivez mode = "merge" : une entrée ne remplace que les champs qu'elle écrit.`,
        );
      }
      if (mode !== 'merge') {
        throw new CatalogueConfigError(`mode « ${String(catalogue.mode)} » inconnu (attendu : merge) (${source}).`);
      }
    }
  }
  if (typeof parsed.active_model === 'string' && parsed.active_model.trim()) {
    document.activeModel = parsed.active_model.trim();
  } else if (parsed.active_model !== undefined && parsed.active_model !== '') {
    throw new CatalogueConfigError(`active_model doit être une chaîne non vide (${source}).`);
  }
  document.roles = parseRoles(parsed.model_roles, source);
  document.aliases = parseAliases(parsed.model_aliases, source);
  document.models = parseModels(parsed.models, source);
  document.profiles = parseProfiles(parsed.profiles, source);
  for (const [id, patch] of Object.entries(document.models)) {
    const hasIn = patch.present.has('costInputPerMillion');
    const hasOut = patch.present.has('costOutputPerMillion');
    if (hasIn !== hasOut) {
      throw new CatalogueConfigError(
        `« ${id} » : price_per_m_input et price_per_m_output doivent être écrits ensemble (${source}). Complétez les deux, ou retirez le prix.`,
      );
    }
  }
  if (document.roles.primary) document.activeModel = document.roles.primary;
  return document;
}

function parseRoles(value: unknown, source: string): CatalogueRoles {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new CatalogueConfigError(`la section [model_roles] doit être une table (${source}).`);
  const roles: CatalogueRoles = {};
  for (const [key, raw] of Object.entries(record)) {
    if (key !== 'primary') {
      throw new CatalogueConfigError(
        `le rôle « ${key} » n'est pas pris en charge dans cette version (${source}). Seul primary choisit le modèle de la session. Retirez cette clé.`,
      );
    }
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new CatalogueConfigError(`le rôle primary doit être un nom de modèle non vide (${source}).`);
    }
    roles.primary = raw.trim();
  }
  return roles;
}

function parseAliases(value: unknown, source: string): Record<string, ModelAliasTarget> {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new CatalogueConfigError(`la section [model_aliases] doit être une table (${source}).`);
  const aliases: Record<string, ModelAliasTarget> = {};
  for (const [alias, target] of Object.entries(record)) {
    aliases[alias] = parseAliasTarget(alias, target, source);
  }
  return aliases;
}

function parseAliasTarget(alias: string, target: unknown, source: string): ModelAliasTarget {
  if (typeof target === 'string') {
    if (!target.trim()) {
      throw new CatalogueConfigError(
        `l'alias « ${alias} » doit désigner un modèle non vide (${source}). Corrigez la cible, ou retirez l'alias.`,
      );
    }
    return { model: target.trim() };
  }
  const record = asRecord(target);
  if (!record) {
    throw new CatalogueConfigError(
      `l'alias « ${alias} » doit être un nom de modèle ou une table model, provider, base_url (${source}).`,
    );
  }
  for (const key of Object.keys(record)) {
    if (key !== 'model' && key !== 'provider' && key !== 'base_url') {
      throw new CatalogueConfigError(
        `champ inconnu « ${key} » sur l'alias « ${alias} » (${source}). Les champs lus sont model, provider et base_url.`,
      );
    }
  }
  if (typeof record.model !== 'string' || !record.model.trim()) {
    throw new CatalogueConfigError(
      `l'alias « ${alias} » doit désigner un modèle non vide (${source}). Corrigez model, ou retirez l'alias.`,
    );
  }
  const parsed: ModelAliasTarget = { model: record.model.trim() };
  if (record.provider !== undefined) {
    if (typeof record.provider !== 'string' || !record.provider.trim()) {
      throw new CatalogueConfigError(`l'alias « ${alias} ».provider doit être un nom non vide (${source}).`);
    }
    parsed.provider = record.provider.trim();
  }
  if (record.base_url !== undefined) {
    if (typeof record.base_url !== 'string' || !isHttpUrl(record.base_url)) {
      throw new CatalogueConfigError(
        `l'alias « ${alias} ».base_url doit être une URL http ou https (${source}).`,
      );
    }
    parsed.baseUrl = record.base_url.trim().replace(/\/$/, '');
  }
  return parsed;
}

function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseModels(value: unknown, source: string): Record<string, CataloguePatch> {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new CatalogueConfigError(`la section [models] doit être une table (${source}).`);
  const models: Record<string, CataloguePatch> = {};
  for (const [id, raw] of Object.entries(record)) {
    const table = asRecord(raw);
    if (!table) throw new CatalogueConfigError(`le modèle « ${id} » doit être une table (${source}).`);
    models[id] = patchFromTable(id, table, source);
  }
  return models;
}

function parseProfiles(value: unknown, source: string): CatalogueDocument['profiles'] {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new CatalogueConfigError(`la section [profiles] doit être une table (${source}).`);
  const profiles: CatalogueDocument['profiles'] = {};
  for (const [name, raw] of Object.entries(record)) {
    const table = asRecord(raw);
    if (!table) continue;
    const profile: { activeModel?: string } = {};
    if (table.fast_model !== undefined || table.vision_model !== undefined) {
      throw new CatalogueConfigError(
        `le profil « ${name} » utilise fast_model ou vision_model, qui ne sont pas pris en charge dans cette version (${source}). Seul active_model choisit un modèle. Retirez ces clés.`,
      );
    }
    if (table.active_model !== undefined) {
      if (typeof table.active_model !== 'string' || !table.active_model.trim()) {
        throw new CatalogueConfigError(`le profil « ${name} » a un active_model vide (${source}). Donnez un nom, ou retirez la clé.`);
      }
      profile.activeModel = table.active_model.trim();
    }
    profiles[name] = profile;
  }
  return profiles;
}

function patchFromTable(id: string, table: Record<string, unknown>, source: string): CataloguePatch {
  const present = new Set<string>();
  const values: Partial<CatalogueEntry> = {};
  const takeString = (tomlKey: string, field: keyof CatalogueEntry) => {
    if (table[tomlKey] === undefined) return;
    if (typeof table[tomlKey] !== 'string' || !String(table[tomlKey]).trim()) {
      throw new CatalogueConfigError(`« ${id} ».${tomlKey} doit être une chaîne non vide (${source}).`);
    }
    present.add(field);
    (values as Record<string, unknown>)[field] = String(table[tomlKey]).trim();
  };
  const takeBool = (tomlKey: string, field: 'reasoning' | 'vision' | 'tools') => {
    if (table[tomlKey] === undefined) return;
    if (typeof table[tomlKey] !== 'boolean') {
      throw new CatalogueConfigError(`« ${id} ».${tomlKey} doit être true ou false (${source}).`);
    }
    present.add(field);
    values[field] = table[tomlKey];
  };
  const takeNumber = (tomlKey: string, field: 'contextWindow' | 'maxTokens' | 'costInputPerMillion' | 'costOutputPerMillion') => {
    if (table[tomlKey] === undefined) return;
    const allowZero = field.startsWith('cost');
    const parsed = allowZero
      ? nonNegativeNumber(table[tomlKey], `${id}.${tomlKey}`)
      : positiveInteger(table[tomlKey], `${id}.${tomlKey}`, false);
    present.add(field);
    values[field] = parsed;
  };

  takeString('provider', 'provider');
  if ('model_id' in table) {
    const historical = DEFAULT_CONFIG.models[id]?.model_id?.trim();
    const raw = table.model_id;
    if (!(typeof raw === 'string' && historical && raw.trim() === historical)) {
      throw new CatalogueConfigError(
        `« ${id} ».model_id n'est pas pris en charge dans cette version (${source}). Le nom envoyé reste l'identifiant intégré. Retirez model_id.`,
      );
    }
  }
  takeString('description', 'description');
  takeNumber('max_context_tokens', 'contextWindow');
  takeNumber('context_window', 'contextWindow');
  takeNumber('max_tokens', 'maxTokens');
  takeNumber('max_output_tokens', 'maxTokens');
  takeNumber('price_per_m_input', 'costInputPerMillion');
  takeNumber('price_per_m_output', 'costOutputPerMillion');
  takeBool('reasoning', 'reasoning');
  takeBool('vision', 'vision');
  takeBool('tools', 'tools');
  if (table.input !== undefined) {
    if (!Array.isArray(table.input) || table.input.some((item) => item !== 'text' && item !== 'image')) {
      throw new CatalogueConfigError(`« ${id} ».input ne peut contenir que "text" et "image" (${source}).`);
    }
    present.add('input');
    values.input = [...table.input];
    if (!present.has('vision')) {
      present.add('vision');
      values.vision = table.input.includes('image');
    }
  }
  for (const key of Object.keys(table)) {
    if (![
      'provider', 'model_id', 'description', 'max_context_tokens', 'context_window',
      'max_tokens', 'max_output_tokens', 'price_per_m_input', 'price_per_m_output',
      'reasoning', 'vision', 'tools', 'input',
    ].includes(key)) {
      throw new CatalogueConfigError(
        `champ inconnu « ${key} » sur le modèle « ${id} » (${source}). Retirez-le : il n'est pas appliqué.`,
      );
    }
  }
  return { id, present, values };
}

function assertKnownModel(
  model: string,
  document: CatalogueDocument,
  _aliases: ReadonlyMap<string, ModelAliasTarget>,
  source: CatalogueSource,
  requested: string,
): void {
  if (isConcreteModel(model, document)) return;
  const via = requested.trim().toLowerCase() !== model.trim().toLowerCase()
    ? ` (alias « ${requested} »)`
    : '';
  const where = source === 'profile' ? 'profil' : 'configuration';
  throw new CatalogueConfigError(
    `« ${model} »${via} est inconnu du catalogue. Source : ${where}. Déclarez-le dans [models.<nom>], ou corrigez le nom. Aucun autre modèle n'est utilisé à sa place`,
  );
}

function isConcreteModel(model: string, document: CatalogueDocument): boolean {
  const needle = model.trim().toLowerCase();
  if (!needle) return false;
  if (findEntry(builtinCatalogueEntries(), model)) return true;
  const declared = ownValue<CataloguePatch>(document.models, model);
  if (declared || Object.keys(document.models).some((id) => id.toLowerCase() === needle)) {
    return true;
  }
  for (const patch of Object.values(document.models)) {
    if (patch.values.modelId?.toLowerCase() === needle) return true;
  }
  return findModelToolConfig(model) !== null;
}

function explicitUserModel(document: CatalogueDocument): string | null {
  const primary = document.roles.primary?.trim();
  if (primary) return primary;
  const active = document.activeModel?.trim();
  if (!active || active === GENERATED_ACTIVE_MODEL) return null;
  return active;
}

function lookupProfile(
  document: CatalogueDocument | null,
  name: string | null,
): { activeModel: string | null } {
  if (!name) return { activeModel: null };
  const fromDoc = ownValue<{ activeModel?: string }>(document?.profiles, name);
  if (fromDoc) return { activeModel: fromDoc.activeModel ?? null };
  const builtin = ownValue<{ active_model?: string }>(DEFAULT_CONFIG.profiles, name);
  if (builtin) return { activeModel: builtin.active_model?.trim() || null };
  return { activeModel: null };
}

function assertProfileSelectable(document: CatalogueDocument | null, profileName: string | null): void {
  if (!profileName) return;
  if (ownValue(document?.profiles, profileName)) return;
  if (ownValue(DEFAULT_CONFIG.profiles, profileName)) return;
  const builtins = Object.keys(DEFAULT_CONFIG.profiles ?? {}).join(', ') || 'aucun';
  throw new CatalogueConfigError(
    `le profil « ${profileName} » n'existe pas. Profils intégrés : ${builtins}. Les autres se déclarent dans [profiles.${profileName}].`,
  );
}

function findEntry(entries: Record<string, CatalogueEntry>, model: string): CatalogueEntry | null {
  const exact = ownValue<CatalogueEntry>(entries, model);
  if (exact) return exact;
  const needle = model.trim().toLowerCase();
  for (const entry of Object.values(entries)) {
    if (entry.id.toLowerCase() === needle) return entry;
    if (entry.modelId?.toLowerCase() === needle) return entry;
  }
  return null;
}

function findBuiltinByModelId(
  builtin: Readonly<Record<string, CatalogueEntry>>,
  id: string,
): CatalogueEntry | null {
  return findEntry(builtin as Record<string, CatalogueEntry>, id);
}

function profileNameFromArgv(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') break;
    if (arg === '--profile') {
      const next = argv[index + 1];
      return next && !next.startsWith('-') ? next : null;
    }
    if (arg?.startsWith('--profile=')) {
      const name = arg.slice('--profile='.length);
      return name || null;
    }
  }
  return null;
}

function modelFromArgv(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') break;
    if (arg === '--model' || arg === '-m') {
      const next = argv[index + 1];
      return next && !next.startsWith('-') ? next : null;
    }
    if (arg?.startsWith('--model=')) {
      const name = arg.slice('--model='.length);
      return name || null;
    }
  }
  return null;
}

function firstText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string, allowZero: boolean): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new CatalogueConfigError(`${label} doit être un entier ${allowZero ? 'positif ou nul' : 'strictement positif'}`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CatalogueConfigError(`${label} doit être un nombre positif ou nul`);
  }
  return value;
}

export const CATALOGUE_ENTRY_FIELDS = ENTRY_KEYS;

interface ResolvedAlias {
  model: string;
  viaAlias: boolean;
  provider?: string;
  baseUrl?: string;
}

const ALIAS_HOP_LIMIT = 8;

/**
 * Suit la chaîne avant toute lecture du catalogue.
 * Le premier alias qui fixe provider ou base_url gagne : c'est le nom saisi.
 * Une boucle, un fournisseur inutilisable ou une chaîne trop longue lèvent.
 */
function resolveAliasChain(
  requested: string,
  table: ReadonlyMap<string, ModelAliasTarget>,
): ResolvedAlias {
  const seen = new Set<string>();
  const display: string[] = [];
  let cursor = requested.trim();
  let provider: string | undefined;
  let baseUrl: string | undefined;
  let viaAlias = false;
  for (let hop = 0; hop < ALIAS_HOP_LIMIT; hop += 1) {
    const key = cursor.toLowerCase();
    const target = table.get(key);
    if (!target) {
      return {
        model: cursor,
        viaAlias,
        ...(provider ? { provider } : {}),
        ...(baseUrl ? { baseUrl } : {}),
      };
    }
    if (seen.has(key)) {
      display.push(cursor);
      throw new CatalogueConfigError(
        `l'alias « ${requested.trim()} » est circulaire (${display.join(' → ')}). Une cible doit nommer un modèle connu, pas revenir sur un alias.`,
      );
    }
    seen.add(key);
    display.push(cursor);
    viaAlias = true;
    if (target.provider) {
      const problem = aliasProviderProblem(target.provider, cursor);
      if (problem) throw new CatalogueConfigError(problem);
      if (!provider) provider = target.provider;
    }
    if (!baseUrl && target.baseUrl) baseUrl = target.baseUrl;
    const next = target.model.trim();
    if (!next) {
      throw new CatalogueConfigError(`l'alias « ${cursor} » est vide. Donnez-lui un modèle, ou retirez la ligne.`);
    }
    cursor = next;
  }
  throw new CatalogueConfigError(
    `l'alias « ${requested.trim()} » forme une chaîne trop longue (${display.join(' → ')}). Une cible doit nommer un modèle connu.`,
  );
}

function aliasProviderProblem(provider: string, requested: string): string | null {
  const entry = findRuntimeProvider(provider);
  if (!entry || entry.runtimeSupport !== 'direct' || entry.authMode === 'oauth') {
    return `l'alias « ${requested} » indique le fournisseur « ${provider} », qui ne peut pas être choisi par un alias. La session ne change pas de fournisseur en silence.`;
  }
  return null;
}

function ensureAliasTarget(choice: ResolvedChoice, document: CatalogueDocument | null): void {
  if (!choice.viaAlias) return;
  const doc = document ?? emptyDocument();
  assertKnownModel(choice.model, doc, new Map(), choice.source, choice.requested);
  if (choice.provider) {
    const problem = aliasProviderProblem(choice.provider, choice.requested);
    if (problem) throw new CatalogueConfigError(problem);
  }
}

function startupDecision(model: string, source: CatalogueSource, choice: ResolvedChoice): StartupModelDecision {
  return {
    model,
    source,
    ...(choice.viaAlias ? { viaAlias: true } : {}),
    ...(choice.provider ? { provider: choice.provider } : {}),
    ...(choice.baseUrl ? { baseUrl: choice.baseUrl } : {}),
  };
}

/** Même marche que la résolution : cible inconnue, boucle, ou fournisseur inutilisable. */
function aliasTargetsProblem(document: CatalogueDocument): string | null {
  const table = aliasMap(document);
  for (const name of Object.keys(document.aliases)) {
    let resolved: ResolvedAlias;
    try {
      resolved = resolveAliasChain(name, table);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    if (resolved.provider) {
      const problem = aliasProviderProblem(resolved.provider, name);
      if (problem) return problem;
    }
    if (!isConcreteModel(resolved.model, document)) {
      return `l'alias « ${name} » désigne « ${resolved.model} », qui est inconnu du catalogue. Déclarez-le dans [models.<nom>], ou corrigez la cible.`;
    }
  }
  return null;
}

registerCatalogueWriteCheck((text: string): string | null => {
  // model_id déjà présent est conservé par la réécriture. Il n'est pas une clé
  // d'écriture : le contrôle du reste du document ne doit pas bloquer une autre clé.
  const withoutHistoricalModelId = text
    .split('\n')
    .filter((line) => !/^\s*model_id\s*=/.test(line))
    .join('\n');
  try {
    const document = parseCatalogueConfig(withoutHistoricalModelId, 'écriture');
    return aliasTargetsProblem(document);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});
