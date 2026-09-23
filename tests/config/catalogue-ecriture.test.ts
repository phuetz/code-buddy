/**
 * Quatrième passe : /config set sur une clé sans rapport avec les modèles
 * ne change pas ce que le démarrage et le catalogue lisent, et n'ajoute
 * aucune clé absente du fichier.
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

const PROFILE_ARGV = ['node', 'buddy', '--profile', 'rapide'] as const;
const PLAIN_ARGV = ['node', 'buddy'] as const;

const CASES: RoundTripCase[] = [
  { name: 'entrée partielle grok-4 dans CODEBUDDY_HOME', via: 'home', toml: PARTIAL_GROK, argv: PLAIN_ARGV },
  { name: 'entrée partielle grok-4 dans CODEBUDDY_CONFIG', via: 'config', toml: PARTIAL_GROK, argv: PLAIN_ARGV },
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
];

function flattenPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value) || value === null || typeof value !== 'object') {
    return prefix ? [prefix] : [];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return prefix ? [prefix] : [];
  return entries.flatMap(([key, child]) => flattenPaths(child, prefix ? `${prefix}.${key}` : key));
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

function prepare(via: RoundTripCase['via'], toml: string): {
  env: NodeJS.ProcessEnv;
  file: string;
  ordinaryFile: string;
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
  writeFileSync(file, toml.endsWith('\n') ? toml : `${toml}\n`);
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
  return { env, file, ordinaryFile };
}

describe('aller-retour sémantique de /config set', () => {
  it.each(CASES)('$name', async (item) => {
    const { env, file, ordinaryFile } = prepare(item.via, item.toml);
    expect(getConfigManager().getConfigPath(), 'la commande vise le fichier de la fixture').toBe(file);
    const before = catalogueView(env, item.argv);
    const result = await setConfigValue('ui.theme', 'papier');
    expect(result.success, result.error ?? 'setConfigValue a échoué').toBe(true);
    expect(result.newValue).toBe('papier');
    const saved = readFileSync(file, 'utf8');
    expect(existsSync(ordinaryFile), 'le fichier ordinaire ne doit pas être créé').toBe(false);
    const badLines = saved.split('\n').filter((line) => {
      const trimmed = line.trim();
      return /=\s*undefined\b/.test(trimmed) || /=\s*null\b/.test(trimmed) || /=\s*"undefined"/.test(trimmed);
    });
    expect(badLines, 'aucune valeur absente ne devient undefined ou null').toEqual([]);
    const beforePaths = flattenPaths(parseTOML(item.toml)).sort();
    const afterPaths = flattenPaths(parseTOML(saved)).sort();
    const missing = beforePaths.filter((key) => !afterPaths.includes(key));
    const extra = afterPaths.filter((key) => !beforePaths.includes(key) && key !== 'ui.theme');
    expect(missing, `clés perdues: ${missing.join(', ')}`).toEqual([]);
    expect(extra, `clés inventées: ${extra.join(', ')}`).toEqual([]);
    expect(saved).toContain('theme = "papier"');
    let after: ReturnType<typeof catalogueView> | { error: string };
    try {
      after = catalogueView(env, item.argv);
    } catch (error) {
      after = { error: error instanceof Error ? error.message : String(error) };
    }
    expect(after).toEqual(before);
  });
});
