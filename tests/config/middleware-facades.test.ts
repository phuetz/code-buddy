/**
 * Façades [middleware] : une clé documentée est branchée, ou refusée
 * à l'écriture avec un remède. Aucun profil réel.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classifyConfigPath, validateConfigValue } from '../../src/config/config-schema.js';
import { setConfigValue } from '../../src/config/config-mutator.js';
import { DEFAULT_CONFIG, parseTOML, resetConfigManager, serializeTOML } from '../../src/config/toml-config.js';

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
