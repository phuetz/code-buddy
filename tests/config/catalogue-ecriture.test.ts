/**
 * Cinquième passe : /config set relit le fichier utilisateur, applique
 * la clé demandée, et réécrit ce fichier. Une configuration de projet
 * présente ne doit pas y être copiée. Les clés déjà dans le fichier
 * utilisateur restent, y compris celles hors des listes historiques.
 * HOME et CODEBUDDY_HOME restent des répertoires temporaires.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { setConfigValue } from '../../src/config/config-mutator.js';
import { assertUserCatalogue, resolveStartupModel } from '../../src/config/model-catalogue.js';
import { resetModelCatalogueOverlays } from '../../src/config/model-tools.js';
import {
  DEFAULT_CONFIG,
  getConfigManager,
  parseTOML,
  resetConfigManager,
  serializeTOML,
} from '../../src/config/toml-config.js';

const previousHome = process.env.HOME;
const previousCodebuddyHome = process.env.CODEBUDDY_HOME;
const previousConfig = process.env.CODEBUDDY_CONFIG;
const previousCwd = process.cwd();

afterEach(() => {
  resetModelCatalogueOverlays();
  resetConfigManager();
  process.exitCode = undefined;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousCodebuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = previousCodebuddyHome;
  if (previousConfig === undefined) delete process.env.CODEBUDDY_CONFIG;
  else process.env.CODEBUDDY_CONFIG = previousConfig;
  process.chdir(previousCwd);
});

interface RoundTripCase {
  name: string;
  via: 'home' | 'config';
  toml: string;
  argv: readonly string[];
}

const PARTIAL_GROK = [
  'active_model = "grok-4"',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
].join('\n');

const SOL_PARTIAL = [
  'active_model = "grok-4"',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  '',
].join('\n');

const COMPLETE = [
  'active_model = "exemple-fenetre"',
  '',
  '[catalogue]',
  'mode = "merge"',
  '',
  '[model_roles]',
  'primary = "exemple-fenetre"',
  '',
  '[models.exemple-fenetre]',
  'provider = "openai"',
  'price_per_m_input = 0',
  'price_per_m_output = 0',
  'max_context_tokens = 64000',
  'description = "fenetre complete"',
  'reasoning = true',
  'vision = false',
  'tools = true',
  'input = ["text"]',
  '',
  '[models.grok-4]',
  'provider = "xai"',
  'model_id = "grok-4-latest"',
  'price_per_m_input = 1.5',
  'price_per_m_output = 2.5',
  'max_context_tokens = 111111',
  'description = "surcharge complete"',
  'reasoning = true',
  'vision = false',
  'tools = true',
  '',
].join('\n');

const ALIAS = [
  'active_model = "court"',
  '',
  '[model_aliases]',
  'court = "grok-4"',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
].join('\n');

const PROFILE = [
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
  '[profiles.rapide]',
  'active_model = "grok-4"',
  '',
].join('\n');

const CUSTOM_WITHOUT_PRICE = [
  'active_model = "exemple-rapide"',
  '',
  '[models.exemple-rapide]',
  'max_context_tokens = 32000',
  'reasoning = false',
  'vision = false',
  'tools = true',
  '',
].join('\n');

const AGENT_MODELS = [
  'active_model = "grok-4"',
  '',
  '[agent]',
  'architect_model = "architecte"',
  'editor_model = "editeur"',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
].join('\n');

const SURFACE = [
  'active_model = "grok-4"',
  '',
  '[surface]',
  'hidden_capabilities = ["film"]',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
].join('\n');

const LLM = [
  'active_model = "grok-4"',
  '',
  '[llm]',
  'enabled = true',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
].join('\n');

const MODEL_PAIRS = [
  'active_model = "grok-4"',
  '',
  '[model_pairs]',
  'architect = "penseur"',
  'editor = "editeur"',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
].join('\n');

const TOOL_SETTINGS = [
  'active_model = "grok-4"',
  '',
  '[tool_config.bash]',
  'permission = "ask"',
  '',
  '[tool_config.bash.settings]',
  'foo = "bar"',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
].join('\n');

const PROJECT_PRICES_AND_SOUND = [
  '[models.grok-4]',
  'price_per_m_input = 99',
  'price_per_m_output = 100',
  '',
  '[ui]',
  'sound_effects = true',
  '',
].join('\n');

const PROJECT_OTHER_KEYS = [
  'active_model = "grok-3"',
  '',
  '[models.nouveau]',
  'provider = "openai"',
  'max_context_tokens = 777',
  '',
  '[middleware]',
  'max_turns = 42',
  '',
  '[agent]',
  'yolo_mode = true',
  '',
].join('\n');

const PROFILE_ARGV = ['node', 'buddy', '--profile', 'rapide'] as const;
const PLAIN_ARGV = ['node', 'buddy'] as const;

const CASES: RoundTripCase[] = [
  { name: 'entrée partielle grok-4 dans CODEBUDDY_HOME', via: 'home', toml: PARTIAL_GROK, argv: PLAIN_ARGV },
  { name: 'entrée partielle grok-4 dans CODEBUDDY_CONFIG', via: 'config', toml: PARTIAL_GROK, argv: PLAIN_ARGV },
  { name: 'entrée Sol sans raisonnement dans CODEBUDDY_HOME', via: 'home', toml: SOL_PARTIAL, argv: PLAIN_ARGV },
  { name: 'entrée Sol sans raisonnement dans CODEBUDDY_CONFIG', via: 'config', toml: SOL_PARTIAL, argv: PLAIN_ARGV },
  { name: 'entrée complète dans CODEBUDDY_HOME', via: 'home', toml: COMPLETE, argv: PLAIN_ARGV },
  { name: 'entrée complète dans CODEBUDDY_CONFIG', via: 'config', toml: COMPLETE, argv: PLAIN_ARGV },
  { name: 'alias dans CODEBUDDY_HOME', via: 'home', toml: ALIAS, argv: PLAIN_ARGV },
  { name: 'alias dans CODEBUDDY_CONFIG', via: 'config', toml: ALIAS, argv: PLAIN_ARGV },
  { name: 'profil dans CODEBUDDY_HOME', via: 'home', toml: PROFILE, argv: PROFILE_ARGV },
  { name: 'profil dans CODEBUDDY_CONFIG', via: 'config', toml: PROFILE, argv: PROFILE_ARGV },
  { name: 'modèle personnalisé sans prix dans CODEBUDDY_HOME', via: 'home', toml: CUSTOM_WITHOUT_PRICE, argv: PLAIN_ARGV },
  { name: 'modèle personnalisé sans prix dans CODEBUDDY_CONFIG', via: 'config', toml: CUSTOM_WITHOUT_PRICE, argv: PLAIN_ARGV },
  { name: 'fichier généré dans CODEBUDDY_HOME', via: 'home', toml: serializeTOML(DEFAULT_CONFIG), argv: PLAIN_ARGV },
  { name: 'fichier généré dans CODEBUDDY_CONFIG', via: 'config', toml: serializeTOML(DEFAULT_CONFIG), argv: PLAIN_ARGV },
  { name: 'agent.architect_model et editor_model dans CODEBUDDY_HOME', via: 'home', toml: AGENT_MODELS, argv: PLAIN_ARGV },
  { name: 'agent.architect_model et editor_model dans CODEBUDDY_CONFIG', via: 'config', toml: AGENT_MODELS, argv: PLAIN_ARGV },
  { name: 'surface dans CODEBUDDY_HOME', via: 'home', toml: SURFACE, argv: PLAIN_ARGV },
  { name: 'surface dans CODEBUDDY_CONFIG', via: 'config', toml: SURFACE, argv: PLAIN_ARGV },
  { name: 'llm dans CODEBUDDY_HOME', via: 'home', toml: LLM, argv: PLAIN_ARGV },
  { name: 'llm dans CODEBUDDY_CONFIG', via: 'config', toml: LLM, argv: PLAIN_ARGV },
  { name: 'model_pairs dans CODEBUDDY_HOME', via: 'home', toml: MODEL_PAIRS, argv: PLAIN_ARGV },
  { name: 'model_pairs dans CODEBUDDY_CONFIG', via: 'config', toml: MODEL_PAIRS, argv: PLAIN_ARGV },
  { name: 'tool_config.settings dans CODEBUDDY_HOME', via: 'home', toml: TOOL_SETTINGS, argv: PLAIN_ARGV },
  { name: 'tool_config.settings dans CODEBUDDY_CONFIG', via: 'config', toml: TOOL_SETTINGS, argv: PLAIN_ARGV },
];

const PROJECT_MODES: ReadonlyArray<readonly [string, string | undefined]> = [
  ['sans fichier projet', undefined],
  ['projet présent', PROJECT_PRICES_AND_SOUND],
];

function withNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function flattenPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value) || value === null || typeof value !== 'object') {
    return prefix ? [prefix] : [];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return prefix ? [prefix] : [];
  return entries.flatMap(([key, child]) => flattenPaths(child, prefix ? `${prefix}.${key}` : key));
}

function stripTheme(value: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(value);
  const ui = clone.ui;
  if (!isRecord(ui)) return clone;
  delete ui.theme;
  if (Object.keys(ui).length === 0) delete clone.ui;
  return clone;
}

function catalogueView(env: NodeJS.ProcessEnv, argv: readonly string[]) {
  const decision = resolveStartupModel({
    argv,
    env,
    allowUserHome: true,
    detected: { provider: 'openai', defaultModel: 'gpt-4o' },
    isCompatible: () => true,
  });
  const document = assertUserCatalogue(env, true);
  const models: Record<string, { present: string[]; values: Record<string, unknown> }> = {};
  for (const [id, patch] of Object.entries(document?.models ?? {})) {
    const values: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(patch.values)) {
      if (field !== undefined) values[key] = field;
    }
    models[id] = { present: [...patch.present].sort(), values };
  }
  return {
    decision,
    mode: document?.mode ?? null,
    activeModel: document?.activeModel ?? null,
    roles: { ...(document?.roles ?? {}) },
    aliases: { ...(document?.aliases ?? {}) },
    profiles: { ...(document?.profiles ?? {}) },
    models,
  };
}

function prepare(
  via: RoundTripCase['via'],
  toml: string,
  projectToml?: string,
): {
  env: NodeJS.ProcessEnv;
  file: string;
  ordinaryFile: string;
  projectFile: string | null;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'cb-catalogue-ecriture-'));
  const ordinary = path.join(root, 'ordinaire');
  const alternate = path.join(root, 'alternatif');
  const project = path.join(root, 'projet');
  mkdirSync(path.join(ordinary, '.codebuddy'), { recursive: true });
  mkdirSync(path.join(alternate, '.codebuddy'), { recursive: true });
  mkdirSync(project, { recursive: true });
  const ordinaryFile = path.join(ordinary, '.codebuddy', 'config.toml');
  const alternateFile = path.join(alternate, '.codebuddy', 'config.toml');
  const configFile = path.join(project, 'reglage.toml');
  const file = via === 'home' ? alternateFile : configFile;
  writeFileSync(file, withNewline(toml));
  let projectFile: string | null = null;
  if (projectToml !== undefined) {
    projectFile = path.join(project, '.codebuddy', 'config.toml');
    mkdirSync(path.dirname(projectFile), { recursive: true });
    writeFileSync(projectFile, withNewline(projectToml));
  }
  process.env.HOME = ordinary;
  if (via === 'home') {
    process.env.CODEBUDDY_HOME = alternate;
    delete process.env.CODEBUDDY_CONFIG;
  } else {
    process.env.CODEBUDDY_HOME = ordinary;
    process.env.CODEBUDDY_CONFIG = configFile;
  }
  process.chdir(project);
  resetConfigManager();
  const env: NodeJS.ProcessEnv = via === 'home'
    ? { HOME: ordinary, CODEBUDDY_HOME: alternate }
    : { HOME: ordinary, CODEBUDDY_CONFIG: configFile };
  return { env, file, ordinaryFile, projectFile };
}

async function expectRoundTrip(
  via: RoundTripCase['via'],
  toml: string,
  argv: readonly string[],
  projectToml: string | undefined,
): Promise<void> {
  const { env, file, ordinaryFile, projectFile } = prepare(via, toml, projectToml);
  expect(getConfigManager().getConfigPath(), 'la commande vise le fichier de la fixture').toBe(file);
  const before = catalogueView(env, argv);
  const projectBefore = projectFile ? readFileSync(projectFile, 'utf8') : null;
  const result = await setConfigValue('ui.theme', 'papier');
  expect(result.success, result.error ?? 'setConfigValue a échoué').toBe(true);
  expect(result.newValue).toBe('papier');
  const saved = readFileSync(file, 'utf8');
  expect(existsSync(ordinaryFile), 'le fichier ordinaire ne doit pas être créé').toBe(false);
  if (projectFile && projectBefore !== null) {
    expect(readFileSync(projectFile, 'utf8'), 'le fichier projet ne doit pas changer').toBe(projectBefore);
  }
  const badLines = saved.split('\n').filter((line) => {
    const trimmed = line.trim();
    return /=\s*undefined\b/.test(trimmed) || /=\s*null\b/.test(trimmed) || /=\s*"undefined"/.test(trimmed);
  });
  expect(badLines, 'aucune valeur absente ne devient undefined ou null').toEqual([]);
  const beforeDoc = parseTOML(toml);
  const afterDoc = parseTOML(saved);
  const beforePaths = flattenPaths(beforeDoc).sort();
  const afterPaths = flattenPaths(afterDoc).sort();
  const missing = beforePaths.filter((key) => !afterPaths.includes(key));
  const extra = afterPaths.filter((key) => !beforePaths.includes(key) && key !== 'ui.theme');
  expect(missing, `clés perdues: ${missing.join(', ')}`).toEqual([]);
  expect(extra, `clés inventées: ${extra.join(', ')}`).toEqual([]);
  expect(stripTheme(afterDoc), 'les valeurs d\'origine ne changent pas').toEqual(stripTheme(beforeDoc));
  expect(isRecord(afterDoc.ui) ? afterDoc.ui.theme : undefined).toBe('papier');
  expect(saved).toContain('theme = "papier"');
  let after: ReturnType<typeof catalogueView> | { error: string };
  try {
    after = catalogueView(env, argv);
  } catch (error) {
    after = { error: error instanceof Error ? error.message : String(error) };
  }
  expect(after).toEqual(before);
}

describe.each(PROJECT_MODES)('aller-retour sémantique — %s', (label, projectToml) => {
  it.each(CASES)('$name', async (item) => {
    expect(label.length).toBeGreaterThan(0);
    await expectRoundTrip(item.via, item.toml, item.argv, projectToml);
  });
});

describe('promotion d\'autres clés du projet', () => {
  it.each(['home', 'config'] as const)(
    'ne copie pas active_model, un modèle inconnu, middleware ni yolo (%s)',
    async (via) => {
      await expectRoundTrip(via, SOL_PARTIAL, PLAIN_ARGV, PROJECT_OTHER_KEYS);
    },
  );
});
