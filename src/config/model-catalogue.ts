/**
 * Catalogue de modèles surchargeable.
 *
 * S'appuie sur le TOML existant (`config.toml`, profils, `--profile`).
 * Le catalogue intégré reste la base. Une surcharge n'écrit que les champs
 * présents : le reste est conservé. Rien ici ne lit ni n'écrit le profil
 * réel si l'appelant fournit le texte ou un chemin explicite.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { findModelToolConfig, installModelCatalogueOverlays } from './model-tools.js';
import { getModelRegistry } from './model-registry.js';
import { DEFAULT_CONFIG, parseTOML } from './toml-config.js';
import { writeJsonAtomicSync } from '../utils/atomic-write.js';

export class CatalogueConfigError extends Error {
  constructor(detail: string) {
    super(`Configuration de modèle invalide : ${detail}`);
    this.name = 'CatalogueConfigError';
  }
}

export type CatalogueMode = 'merge' | 'replace';
export type CatalogueSource = 'cli' | 'env' | 'profile' | 'user' | 'discovered' | 'builtin';
export type DiscoveryKind = 'ollama' | 'openai';

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
  fast?: string;
  compact?: string;
  vision?: string;
}

export interface CatalogueDocument {
  mode: CatalogueMode;
  ttlSeconds: number;
  activeModel?: string;
  roles: CatalogueRoles;
  aliases: Record<string, string>;
  models: Record<string, CataloguePatch>;
  profiles: Record<string, { activeModel?: string; fast?: string; vision?: string }>;
}

export interface PriorityInput {
  cli?: string | null;
  env?: string | null;
  profile?: string | null;
  user?: string | null;
  discovered?: string | null;
  builtin?: string | null;
}

export interface ResolvedChoice {
  model: string;
  source: CatalogueSource;
  /** Jeton d'origine si un alias a été résolu. Identique à `model` sinon. */
  requested: string;
}

export interface ContextCacheEntry {
  contextWindow: number;
  fetchedAt: number;
  source: DiscoveryKind;
}

export interface ContextCacheFile {
  version: 1;
  entries: Record<string, ContextCacheEntry>;
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

const DEFAULT_TTL_SECONDS = 3600;

export function emptyContextCache(): ContextCacheFile {
  return { version: 1, entries: {} };
}

export function contextCacheKey(source: DiscoveryKind, baseURL: string, model: string): string {
  return `${source}|${stripTrailingSlash(baseURL)}|${model.trim().toLowerCase()}`;
}

/** Fusion champ à champ. `replace` ignore la base. Les champs absents du patch restent. */
export function mergeCatalogueEntry(
  base: CatalogueEntry | null,
  patch: CataloguePatch,
  mode: CatalogueMode,
): CatalogueEntry {
  if (mode === 'replace') {
    return { id: patch.id, ...patch.values };
  }
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
  if (document.mode === 'replace') {
    const replaced: Record<string, CatalogueEntry> = {};
    for (const [id, patch] of Object.entries(document.models)) {
      replaced[id] = mergeCatalogueEntry(null, patch, 'replace');
    }
    return replaced;
  }
  const merged: Record<string, CatalogueEntry> = { ...builtin };
  for (const [id, patch] of Object.entries(document.models)) {
    const base = builtin[id] ?? findBuiltinByModelId(builtin, id);
    merged[id] = mergeCatalogueEntry(base, patch, 'merge');
  }
  return merged;
}

/**
 * Premier jeton non vide. Le résultat est ce jeton (ou sa cible d'alias),
 * jamais un autre modèle « de secours ».
 */
export function resolveModelByPriority(
  input: PriorityInput,
  aliases: ReadonlyMap<string, string> = new Map(),
): ResolvedChoice {
  const ordered: Array<[CatalogueSource, string | null | undefined]> = [
    ['cli', input.cli],
    ['env', input.env],
    ['profile', input.profile],
    ['user', input.user],
    ['discovered', input.discovered],
    ['builtin', input.builtin],
  ];
  for (const [source, raw] of ordered) {
    const requested = raw?.trim();
    if (!requested) continue;
    const alias = aliases.get(requested.toLowerCase());
    if (alias !== undefined && !alias.trim()) {
      throw new CatalogueConfigError(`l'alias « ${requested} » est vide`);
    }
    const model = alias?.trim() || requested;
    return { model, source, requested };
  }
  throw new CatalogueConfigError('aucun modèle n\'est défini (CLI, environnement, profil, configuration, découverte ou catalogue intégré)');
}

export function parseCatalogueConfig(content: string): CatalogueDocument {
  const meaningful = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (meaningful.length === 0) {
    return emptyDocument();
  }
  const recognized = meaningful.filter((line) => /^\[[^\]]+\]$/.test(line) || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line));
  if (recognized.length === 0) {
    throw new CatalogueConfigError('le fichier ne contient aucune clé TOML reconnaissable');
  }
  const parsed = parseTOML(content);
  return documentFromParsed(parsed);
}

