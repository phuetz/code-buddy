/**
 * Contre-revue de l'outillage : lectures héritées, références, prévisualisation,
 * URL d'alias, diagnostic des politiques, validation du TOML actif.
 * Aucun profil réel : répertoires temporaires seulement.
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerConfigCommand } from '../../src/commands/cli/config-command.js';
import { registerPolicyCommand } from '../../src/commands/cli/policy-command.js';
import { sessionLaunchFromDecision } from '../../src/config/alias-session.js';
import { runConfigPatch, runConfigSet } from '../../src/config/config-cli.js';
import { setConfigValue } from '../../src/config/config-mutator.js';
import { resolveStartupModel } from '../../src/config/model-catalogue.js';
import { assessUserConfigText, getConfigManager, resetConfigManager } from '../../src/config/toml-config.js';
import { checkDomainPolicy } from '../../src/doctor/domain-policy-check.js';
import { logger } from '../../src/utils/logger.js';

const INHERITED = ['toString', 'valueOf', 'constructor', '__proto__', 'hasOwnProperty'] as const;
const SENTINEL = 'SENTINELLE_FACTICE_21A4';
const SENTINEL_ENV = 'CB_REPRISE_SENTINELLE';
const PLAIN = 'jeton-clair-exemple';

const previousHome = process.env.HOME;
const previousCodebuddyHome = process.env.CODEBUDDY_HOME;
const previousConfig = process.env.CODEBUDDY_CONFIG;
const previousCwd = process.cwd();
const previousExit = process.exitCode;
const homes: string[] = [];

afterEach(() => {
  resetConfigManager();
  process.exitCode = previousExit;
  delete process.env[SENTINEL_ENV];
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousCodebuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = previousCodebuddyHome;
  if (previousConfig === undefined) delete process.env.CODEBUDDY_CONFIG;
  else process.env.CODEBUDDY_CONFIG = previousConfig;
  process.chdir(previousCwd);
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function isolate(configText = 'active_model = "grok-4"\n'): { home: string; configFile: string } {
  const home = mkdtempSync(path.join(tmpdir(), 'cb-reprise-'));
  homes.push(home);
  const directory = path.join(home, '.codebuddy');
  mkdirSync(directory, { recursive: true });
  const configFile = path.join(directory, 'config.toml');
  writeFileSync(configFile, configText.endsWith('\n') ? configText : `${configText}\n`);
  process.env.HOME = home;
  process.env.CODEBUDDY_HOME = home;
  process.env.CODEBUDDY_CONFIG = configFile;
  process.chdir(home);
  resetConfigManager();
  return { home, configFile };
}

function aliasText(target: string): string {
  return `active_model = "a"\n[model_aliases]\na = "${target}"\n`;
}

function readTree(directory: string): string {
  if (!existsSync(directory)) return '';
  return readdirSync(directory)
    .map((name) => readFileSync(path.join(directory, name), 'utf8'))
    .join('\n');
}

describe('lectures héritées refusées', () => {
  it.each(INHERITED)('analyse : %s n\'est pas un modèle', (name) => {
    const problem = assessUserConfigText(aliasText(name));
    expect(problem ?? '', name).toMatch(/inconnu/);
  });

  it.each(INHERITED)('écriture : %s n\'est pas enregistré comme alias', async (name) => {
    const { configFile } = isolate();
    const before = readFileSync(configFile, 'utf8');
    const result = await setConfigValue('model_aliases.court', name);
    expect(result.success, result.error).toBe(false);
    expect(result.error).toMatch(/inconnu/);
    expect(readFileSync(configFile, 'utf8')).toBe(before);
  });

  it.each(INHERITED)('démarrage : %s ne devient pas le modèle', (name) => {
    expect(() => resolveStartupModel({
      configText: aliasText(name),
      cli: 'a',
      readDefaultPath: false,
      env: {},
    })).toThrow(/inconnu/);
  });

  it.each(INHERITED)('démarrage : le profil %s n\'existe pas', (name) => {
    expect(() => resolveStartupModel({
      configText: 'active_model = "grok-4"\n',
      argv: ['node', 'buddy', '--profile', name],
      readDefaultPath: false,
      env: {},
    })).toThrow(/n'existe pas/);
  });
});

describe('référence de secret conservée', () => {
  it('la sentinelle factice est absente du fichier, du rapport, des journaux et des sauvegardes', async () => {
    process.env[SENTINEL_ENV] = SENTINEL;
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    try {
      const { configFile } = isolate('ui.theme = "papier"\n');
      const directory = path.dirname(configFile);
      const report = await runConfigSet({
        key: 'ui.theme',
        value: `\${env:${SENTINEL_ENV}}`,
      });
      expect(report.ok, report.errors.join('\n')).toBe(true);
      const reportText = JSON.stringify(report);
      expect(reportText).toContain(`\${env:${SENTINEL_ENV}}`);
      expect(reportText).not.toContain(SENTINEL);
      const rotated = await runConfigSet({ key: 'ui.theme', value: 'autre-theme' });
      expect(rotated.ok, rotated.errors.join('\n')).toBe(true);
      const refused = await runConfigSet({ key: 'model_aliases.court', value: 'pas-un-modele-xyz' });
      expect(refused.ok).toBe(false);
      const stored = readTree(directory);
      expect(stored).not.toContain(SENTINEL);
      const logs = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
        .flat()
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join('\n');
      expect(logs).not.toContain(SENTINEL);
    } finally {
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('une valeur déjà en clair continue d\'être lue', async () => {
    const { configFile } = isolate(`[ui]\ntheme = "${PLAIN}"\n`);
    expect(getConfigManager().getConfig().ui.theme).toBe(PLAIN);
    const report = await runConfigSet({ key: 'ui.show_tokens', value: 'false' });
    expect(report.ok, report.errors.join('\n')).toBe(true);
    expect(readFileSync(configFile, 'utf8')).toContain(PLAIN);
    expect(getConfigManager().getConfig().ui.theme).toBe(PLAIN);
  });

  it('le point d\'usage résout la référence et le fichier garde la référence', async () => {
    process.env[SENTINEL_ENV] = SENTINEL;
    const { configFile } = isolate('ui.theme = "papier"\n');
    const report = await runConfigSet({
      key: 'ui.theme',
      value: `\${env:${SENTINEL_ENV}}`,
    });
    expect(report.ok, report.errors.join('\n')).toBe(true);
    expect(readFileSync(configFile, 'utf8')).toContain(`\${env:${SENTINEL_ENV}}`);
    expect(readFileSync(configFile, 'utf8')).not.toContain(SENTINEL);
    const stored = getConfigManager().getConfig().ui.theme;
    expect(stored).toBe(`\${env:${SENTINEL_ENV}}`);
    const used = await getConfigManager().getConfigForUse();
    expect(used.ui.theme).toBe(SENTINEL);
    expect(getConfigManager().getConfig().ui.theme).toBe(`\${env:${SENTINEL_ENV}}`);
    expect(readFileSync(configFile, 'utf8')).not.toContain(SENTINEL);
  });
});

describe('prévisualisation et écriture', () => {
  it('set --dry-run refuse l\'alias que l\'écriture refuse', async () => {
    const { configFile } = isolate();
    const before = readFileSync(configFile, 'utf8');
    const preview = await runConfigSet({
      key: 'model_aliases.court',
      value: 'pas-un-modele-xyz',
      dryRun: true,
    });
    expect(preview.ok).toBe(false);
    expect(preview.errors.join('\n')).toMatch(/inconnu/);
    expect(readFileSync(configFile, 'utf8')).toBe(before);
    expect(readdirSync(path.dirname(configFile)).some((name) => name.includes('rejected') || name.endsWith('.bak'))).toBe(false);
    const real = await runConfigSet({ key: 'model_aliases.court', value: 'pas-un-modele-xyz' });
    expect(real.ok).toBe(false);
    expect(real.errors.join('\n')).toMatch(/inconnu/);
    expect(readFileSync(configFile, 'utf8')).toBe(before);
  });

  it('patch --dry-run refuse le même alias inconnu', async () => {
    const { configFile } = isolate();
    const before = readFileSync(configFile, 'utf8');
    const preview = await runConfigPatch({
      key: 'model_aliases',
      value: '{"court":"pas-un-modele-xyz"}',
      dryRun: true,
    });
    expect(preview.ok).toBe(false);
    expect(preview.errors.join('\n')).toMatch(/inconnu/);
    expect(readFileSync(configFile, 'utf8')).toBe(before);
    const real = await runConfigPatch({
      key: 'model_aliases',
      value: '{"court":"pas-un-modele-xyz"}',
    });
    expect(real.ok).toBe(false);
    expect(readFileSync(configFile, 'utf8')).toBe(before);
  });
});

describe('url du fournisseur de l\'alias', () => {
  it('une clé CLI seule prend l\'URL du fournisseur, pas celle détectée', () => {
    const launched = sessionLaunchFromDecision(
      { apiKey: 'cle-detectee', baseURL: 'https://detected.example/v1', model: 'ancien' },
      { model: 'gpt-4o', provider: 'openai' },
      {},
      { apiKey: 'cle-ligne' },
    );
    expect(launched.apiKey).toBe('cle-ligne');
    expect(launched.baseURL).toBe('https://api.openai.com/v1');
    expect(launched.baseURL).not.toBe('https://detected.example/v1');
    expect(launched.model).toBe('gpt-4o');
  });

  it('base_url de l\'alias et l\'URL CLI restent prioritaires même avec une clé CLI seule', () => {
    const byAlias = sessionLaunchFromDecision(
      { apiKey: 'cle-detectee', baseURL: 'https://detected.example/v1', model: 'ancien' },
      { model: 'gpt-4o', provider: 'openai', baseUrl: 'https://alias.example/v1' },
      {},
      { apiKey: 'cle-ligne' },
    );
    expect(byAlias.apiKey).toBe('cle-ligne');
    expect(byAlias.baseURL).toBe('https://alias.example/v1');
    const byCli = sessionLaunchFromDecision(
      { apiKey: 'cle-detectee', baseURL: 'https://detected.example/v1', model: 'ancien' },
      { model: 'gpt-4o', provider: 'openai' },
      {},
      { apiKey: 'cle-ligne', baseURL: 'https://ligne.example/v1' },
    );
    expect(byCli.baseURL).toBe('https://ligne.example/v1');
    expect(byCli.apiKey).toBe('cle-ligne');
  });
});

describe('politiques affichées comme diagnostic', () => {
  it('policy check nomme chaque domaine comme diagnostic non appliqué', async () => {
    isolate('[gateway]\nbind = "lan"\n');
    const program = new Command();
    program.exitOverride();
    registerPolicyCommand(program);
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(['node', 'buddy', 'policy', 'check', '--json']);
    } finally {
      process.stdout.write = write;
    }
    const text = chunks.join('');
    expect(text).toContain('DIAGNOSTIC NON APPLIQUÉ');
    expect(text.toLowerCase()).not.toContain('effective');
    const report = JSON.parse(text) as { domains?: Array<{ domain: string; application: string }> };
    const domains = report.domains ?? [];
    for (const name of ['gateway', 'channels', 'mcp', 'sandbox', 'exec']) {
      expect(domains.find((item) => item.domain === name)?.application).toBe('DIAGNOSTIC NON APPLIQUÉ');
    }
  });

  it('doctor annonce le même diagnostic, sans le mot effective', () => {
    const { home } = isolate();
    const missing = path.join(home, 'absent.json');
    const check = checkDomainPolicy({
      systemPath: missing,
      userPath: path.join(home, 'autre-absent.json'),
      configFile: path.join(home, '.codebuddy', 'config.toml'),
    });
    expect(check.message).toContain('DIAGNOSTIC NON APPLIQUÉ');
    expect(check.message.toLowerCase()).not.toContain('effective');
  });
});

describe('buddy config validate', () => {
  it('refuse un TOML actif dont l\'alias est inconnu', async () => {
    const { configFile } = isolate('[model_aliases]\ncourt = "pas-un-modele-xyz"\n');
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'exemple-pas-une-cle';
    const logs: string[] = [];
    const log = console.log;
    console.log = (...parts: unknown[]) => {
      logs.push(parts.map((part) => String(part)).join(' '));
    };
    const program = new Command();
    program.exitOverride();
    registerConfigCommand(program);
    try {
      await program.parseAsync(['node', 'buddy', 'config', 'validate']);
    } finally {
      console.log = log;
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
    const text = logs.join('\n');
    expect(text).toMatch(/inconnu/);
    expect(text).not.toContain(SENTINEL);
    expect(readFileSync(configFile, 'utf8')).toContain('pas-un-modele-xyz');
    expect(process.exitCode).toBe(1);
  });
});
