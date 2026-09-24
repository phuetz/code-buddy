/**
 * Outillage de configuration hors session : set, patch, unset, schéma,
 * sauvegardes et exemple. Chaque écriture est relue avec les vrais lecteurs.
 * HOME reste un répertoire temporaire.
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { registerConfigCommand } from '../../src/commands/cli/config-command.js';
import {
  formatConfigReport,
  runConfigPatch,
  runConfigSet,
  runConfigUnset,
  runConfigValidate,
} from '../../src/config/config-cli.js';
import { configBackupPath, configLastGoodPath } from '../../src/config/config-backup.js';
import {
  exportConfigSchema,
  listWritableConfigPaths,
  renderTomlExample,
} from '../../src/config/config-schema.js';
import { setConfigValue } from '../../src/config/config-mutator.js';
import { assertUserCatalogue, resolveStartupModel } from '../../src/config/model-catalogue.js';
import { resetModelCatalogueOverlays } from '../../src/config/model-tools.js';
import {
  assessUserConfigText,
  getConfigManager,
  parseTOML,
  resetConfigManager,
  serializeTOML,
  DEFAULT_CONFIG,
} from '../../src/config/toml-config.js';
import { checkUserConfigRecovery } from '../../src/doctor/config-recovery.js';

const previousHome = process.env.HOME;
const previousCodebuddyHome = process.env.CODEBUDDY_HOME;
const previousConfig = process.env.CODEBUDDY_CONFIG;
const previousCwd = process.cwd();
const previousExit = process.exitCode;

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

const PROJECT = [
  '[models.grok-4]',
  'price_per_m_input = 99',
  'price_per_m_output = 100',
  '',
  '[ui]',
  'sound_effects = true',
  '',
].join('\n');

afterEach(() => {
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

function withNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function prepare(via: 'home' | 'config', toml: string, projectToml?: string): {
  env: NodeJS.ProcessEnv;
  file: string;
  projectFile: string | null;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'cb-config-outillage-'));
  const ordinary = path.join(root, 'ordinaire');
  const alternate = path.join(root, 'alternatif');
  const project = path.join(root, 'projet');
  mkdirSync(path.join(ordinary, '.codebuddy'), { recursive: true });
  mkdirSync(path.join(alternate, '.codebuddy'), { recursive: true });
  mkdirSync(project, { recursive: true });
  const configFile = path.join(project, 'reglage.toml');
  const file = via === 'home' ? path.join(alternate, '.codebuddy', 'config.toml') : configFile;
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
  return { env, file, projectFile };
}

function rejectedFiles(file: string): string[] {
  const directory = path.dirname(file);
  if (!existsSync(directory)) return [];
  const prefix = `${path.basename(file)}.rejected.`;
  return readdirSync(directory).filter((name) => name.startsWith(prefix));
}

function reread(env: NodeJS.ProcessEnv, file: string): {
  parsed: Record<string, unknown>;
  catalogueActive: string | null;
  startup: string | null;
} {
  const text = readFileSync(file, 'utf8');
  const parsed = parseTOML(text);
  const catalogue = assertUserCatalogue(env, true);
  const startup = resolveStartupModel({
    env,
    allowUserHome: true,
    argv: [],
    detected: { provider: 'openai', defaultModel: 'gpt-4o' },
    isCompatible: () => true,
  });
  return {
    parsed,
    catalogueActive: catalogue?.activeModel ?? null,
    startup: startup.model,
  };
}

describe('buddy config set, patch et unset', () => {
  it('le rapport --dry-run --json a ok, operations, checks et errors, sans écrire', async () => {
    const { file } = prepare('home', USER);
    const before = readFileSync(file, 'utf8');
    const report = await runConfigSet({ key: 'ui.theme', value: 'papier', dryRun: true });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.operations).toEqual([
      expect.objectContaining({ op: 'set', key: 'ui.theme', newValue: 'papier', dryRun: true }),
    ]);
    expect(report.checks.map((check) => check.name)).toEqual(['known-key', 'type', 'document', 'backup']);
    expect(report.checks.find((check) => check.name === 'backup')?.detail).toBe('non exécuté');
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(existsSync(configBackupPath(file, 0))).toBe(false);
    expect(rejectedFiles(file)).toEqual([]);
  });

  it('une clé inconnue est refusée, le fichier actif ne change pas, une charge rejected est déposée', async () => {
    const { file } = prepare('home', USER);
    const before = readFileSync(file, 'utf8');
    const report = await runConfigSet({ key: 'ui.cle_inconnue', value: 'oui' });
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/inconnue/);
    expect(report.checks.find((check) => check.name === 'known-key')?.ok).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(rejectedFiles(file).length).toBe(1);
  });

  it('model_id est refusé comme clé d\'écriture', async () => {
    const { file } = prepare('config', USER);
    const before = readFileSync(file, 'utf8');
    const report = await runConfigSet({ key: 'models.grok-4.model_id', value: 'autre' });
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/model_id/);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('un rôle autre que primary est refusé', async () => {
    const { file } = prepare('home', USER);
    const before = readFileSync(file, 'utf8');
    const report = await runConfigSet({ key: 'model_roles.fast', value: 'grok-4' });
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/inconnue|pas pris en charge/);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('mode replace est refusé et le fichier actif reste identique', async () => {
    const { file } = prepare('home', USER);
    const before = readFileSync(file, 'utf8');
    const report = await runConfigSet({ key: 'catalogue.mode', value: 'replace' });
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/replace/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(rejectedFiles(file).length).toBe(1);
  });

  it.each(['home', 'config'] as const)(
    'set relit la couche utilisateur via %s, sans fichier projet',
    async (via) => {
      const { env, file } = prepare(via, USER);
      const report = await runConfigSet({ key: 'ui.theme', value: 'papier' });
      expect(report.ok, report.errors.join('\n')).toBe(true);
      const again = reread(env, file);
      expect(again.parsed).toMatchObject({
        active_model: 'grok-4',
        ui: { streaming: true, theme: 'papier' },
      });
      expect(JSON.stringify(again.parsed)).not.toMatch(/undefined/);
      expect(again.catalogueActive).toBe('grok-4');
      expect(again.startup).toBe('grok-4-latest');
      expect(getConfigManager().getConfigPath()).toBe(file);
    },
  );

  it.each(['home', 'config'] as const)(
    'set n\'écrit pas la couche projet dans le fichier utilisateur (%s)',
    async (via) => {
      const { env, file, projectFile } = prepare(via, USER, PROJECT);
      expect(projectFile).not.toBeNull();
      const projectBefore = readFileSync(projectFile as string, 'utf8');
      const report = await runConfigSet({ key: 'middleware.max_turns', value: '12' });
      expect(report.ok, report.errors.join('\n')).toBe(true);
      const saved = readFileSync(file, 'utf8');
      expect(saved).not.toMatch(/sound_effects/);
      expect(saved).not.toMatch(/price_per_m_input/);
      expect(saved).toMatch(/max_turns = 12/);
      expect(readFileSync(projectFile as string, 'utf8')).toBe(projectBefore);
      const again = reread(env, file);
      const models = again.parsed.models as Record<string, Record<string, unknown>>;
      expect(models['grok-4']?.max_context_tokens).toBe(1000);
      expect(models['grok-4']?.price_per_m_input).toBeUndefined();
      expect((again.parsed.ui as Record<string, unknown>).streaming).toBe(true);
      expect((again.parsed.ui as Record<string, unknown>).sound_effects).toBeUndefined();
      expect(again.catalogueActive).toBe('grok-4');
    },
  );

  it('patch fusionne dans la couche utilisateur et garde la clé voisine', async () => {
    const { file, projectFile } = prepare('home', USER, PROJECT);
    const projectBefore = readFileSync(projectFile as string, 'utf8');
    const report = await runConfigPatch({ key: 'ui', value: '{"theme":"papier"}' });
    expect(report.ok, report.errors.join('\n')).toBe(true);
    const parsed = parseTOML(readFileSync(file, 'utf8'));
    expect(parsed.ui).toEqual({ streaming: true, theme: 'papier' });
    expect(readFileSync(projectFile as string, 'utf8')).toBe(projectBefore);
  });

  it('unset retire la clé et n\'écrit ni undefined ni null', async () => {
    const { file } = prepare('config', USER);
    const report = await runConfigUnset({ key: 'ui.streaming' });
    expect(report.ok, report.errors.join('\n')).toBe(true);
    const saved = readFileSync(file, 'utf8');
    expect(saved).not.toMatch(/streaming/);
    expect(saved).not.toMatch(/undefined/);
    expect(saved).not.toMatch(/\bnull\b/);
    const parsed = parseTOML(saved);
    expect(parsed.ui).toBeUndefined();
    expect(parsed.active_model).toBe('grok-4');
  });

  it('un lot JSON écrit deux clés et se relit', async () => {
    const { env, file } = prepare('home', USER);
    const report = await runConfigSet({
      batch: { 'ui.theme': 'papier', 'middleware.max_turns': 12 },
    });
    expect(report.ok, report.errors.join('\n')).toBe(true);
    expect(report.operations).toHaveLength(2);
    const again = reread(env, file);
    expect((again.parsed.ui as Record<string, unknown>).theme).toBe('papier');
    expect((again.parsed.middleware as Record<string, unknown>).max_turns).toBe(12);
  });

  it('la commande Commander set --dry-run --json imprime le rapport structuré', async () => {
    prepare('home', USER);
    const program = new Command();
    program.exitOverride();
    registerConfigCommand(program);
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(['node', 'buddy', 'config', 'set', 'ui.theme', 'papier', '--dry-run', '--json']);
    } finally {
      process.stdout.write = write;
    }
    const report = JSON.parse(chunks.join('')) as {
      ok: boolean;
      operations: unknown[];
      checks: unknown[];
      errors: unknown[];
    };
    expect(report.ok).toBe(true);
    expect(Array.isArray(report.operations)).toBe(true);
    expect(Array.isArray(report.checks)).toBe(true);
    expect(Array.isArray(report.errors)).toBe(true);
  });
});

describe('buddy config schema', () => {
  it('exporte le schéma TOML et les variables d\'environnement depuis Zod', () => {
    const document = exportConfigSchema();
    expect(document.$schema).toMatch(/json-schema/);
    const toml = document.toml as {
      properties: {
        ui: { properties: { theme: { type: string } } };
        models: { additionalProperties: { properties: Record<string, unknown> } };
        catalogue: { properties: { mode: { enum: string[] } } };
        model_roles: { properties: Record<string, unknown> };
      };
    };
    expect(toml.properties.ui.properties.theme.type).toBe('string');
    expect(toml.properties.models.additionalProperties.properties.model_id).toBeUndefined();
    expect(toml.properties.catalogue.properties.mode.enum).toEqual(['merge']);
    expect(Object.keys(toml.properties.model_roles.properties)).toEqual(['primary']);
    const env = document.env as { properties: Record<string, { type?: string }> };
    expect(env.properties.CODEBUDDY_MAX_TOKENS?.type).toBe('number');
  });

  it('les clés retirées du catalogue ne sont pas des chemins d\'écriture', () => {
    const paths = listWritableConfigPaths();
    expect(paths).not.toContain('models.*.model_id');
    expect(paths).not.toContain('model_roles.fast');
    expect(paths).not.toContain('model_roles.compact');
    expect(paths).not.toContain('model_roles.vision');
    expect(paths).not.toContain('catalogue.context_cache_ttl_seconds');
    expect(paths).toContain('catalogue.mode');
    expect(paths).toContain('model_roles.primary');
    expect(paths).toContain('ui.theme');
  });
});

function deliveredExample(): string {
  return readFileSync(path.join(process.cwd(), 'docs', 'config.toml.example'), 'utf8');
}

describe('exemple commenté', () => {
  it('chaque clé du schéma apparaît dans l\'exemple, et l\'exemple est celui du générateur', () => {
    const example = deliveredExample();
    const generated = renderTomlExample();
    expect(example).toBe(generated);
    expect(example.split('\n').filter((line) => /[ \t]$/.test(line))).toEqual([]);
    const missing = listWritableConfigPaths().filter((key) => !example.includes(`# cle: ${key}\n`));
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('l\'exemple livré se parse, s\'évalue et passe config validate', async () => {
    const example = deliveredExample();
    let parseError = '';
    try {
      parseTOML(example);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    expect(parseError, parseError).toBe('');
    expect(assessUserConfigText(example)).toBeNull();
    const previousGrok = process.env.GROK_API_KEY;
    process.env.GROK_API_KEY = 'exemple-non-secret';
    try {
      prepare('config', example);
      const report = await runConfigValidate();
      expect(report.tomlProblem).toBeNull();
      expect(report.envErrors, report.envErrors.join('\n')).toEqual([]);
      expect(report.ok).toBe(true);
    } finally {
      if (previousGrok === undefined) delete process.env.GROK_API_KEY;
      else process.env.GROK_API_KEY = previousGrok;
    }
  });

  it('chaque table de l\'exemple livré n\'est ouverte qu\'une fois', () => {
    const headers = deliveredExample()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^\[[^\]]+\]$/.test(line));
    const duplicates = [...new Set(headers.filter((header, index) => headers.indexOf(header) !== index))];
    expect(duplicates, duplicates.join(', ')).toEqual([]);
  });
});

describe('gateway.port diagnostique', () => {
  it('le schéma et la sortie disent que le port n\'est pas appliqué', async () => {
    const document = exportConfigSchema();
    const toml = document.toml as {
      properties: {
        gateway: { properties: { port: { description?: string } } };
      };
    };
    const description = toml.properties.gateway.properties.port.description ?? '';
    expect(description).toContain('DIAGNOSTIC NON APPLIQUÉ');
    expect(renderTomlExample()).toContain('DIAGNOSTIC NON APPLIQUÉ');
    expect(deliveredExample()).toContain('DIAGNOSTIC NON APPLIQUÉ');
    const { file } = prepare('home', USER);
    const report = await runConfigSet({ key: 'gateway.port', value: '34567' });
    expect(report.ok, report.errors.join('\n')).toBe(true);
    expect(report.notes?.join('\n') ?? '').toContain('DIAGNOSTIC NON APPLIQUÉ');
    expect(formatConfigReport(report, false)).toContain('DIAGNOSTIC NON APPLIQUÉ');
    expect(formatConfigReport(report, true)).toContain('DIAGNOSTIC NON APPLIQUÉ');
    expect(readFileSync(file, 'utf8')).toMatch(/port = 34567/);
  });
});

describe('sauvegardes rotatives et doctor --fix', () => {
  it('la première écriture range le texte précédent dans .bak et le nouveau dans last-good', async () => {
    const { file } = prepare('home', USER);
    const before = readFileSync(file, 'utf8');
    const report = await runConfigSet({ key: 'ui.theme', value: 'papier' });
    expect(report.ok, report.errors.join('\n')).toBe(true);
    expect(readFileSync(configBackupPath(file, 0), 'utf8')).toBe(before);
    expect(readFileSync(configLastGoodPath(file), 'utf8')).toBe(readFileSync(file, 'utf8'));
    expect(readFileSync(file, 'utf8')).toMatch(/theme = "papier"/);
  });

  it('la deuxième écriture décale .bak vers .bak.1', async () => {
    const { file } = prepare('config', USER);
    const first = readFileSync(file, 'utf8');
    expect((await runConfigSet({ key: 'ui.theme', value: 'papier' })).ok).toBe(true);
    const second = readFileSync(file, 'utf8');
    expect((await runConfigSet({ key: 'ui.theme', value: 'encre' })).ok).toBe(true);
    expect(readFileSync(configBackupPath(file, 0), 'utf8')).toBe(second);
    expect(readFileSync(configBackupPath(file, 1), 'utf8')).toBe(first);
    expect(readFileSync(file, 'utf8')).toMatch(/theme = "encre"/);
    expect(readFileSync(configLastGoodPath(file), 'utf8')).toBe(readFileSync(file, 'utf8'));
  });

  it('une écriture refusée après coup dépose rejected et ne remplace ni le fichier ni last-good', async () => {
    const { file } = prepare('home', USER);
    expect((await setConfigValue('ui.theme', 'papier')).success).toBe(true);
    const good = readFileSync(file, 'utf8');
    const lastGood = readFileSync(configLastGoodPath(file), 'utf8');
    const report = await runConfigSet({ key: 'models.nouveau.price_per_m_input', value: '1' });
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/price_per_m/);
    expect(readFileSync(file, 'utf8')).toBe(good);
    expect(readFileSync(configLastGoodPath(file), 'utf8')).toBe(lastGood);
    expect(rejectedFiles(file).length).toBeGreaterThan(0);
  });

  it('doctor --fix restaure last-good et parque le fichier refusé', async () => {
    const { file } = prepare('home', USER);
    expect((await runConfigSet({ key: 'ui.theme', value: 'papier' })).ok).toBe(true);
    const good = readFileSync(configLastGoodPath(file), 'utf8');
    writeFileSync(file, '[catalogue]\nmode = "replace"\n');
    resetConfigManager();
    const broken = checkUserConfigRecovery();
    expect(broken.status).toBe('error');
    expect(broken.fixable).toBe(true);
    const fixed = await broken.fix?.();
    expect(fixed?.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(good);
    expect(rejectedFiles(file).length).toBeGreaterThan(0);
    resetConfigManager();
    expect(checkUserConfigRecovery().status).toBe('ok');
  });

  it('sans last-good, doctor --fix ne remplace pas le fichier refusé', async () => {
    const { file } = prepare('config', '[catalogue]\nmode = "replace"\n');
    const before = readFileSync(file, 'utf8');
    expect(existsSync(configLastGoodPath(file))).toBe(false);
    const broken = checkUserConfigRecovery();
    expect(broken.status).toBe('error');
    expect(broken.fixable).toBe(false);
    expect(broken.fix).toBeUndefined();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('un fichier absent avec last-good est restauré par --fix', async () => {
    const { file } = prepare('home', USER);
    expect((await runConfigSet({ key: 'ui.theme', value: 'papier' })).ok).toBe(true);
    const good = readFileSync(configLastGoodPath(file), 'utf8');
    rmSync(file);
    resetConfigManager();
    const missing = checkUserConfigRecovery();
    expect(missing.status).toBe('warn');
    expect(missing.fixable).toBe(true);
    expect((await missing.fix?.())?.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(good);
  });

  it('le fichier généré par défaut reste acceptable pour l\'écriture', () => {
    expect(assessUserConfigText(serializeTOML(DEFAULT_CONFIG))).toBeNull();
  });
});