export function selectionFromDocument(
  document: CatalogueDocument,
  options: {
    cli?: string | null;
    env?: string | null;
    profileName?: string | null;
    discovered?: string | null;
    builtin?: string | null;
    aliases?: ReadonlyMap<string, string>;
  } = {},
): ResolvedChoice {
  const profile = options.profileName ? document.profiles[options.profileName] : undefined;
  if (options.profileName && !profile) {
    throw new CatalogueConfigError(
      `le profil « ${options.profileName} » n'existe pas dans la configuration`,
    );
  }
  const aliases = options.aliases ?? aliasMap(document);
  const choice = resolveModelByPriority(
    {
      cli: options.cli,
      env: options.env,
      profile: profile?.activeModel ?? null,
      user: document.roles.primary ?? document.activeModel ?? null,
      discovered: options.discovered,
      builtin: options.builtin,
    },
    aliases,
  );
  if (choice.source === 'profile' || choice.source === 'user') {
    assertKnownModel(choice.model, document, aliases);
  }
  return choice;
}

export function resolveRole(
  document: CatalogueDocument,
  role: 'primary' | 'fast' | 'vision',
  profileName?: string | null,
): string | null {
  const profile = profileName ? document.profiles[profileName] : undefined;
  if (role === 'primary') {
    return profile?.activeModel ?? document.roles.primary ?? document.activeModel ?? null;
  }
  if (role === 'fast') {
    return profile?.fast ?? document.roles.fast ?? document.roles.compact ?? null;
  }
  return profile?.vision ?? document.roles.vision ?? null;
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

export function aliasMap(document: CatalogueDocument, extra?: ReadonlyMap<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  const base = extra ?? getModelRegistry().getAliases();
  for (const [alias, target] of base) map.set(alias.toLowerCase(), target);
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
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new CatalogueConfigError(`fichier introuvable : ${explicit}`);
    }
    return explicit;
  }
  const home = env.CODEBUDDY_HOME?.trim() || homedir();
  const candidate = join(home, '.codebuddy', 'config.toml');
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
  const path = allowUserHome ? defaultCatalogueConfigPath(env) : explicitConfigPath(env);
  const own = path ? readFileSync(path, 'utf8') : '';
  if (!allowUserHome) {
    if (!path) return null;
    return parseCatalogueConfig(own);
  }
  const project = join(process.cwd(), '.codebuddy', 'config.toml');
  const projectText = existsSync(project) && project !== path ? readFileSync(project, 'utf8') : '';
  const text = `${own}\n${projectText}`.trim();
  if (!text) return null;
  return parseCatalogueConfig(text);
}

/**
 * Modèle explicitement choisi dans le TOML (profil puis configuration utilisateur).
 * `null` si ce niveau ne fixe rien — l'appelant garde alors la variable d'environnement
 * ou le réglage déjà en place. Une configuration illisible lève toujours.
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
  const text = readCatalogueText(options, env);
  if (text === null) return null;
  const document = parseCatalogueConfig(text);
  const profileName = profileNameFromArgv(options.argv ?? []);
  const profile = profileName ? document.profiles[profileName] : undefined;
  if (profileName && !profile) {
    throw new CatalogueConfigError(`le profil « ${profileName} » n'existe pas dans la configuration`);
  }
  const profileModel = profile?.activeModel ?? null;
  const userModel = document.roles.primary ?? document.activeModel ?? null;
  if (!profileModel && !userModel) return null;
  const aliases = aliasMap(document);
  const choice = resolveModelByPriority(
    { profile: profileModel, user: userModel },
    aliases,
  );
  assertKnownModel(choice.model, document, aliases);
  const merged = mergeCatalogue(builtinCatalogueEntries(), document);
  const entry = findEntry(merged, choice.model) ?? findEntry(merged, choice.requested);
  return entry ? canonicalModelId(entry) : choice.model;
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

/** Applique les surcharges de capacités au résolveur synchrone. `null` les retire. */
export function activateCatalogue(document: CatalogueDocument | null): void {
  installModelCatalogueOverlays(document ? capabilityOverlays(document) : null);
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
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new CatalogueConfigError(`fichier introuvable : ${explicit}`);
    }
    return explicit;
  }
  const home = env.CODEBUDDY_HOME?.trim();
  if (!home) return null;
  const candidate = join(home, '.codebuddy', 'config.toml');
  return existsSync(candidate) ? candidate : null;
}

