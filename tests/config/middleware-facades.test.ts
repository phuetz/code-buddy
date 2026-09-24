/**
 * Façades [middleware] : une clé documentée est branchée, ou refusée
 * à l'écriture avec un remède. Aucun profil réel.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classifyConfigPath, validateConfigValue } from '../../src/config/config-schema.js';
import { setConfigValue } from '../../src/config/config-mutator.js';
import { parseCatalogueConfig, selectionFromDocument } from '../../src/config/model-catalogue.js';
import {
  DEFAULT_CONFIG,
  getConfigManager,
  parseTOML,
  resetConfigManager,
  serializeTOML,
} from '../../src/config/toml-config.js';

const previousHome = process.env.CODEBUDDY_HOME;
const previousConfig = process.env.CODEBUDDY_CONFIG;
let scratch: string | undefined;

afterEach(() => {
  resetConfigManager();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
  if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = previousHome;
  if (previousConfig === undefined) delete process.env.CODEBUDDY_CONFIG;
  else process.env.CODEBUDDY_CONFIG = previousConfig;
});

describe('middleware — une seule source de défauts', () => {
  it('le sérialiseur des défauts suit le câblage et omet la clé refusée', () => {
    const toml = serializeTOML(DEFAULT_CONFIG);
    const middleware = parseTOML(toml).middleware as Record<string, unknown>;
    expect(middleware.max_turns).toBe(50);
    expect(middleware.max_cost).toBe(10);
    expect(middleware.turn_warning_threshold).toBe(0.8);
    expect(middleware.cost_warning_threshold).toBe(0.8);
    expect(middleware).not.toHaveProperty('auto_compact_threshold');
    expect(middleware).not.toHaveProperty('context_warning_percentage');
    expect(toml).not.toContain('context_warning_percentage');

    const live = {
      ...DEFAULT_CONFIG.middleware,
      max_turns: 80,
      auto_compact_threshold: 12345,
      context_warning_percentage: 0.7,
    } as typeof DEFAULT_CONFIG.middleware;
    const explicit = serializeTOML({ ...DEFAULT_CONFIG, middleware: live });
    expect(explicit).toContain('auto_compact_threshold = 12345');
    expect(explicit).toContain('max_turns = 80');
    expect(explicit).not.toContain('context_warning_percentage');
  });
});

describe('middleware — clés refusées à l\'écriture', () => {
  it('refuse context_warning_percentage avec le remède de l\'échelle 50/75/90', async () => {
    const verdict = classifyConfigPath('middleware.context_warning_percentage');
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/Clé refusée/);
    expect(verdict.message).toMatch(/50 %/);
    expect(verdict.message).toMatch(/75 %/);
    expect(verdict.message).toMatch(/90 %/);
    expect(verdict.message).toMatch(/Retirez la clé/);

    const nested = classifyConfigPath('profiles.exemple.middleware.context_warning_percentage');
    expect(nested.ok).toBe(false);
    expect(nested.message).toMatch(/50 %/);

    scratch = mkdtempSync(path.join(tmpdir(), 'mw-refus-'));
    process.env.CODEBUDDY_HOME = scratch;
    delete process.env.CODEBUDDY_CONFIG;
    resetConfigManager();
    const written = await setConfigValue('middleware.context_warning_percentage', 0.7);
    expect(written.success).toBe(false);
    expect(written.error ?? '').toMatch(/50 %/);
  });

  it('accepte encore les clés branchées et refuse un seuil hors de (0, 1]', () => {
    expect(classifyConfigPath('middleware.max_turns').ok).toBe(true);
    expect(classifyConfigPath('middleware.max_cost').ok).toBe(true);
    expect(classifyConfigPath('middleware.turn_warning_threshold').ok).toBe(true);
    expect(classifyConfigPath('middleware.cost_warning_threshold').ok).toBe(true);
    expect(classifyConfigPath('middleware.auto_compact_threshold').ok).toBe(true);
    expect(validateConfigValue('middleware.max_turns', 200)).toBeNull();
    expect(validateConfigValue('middleware.turn_warning_threshold', 1.5)).toMatch(/refusée|Expected|invalide|mismatch/i);
    expect(validateConfigValue('middleware.cost_warning_threshold', 0)).toMatch(/refusée|Expected|invalide|mismatch/i);
    expect(validateConfigValue('middleware.auto_compact_threshold', 0)).toMatch(/refusée|Expected|invalide|mismatch/i);
  });
});

/**
 * Classe : le parseur historique range [profiles.nom.x] sous la clé plate
 * « nom.x ». applyProfile doit replier chaque sous-table documentée dans le
 * profil, et ne pas présenter « nom.x » comme un profil.
 */
describe('profils — sous-tables [profiles.nom.x]', () => {
  function userConfig(body: string): void {
    scratch = mkdtempSync(path.join(tmpdir(), 'mw-profile-'));
    mkdirSync(path.join(scratch, '.codebuddy'), { recursive: true });
    writeFileSync(path.join(scratch, '.codebuddy', 'config.toml'), body);
    process.env.CODEBUDDY_HOME = scratch;
    delete process.env.CODEBUDDY_CONFIG;
    resetConfigManager();
  }

  it.each([
    ['middleware', 'max_turns = 7', (c: typeof DEFAULT_CONFIG) => c.middleware.max_turns, 7],
    ['ui', 'vim_keybindings = true', (c: typeof DEFAULT_CONFIG) => c.ui.vim_keybindings, true],
    ['agent', 'yolo_mode = true', (c: typeof DEFAULT_CONFIG) => c.agent.yolo_mode, true],
  ] as const)('[profiles.serre.%s] est appliquée par applyProfile', (section, line, read, expected) => {
    userConfig(`[profiles.serre]\nactive_model = "grok-3-latest"\n\n[profiles.serre.${section}]\n${line}\n`);
    const manager = getConfigManager();
    expect(read(manager.getConfig() as typeof DEFAULT_CONFIG)).not.toBe(expected);
    manager.applyProfile('serre');
    expect(read(manager.getConfig() as typeof DEFAULT_CONFIG)).toBe(expected);
    expect(manager.getAppliedProfiles()).toEqual(['serre']);
  });

  it('un profil fait seulement de sous-tables existe, et « serre.middleware » n\'est pas un profil', () => {
    userConfig('[profiles.serre.middleware]\nmax_turns = 7\n');
    const manager = getConfigManager();
    manager.applyProfile('serre');
    expect(manager.getConfig().middleware.max_turns).toBe(7);
    let message = '';
    try {
      manager.applyProfile('absent');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/Available profiles: .*\bserre\b/);
    expect(message).not.toContain('serre.middleware');
    expect(() => manager.applyProfile('serre.middleware')).toThrow(/not found/);
  });

  it('le catalogue des modèles connaît aussi un profil fait seulement de sous-tables', () => {
    const document = parseCatalogueConfig('[profiles.serre.middleware]\nmax_turns = 7\n');
    expect(Object.keys(document.profiles)).toEqual(['serre']);
    expect(() => selectionFromDocument(document, { profileName: 'serre', detected: 'modele-detecte' })).not.toThrow();
  });
});
