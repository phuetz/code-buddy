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
import { resetConfigManager } from '../../src/config/toml-config.js';

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