function readCatalogueText(
  options: {
    configText?: string;
    configPath?: string | null;
    readDefaultPath?: boolean;
    allowUserHome?: boolean;
  },
  env: NodeJS.ProcessEnv,
): string | null {
  if (options.configText !== undefined) return options.configText;
  if (options.configPath) {
    if (!existsSync(options.configPath)) {
      throw new CatalogueConfigError(`fichier introuvable : ${options.configPath}`);
    }
    return readFileSync(options.configPath, 'utf8');
  }
  if (options.readDefaultPath === false && !options.allowUserHome) return null;
  const path = options.allowUserHome ? defaultCatalogueConfigPath(env) : explicitConfigPath(env);
  const own = path ? readFileSync(path, 'utf8') : null;
  if (!options.allowUserHome) return own;
  const project = join(process.cwd(), '.codebuddy', 'config.toml');
  if (!existsSync(project) || project === path) return own;
  const projectText = readFileSync(project, 'utf8');
  return own ? `${own}\n${projectText}` : projectText;
}

export function readContextCache(text: string): ContextCacheFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CatalogueConfigError('le cache de contexte n\'est pas un JSON valide');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CatalogueConfigError('le cache de contexte n\'est pas un objet JSON');
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new CatalogueConfigError('le cache de contexte n\'a pas d\'entrées');
  }
  return { version: 1, entries: entries as ContextCacheFile['entries'] };
}

export function freshContextWindow(
  cache: ContextCacheFile,
  key: string,
  now: number,
  ttlMs: number,
): number | null {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new CatalogueConfigError('la durée de vie du cache de contexte est invalide');
  }
  const entry = cache.entries[key];
  if (!entry) return null;
  if (!Number.isSafeInteger(entry.fetchedAt) || !Number.isSafeInteger(entry.contextWindow) || entry.contextWindow <= 0) {
    throw new CatalogueConfigError('le cache de contexte contient une entrée illisible');
  }
  if (now - entry.fetchedAt >= ttlMs) return null;
  return entry.contextWindow;
}

