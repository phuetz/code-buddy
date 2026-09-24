/**
 * Segments hérités de Object, et alias dont la cible est inconnue ou circulaire.
 * HOME et CODEBUDDY_HOME pointent vers un répertoire temporaire.
 * Le cas 5 reprend la revue : refus sans exception, prototype global intact.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { registerConfigCommand } from '../../src/commands/cli/config-command.js';
import { runConfigPatch, runConfigSet, runConfigUnset } from '../../src/config/config-cli.js';
import { classifyConfigPath, readOwnPath, validateConfigValue } from '../../src/config/config-schema.js';
import { patchConfigValue, setConfigValue } from '../../src/config/config-mutator.js';
import { selectConfiguredModel } from '../../src/config/model-catalogue.js';
import { resetModelCatalogueOverlays } from '../../src/config/model-tools.js';
import { assessUserConfigText, parseTOML, resetConfigManager } from '../../src/config/toml-config.js';

const previousHome = process.env.HOME;
const previousCodebuddyHome = process.env.CODEBUDDY_HOME;
const previousConfig = process.env.CODEBUDDY_CONFIG;
const previousCwd = process.cwd();
const previousExit = process.exitCode;

const OBJECT_PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype).sort();
const FUNCTION_PROTOTYPE_NAMES = Object.getOwnPropertyNames(Function.prototype).sort();

const USER = [
  'active_model = "grok-4"',
  '',
  '[models.grok-4]',
  'max_context_tokens = 1000',
  'reasoning = false',
  '',
  '[ui]',
  'streaming = true',
  '',
].join('\n');

const CIRCULAR = [
  'active_model = "a"',
  '',
  '[model_aliases]',
  'a = "b"',
  'b = "a"',
  '',
].join('\n');

const UNKNOWN_ALIAS = [
  'active_model = "grok-4"',
  '',
  '[model_aliases]',
  'monalias = "cible-inconnue"',
  '',
].join('\n');

const KNOWN_ALIAS = [
  'active_model = "grok-4"',
  '',
  '[model_aliases]',
  'court = "grok-4"',
  '',
].join('\n');

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>).polluted;
  delete (Object.prototype as Record<string, unknown>).x;
  delete (Object.prototype as Record<string, unknown>).reasoning;
  resetModelCatalogueOverlays();
  resetConfigManager();
  process.exitCode = previousExit;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousCodebuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = previousCodebuddyHome;
  if (previousConfig === undefined) delete process.env.CODEBUDDY_CONFIG;
  else process.env.CODEBUDDY_CONFIG = previousConfig;
  process.chdir(previousCwd);
});

function expectGlobalsIntact(): void {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(OBJECT_PROTOTYPE_NAMES);
  expect(Object.getOwnPropertyNames(Function.prototype).sort()).toEqual(FUNCTION_PROTOTYPE_NAMES);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(({} as Record<string, unknown>).x).toBeUndefined();
}

function prepare(toml: string): { file: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'cb-segments-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'projet');
  mkdirSync(path.join(home, '.codebuddy'), { recursive: true });
  mkdirSync(project, { recursive: true });
  const file = path.join(home, '.codebuddy', 'config.toml');
  writeFileSync(file, toml.endsWith('\n') ? toml : `${toml}\n`);
  process.env.HOME = home;
  process.env.CODEBUDDY_HOME = home;
  delete process.env.CODEBUDDY_CONFIG;
  process.chdir(project);
  resetConfigManager();
  return { file };
}

describe('cas limite 5 — segments hérités de Object', () => {
  it('set ui.__proto__ avec une valeur objet ne lève pas et est refusé', async () => {
    const { file } = prepare(USER);
    const before = readFileSync(file, 'utf8');
    let thrown: string | null = null;
    let ok: boolean | null = null;
    try {
      const report = await runConfigSet({ key: 'ui.__proto__', value: '{"x":1}' });
      ok = report.ok;
      expect(report.errors.join('\n')).toMatch(/n'est pas une clé/);
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    expect(thrown, `exception inattendue: ${thrown}`).toBeNull();
    expect(ok).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expectGlobalsIntact();
  });

  it('patch ui avec __proto__ dans le JSON ne lève pas et est refusé', async () => {
    const { file } = prepare(USER);
    const before = readFileSync(file, 'utf8');
    let thrown: string | null = null;
    let ok: boolean | null = null;
    try {
      const report = await runConfigPatch({ key: 'ui', value: '{"__proto__":{"polluted":true}}' });
      ok = report.ok;
      expect(report.errors.join('\n')).toMatch(/n'est pas une clé/);
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    expect(thrown, `exception inattendue: ${thrown}`).toBeNull();
    expect(ok).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expectGlobalsIntact();
  });

  it('unset __proto__.polluted ne lève pas et est refusé', async () => {
    const { file } = prepare(USER);
    const before = readFileSync(file, 'utf8');
    let thrown: string | null = null;
    let ok: boolean | null = null;
    try {
      const report = await runConfigUnset({ key: '__proto__.polluted' });
      ok = report.ok;
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    expect(thrown, `exception inattendue: ${thrown}`).toBeNull();
    expect(ok).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expectGlobalsIntact();
  });

  it('la commande Commander patch ne rejette pas sur __proto__', async () => {
    const { file } = prepare(USER);
    const before = readFileSync(file, 'utf8');
    const program = new Command();
    program.exitOverride();
    registerConfigCommand(program);
    const write = process.stdout.write.bind(process.stdout);
    let captured = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }) as typeof process.stdout.write;
    let thrown: string | null = null;
    try {
      await program.parseAsync(['node', 'buddy', 'config', 'patch', 'ui', '{"__proto__":{"polluted":true}}', '--json']);
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    } finally {
      process.stdout.write = write;
    }
    expect(thrown, `exception inattendue: ${thrown}`).toBeNull();
    expect(process.exitCode).toBe(1);
    const report = JSON.parse(captured) as { ok: boolean };
    expect(report.ok).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expectGlobalsIntact();
  });
});

describe('résolution de segment', () => {
  it.each([
    'ui.__proto__',
    'ui.constructor',
    'ui.prototype',
    'ui.toString',
    'model_aliases.__proto__',
    'model_aliases.constructor',
    'model_aliases.prototype',
    '__proto__.polluted',
    'constructor.prototype',
  ])('« %s » n\'est pas une clé connue', (key) => {
    let thrown: string | null = null;
    let ok: boolean | null = null;
    let message = '';
    try {
      const verdict = classifyConfigPath(key);
      ok = verdict.ok;
      message = verdict.message;
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    expect(thrown, `exception inattendue: ${thrown}`).toBeNull();
    expect(ok, key).toBe(false);
    expect(message, key).toMatch(/n'est pas une clé|inconnue/);
    expectGlobalsIntact();
  });

  it('prototype, constructor et __proto__ sont nommés dans le refus', () => {
    for (const key of ['ui.prototype', 'ui.constructor', 'ui.__proto__', 'model_aliases.__proto__']) {
      const verdict = classifyConfigPath(key);
      expect(verdict.ok, key).toBe(false);
      expect(verdict.message, key).toMatch(/n'est pas une clé/);
    }
  });

  it('validateConfigValue sur ui.__proto__ ne lève pas', () => {
    let thrown: string | null = null;
    let message: string | null = null;
    try {
      message = validateConfigValue('ui.__proto__', { x: 1 });
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    expect(thrown, `exception inattendue: ${thrown}`).toBeNull();
    expect(message).toBeTruthy();
    expectGlobalsIntact();
  });

  it('un schéma sans _def ne fait pas lever classifyConfigPath', () => {
    let thrown: string | null = null;
    let ok: boolean | null = null;
    try {
      const verdict = classifyConfigPath('ui.theme', {} as never);
      ok = verdict.ok;
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    expect(thrown, `exception inattendue: ${thrown}`).toBeNull();
    expect(ok).toBe(false);
  });
});

describe('lecture d\'un chemin', () => {
  it('lit une clé propre', () => {
    const read = readOwnPath({ ui: { streaming: true } }, 'ui.streaming');
    expect(read.ok).toBe(true);
    expect(read.value).toBe(true);
  });

  it.each([
    'ui.__proto__',
    'ui.constructor',
    'ui.prototype',
    'ui.toString',
    'constructor',
  ])('refuse la lecture de « %s » sans rendre une fonction héritée', (key) => {
    const read = readOwnPath({ ui: { streaming: true } }, key);
    expect(read.ok).toBe(false);
    expect(read.value).toBeUndefined();
    expectGlobalsIntact();
  });
});

describe('alias à l\'écriture', () => {
  it('refuse un alias circulaire', () => {
    const problem = assessUserConfigText(CIRCULAR);
    expect(problem).toMatch(/circulaire/);
  });

  it('refuse un alias dont la cible est inconnue', () => {
    const problem = assessUserConfigText(UNKNOWN_ALIAS);
    expect(problem).toMatch(/inconnu/);
  });

  it('accepte un alias vers un modèle connu', () => {
    expect(assessUserConfigText(KNOWN_ALIAS)).toBeNull();
  });

  it('set d\'un alias inconnu n\'écrit pas', async () => {
    const { file } = prepare(USER);
    const before = readFileSync(file, 'utf8');
    const result = await setConfigValue('model_aliases.monalias', 'cible-inconnue');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inconnu/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expectGlobalsIntact();
  });

  it('patch d\'une boucle d\'alias n\'écrit pas', async () => {
    const { file } = prepare(USER);
    const before = readFileSync(file, 'utf8');
    const result = await patchConfigValue('model_aliases', { a: 'b', b: 'a' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/circulaire/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expectGlobalsIntact();
  });

  it('set d\'un alias vers grok-4 écrit la cible', async () => {
    const { file } = prepare(USER);
    const result = await setConfigValue('model_aliases.court', 'grok-4');
    expect(result.success).toBe(true);
    const parsed = parseTOML(readFileSync(file, 'utf8'));
    const aliases = parsed.model_aliases as Record<string, unknown>;
    expect(aliases.court).toBe('grok-4');
    expectGlobalsIntact();
  });

  it('la résolution refuse toujours la boucle, sans boucle infinie', () => {
    expect(() => selectConfiguredModel({
      configText: CIRCULAR,
      readDefaultPath: false,
    })).toThrow();
  });

  it('un fichier déjà posé reste lisible après un refus', () => {
    const { file } = prepare(USER);
    expect(existsSync(file)).toBe(true);
    expect(assessUserConfigText(readFileSync(file, 'utf8'))).toBeNull();
  });
});