export async function discoverContextWindow(options: {
  source: DiscoveryKind;
  baseURL: string;
  model: string;
  cache: ContextCacheFile;
  now: number;
  ttlMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ contextWindow: number; fromCache: boolean; cache: ContextCacheFile }> {
  const key = contextCacheKey(options.source, options.baseURL, options.model);
  const fresh = freshContextWindow(options.cache, key, options.now, options.ttlMs);
  if (fresh !== null) {
    return { contextWindow: fresh, fromCache: true, cache: options.cache };
  }
  const contextWindow = await probeProvider(options.source, options.baseURL, options.model, options.fetchImpl);
  const next: ContextCacheFile = {
    version: 1,
    entries: {
      ...options.cache.entries,
      [key]: { contextWindow, fetchedAt: options.now, source: options.source },
    },
  };
  return { contextWindow, fromCache: false, cache: next };
}

export function writeContextCache(filePath: string, cache: ContextCacheFile): void {
  writeJsonAtomicSync(filePath, cache, { mode: 0o600 });
}

export function defaultContextCachePath(configPath: string): string {
  return join(dirname(configPath), 'context-length-cache.json');
}

function emptyDocument(): CatalogueDocument {
  return {
    mode: 'merge',
    ttlSeconds: DEFAULT_TTL_SECONDS,
    roles: {},
    aliases: {},
    models: {},
    profiles: {},
  };
}

function documentFromParsed(parsed: Record<string, unknown>): CatalogueDocument {
  const document = emptyDocument();
  const catalogue = asRecord(parsed.catalogue);
  if (parsed.catalogue !== undefined && !catalogue) {
    throw new CatalogueConfigError('la section [catalogue] doit être une table');
  }
  if (catalogue) {
    if (catalogue.mode !== undefined) {
      const mode = String(catalogue.mode).trim().toLowerCase();
      if (mode !== 'merge' && mode !== 'replace') {
        throw new CatalogueConfigError(`mode « ${String(catalogue.mode)} » inconnu (attendu : merge ou replace)`);
      }
      document.mode = mode;
    }
    if (catalogue.context_cache_ttl_seconds !== undefined) {
      document.ttlSeconds = positiveInteger(
        catalogue.context_cache_ttl_seconds,
        'context_cache_ttl_seconds',
        true,
      );
    }
  }
  if (typeof parsed.active_model === 'string' && parsed.active_model.trim()) {
    document.activeModel = parsed.active_model.trim();
  } else if (parsed.active_model !== undefined && parsed.active_model !== '') {
    throw new CatalogueConfigError('active_model doit être une chaîne non vide');
  }
  document.roles = parseRoles(parsed.model_roles);
  document.aliases = parseAliases(parsed.model_aliases);
  document.models = parseModels(parsed.models);
  document.profiles = parseProfiles(parsed.profiles);
  if (document.roles.primary) document.activeModel = document.roles.primary;
  return document;
}

function parseRoles(value: unknown): CatalogueRoles {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new CatalogueConfigError('la section [model_roles] doit être une table');
  const roles: CatalogueRoles = {};
  for (const key of ['primary', 'fast', 'compact', 'vision'] as const) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== 'string' || !String(record[key]).trim()) {
      throw new CatalogueConfigError(`le rôle ${key} doit être un nom de modèle non vide`);
    }
    roles[key] = String(record[key]).trim();
  }
  return roles;
}

function parseAliases(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new CatalogueConfigError('la section [model_aliases] doit être une table');
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(record)) {
    if (typeof target !== 'string' || !target.trim()) {
      throw new CatalogueConfigError(`l'alias « ${alias} » doit désigner un modèle non vide`);
    }
    aliases[alias] = target.trim();
  }
  return aliases;
}

function parseModels(value: unknown): Record<string, CataloguePatch> {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new CatalogueConfigError('la section [models] doit être une table');
  const models: Record<string, CataloguePatch> = {};
  for (const [id, raw] of Object.entries(record)) {
    const table = asRecord(raw);
    if (!table) throw new CatalogueConfigError(`le modèle « ${id} » doit être une table`);
    models[id] = patchFromTable(id, table);
  }
  return models;
}

function parseProfiles(value: unknown): CatalogueDocument['profiles'] {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) throw new CatalogueConfigError('la section [profiles] doit être une table');
  const profiles: CatalogueDocument['profiles'] = {};
  for (const [name, raw] of Object.entries(record)) {
    const table = asRecord(raw);
    if (!table) continue;
    const profile: { activeModel?: string; fast?: string; vision?: string } = {};
    if (table.active_model !== undefined) {
      if (typeof table.active_model !== 'string' || !table.active_model.trim()) {
        throw new CatalogueConfigError(`le profil « ${name} » a un active_model vide`);
      }
      profile.activeModel = table.active_model.trim();
    }
    if (table.fast_model !== undefined) {
      if (typeof table.fast_model !== 'string' || !table.fast_model.trim()) {
        throw new CatalogueConfigError(`le profil « ${name} » a un fast_model vide`);
      }
      profile.fast = table.fast_model.trim();
    }
    if (table.vision_model !== undefined) {
      if (typeof table.vision_model !== 'string' || !table.vision_model.trim()) {
        throw new CatalogueConfigError(`le profil « ${name} » a un vision_model vide`);
      }
      profile.vision = table.vision_model.trim();
    }
    profiles[name] = profile;
  }
  return profiles;
}

function patchFromTable(id: string, table: Record<string, unknown>): CataloguePatch {
  const present = new Set<string>();
  const values: Partial<CatalogueEntry> = {};
  const takeString = (tomlKey: string, field: keyof CatalogueEntry) => {
    if (table[tomlKey] === undefined) return;
    if (typeof table[tomlKey] !== 'string' || !String(table[tomlKey]).trim()) {
      throw new CatalogueConfigError(`« ${id} ».${tomlKey} doit être une chaîne non vide`);
    }
    present.add(field);
    (values as Record<string, unknown>)[field] = String(table[tomlKey]).trim();
  };
  const takeBool = (tomlKey: string, field: 'reasoning' | 'vision' | 'tools') => {
    if (table[tomlKey] === undefined) return;
    if (typeof table[tomlKey] !== 'boolean') {
      throw new CatalogueConfigError(`« ${id} ».${tomlKey} doit être true ou false`);
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
  takeString('model_id', 'modelId');
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
      throw new CatalogueConfigError(`« ${id} ».input ne peut contenir que "text" et "image"`);
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
      throw new CatalogueConfigError(`champ inconnu « ${key} » sur le modèle « ${id} »`);
    }
  }
  return { id, present, values };
}

function assertKnownModel(
  model: string,
  document: CatalogueDocument,
  aliases: ReadonlyMap<string, string>,
): void {
  if (isKnownModel(model, document, aliases)) return;
  throw new CatalogueConfigError(
    `« ${model} » est inconnu du catalogue. Aucun autre modèle n'est utilisé à sa place`,
  );
}

function isKnownModel(
  model: string,
  document: CatalogueDocument,
  aliases: ReadonlyMap<string, string>,
): boolean {
  const needle = model.trim().toLowerCase();
  if (!needle) return false;
  if (aliases.has(needle)) return true;
  for (const target of aliases.values()) {
    if (target.toLowerCase() === needle) return true;
  }
  const builtin = builtinCatalogueEntries();
  if (findEntry(builtin, model)) return true;
  if (document.models[model] || Object.keys(document.models).some((id) => id.toLowerCase() === needle)) {
    return true;
  }
  for (const patch of Object.values(document.models)) {
    if (patch.values.modelId?.toLowerCase() === needle) return true;
  }
  return findModelToolConfig(model) !== null;
}

function findEntry(entries: Record<string, CatalogueEntry>, model: string): CatalogueEntry | null {
  if (entries[model]) return entries[model];
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
  for (let index = 0; index < argv.length; index++) {
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

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function probeProvider(
  source: DiscoveryKind,
  baseURL: string,
  model: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const root = stripTrailingSlash(baseURL).replace(/\/v1$/i, '');
  try {
    if (source === 'ollama') {
      const response = await fetchImpl(`${root}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });
      if (!response.ok) {
        throw new Error(`Découverte de contexte impossible : ${source} a répondu ${response.status}`);
      }
      const body = await response.json() as unknown;
      const window = ollamaContext(body);
      if (window === null) {
        throw new Error(`Découverte de contexte impossible : ${source} ne publie pas de fenêtre pour « ${model} »`);
      }
      return window;
    }
    const response = await fetchImpl(`${root}/v1/models`);
    if (!response.ok) {
      throw new Error(`Découverte de contexte impossible : ${source} a répondu ${response.status}`);
    }
    const body = await response.json() as unknown;
    const window = openaiContext(body, model);
    if (window === null) {
      throw new Error(`Découverte de contexte impossible : ${source} ne publie pas de fenêtre pour « ${model} »`);
    }
    return window;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Découverte de contexte impossible')) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Découverte de contexte impossible auprès du fournisseur (${detail})`);
  }
}

function ollamaContext(body: unknown): number | null {
  const info = asRecord(asRecord(body)?.model_info);
  if (!info) return null;
  const values = Object.entries(info)
    .filter(([key]) => key.endsWith('.context_length'))
    .map(([, value]) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return Math.min(...values);
}

function openaiContext(body: unknown, model: string): number | null {
  const data = asRecord(body)?.data;
  if (!Array.isArray(data)) return null;
  const needle = model.trim().toLowerCase();
  const record = data
    .map((entry) => asRecord(entry))
    .find((entry) => entry && String(entry.id ?? '').trim().toLowerCase() === needle);
  if (!record) return null;
  const candidate = record.context_length ?? record.max_model_len;
  if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate <= 0) return null;
  return candidate;
}

export const CATALOGUE_ENTRY_FIELDS = ENTRY_KEYS;
