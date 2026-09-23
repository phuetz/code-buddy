/**
 * Reprise du catalogue : profils intégrés, écriture sans perte,
 * fusion de deux fichiers, priorité réelle du démarrage.
 * Le profil de la machine n'est pas ouvert : HOME et CODEBUDDY_HOME
 * pointent vers un répertoire temporaire.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { setConfigValue } from '../../src/config/config-mutator.js';
import {
  CatalogueConfigError,
  GENERATED_ACTIVE_MODEL,
  activateCatalogue,
  assertUserCatalogue,
  parseCatalogueConfig,
  resolveStartupModel,
  selectConfiguredModel,
} from '../../src/config/model-catalogue.js';
import { getModelPricing } from '../../src/config/model-pricing.js';
import { resetModelCatalogueOverlays } from '../../src/config/model-tools.js';
import {
  DEFAULT_CONFIG,
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
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousCodebuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = previousCodebuddyHome;
  if (previousConfig === undefined) delete process.env.CODEBUDDY_CONFIG;
  else process.env.CODEBUDDY_CONFIG = previousConfig;
  process.chdir(previousCwd);
});

function isolatedDirs(): { home: string; project: string; file: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'cb-catalogue-reprise-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'projet');
  mkdirSync(path.join(home, '.codebuddy'), { recursive: true });
  mkdirSync(project, { recursive: true });
  return { home, project, file: path.join(home, '.codebuddy', 'config.toml') };
}

describe('profils intégrés sur le chemin de démarrage', () => {
  it('core et all avec un config.toml généré laissent le fournisseur détecté', () => {
    const { home, project, file } = isolatedDirs();
    writeFileSync(file, serializeTOML(DEFAULT_CONFIG));
    process.chdir(project);
    expect(readFileSync(file, 'utf8')).not.toContain('[profiles.');
    for (const profile of ['core', 'all'] as const) {
      const decision = resolveStartupModel({
        argv: ['node', 'buddy', '--profile', profile],
        env: { CODEBUDDY_HOME: home },
        allowUserHome: true,
        detected: { provider: 'openai', defaultModel: 'gpt-4o' },
        isCompatible: () => true,
      });
      expect(decision.model, profile).toBe('gpt-4o');
      expect(decision.source, profile).toBe('detected');
      expect(decision.model, profile).not.toBe('grok-code-fast-1');
      expect(decision.model, profile).not.toBe(GENERATED_ACTIVE_MODEL);
    }
  });

  it('un profil du fichier sans active_model ne choisit pas le modèle généré', () => {
    const { home, project, file } = isolatedDirs();
    writeFileSync(file, `${serializeTOML(DEFAULT_CONFIG)}\n[profiles.calme]\n`);
    process.chdir(project);
    const decision = resolveStartupModel({
      argv: ['node', 'buddy', '--profile', 'calme'],
      env: { CODEBUDDY_HOME: home },
      allowUserHome: true,
      detected: { provider: 'openai', defaultModel: 'gpt-4o' },
    });
    expect(decision.model).toBe('gpt-4o');
    expect(decision.source).toBe('detected');
  });
});

describe('écriture sans perte', () => {
  it('un /config set hors modèles garde le catalogue, les rôles, les alias, les capacités et les profils', async () => {
    const { home, project, file } = isolatedDirs();
    process.env.HOME = home;
    process.env.CODEBUDDY_HOME = home;
    delete process.env.CODEBUDDY_CONFIG;
    process.chdir(project);
    const fixture = [
      'active_model = "grok-4"',
      '',
      '[catalogue]',
      'mode = "merge"',
      '',
      '[model_roles]',
      'primary = "grok-4"',
      '',
      '[model_aliases]',
      'court = "grok-4"',
      '',
      '[models.exemple-fenetre]',
      'provider = "openai"',
      'model_id = "exemple-fenetre"',
      'price_per_m_input = 0',
      'price_per_m_output = 0',
      'max_context_tokens = 64000',
      'reasoning = true',
      'vision = false',
      'tools = true',
      '',
      '[profiles.perso]',
      'active_model = "grok-4"',
      '',
    ].join('\n');
    writeFileSync(file, fixture);
    resetConfigManager();
    const result = await setConfigValue('ui.theme', 'papier');
    expect(result.success).toBe(true);
    expect(result.newValue).toBe('papier');
    const saved = readFileSync(file, 'utf8');
    expect(saved).toContain('theme = "papier"');
    expect(saved).toContain('[catalogue]');
    expect(saved).toContain('mode = "merge"');
    expect(saved).toContain('[model_roles]');
    expect(saved).toContain('primary = "grok-4"');
    expect(saved).toContain('[model_aliases]');
    expect(saved).toContain('court = "grok-4"');
    expect(saved).toContain('[models.exemple-fenetre]');
    expect(saved).toContain('max_context_tokens = 64000');
    expect(saved).toContain('reasoning = true');
    expect(saved).toContain('vision = false');
    expect(saved).toContain('tools = true');
    expect(saved).toContain('[profiles.perso]');
    expect(saved).toContain('active_model = "grok-4"');
  });
});

describe('fusion des fichiers personnel et projet', () => {
  it('active_model en tête du projet ne tombe pas dans la dernière section du fichier personnel', () => {
    const { home, project, file } = isolatedDirs();
    writeFileSync(file, '[models.x]\nmax_context_tokens = 4000\n');
    mkdirSync(path.join(project, '.codebuddy'), { recursive: true });
    writeFileSync(path.join(project, '.codebuddy', 'config.toml'), 'active_model = "grok-4"\n');
    process.chdir(project);
    const document = assertUserCatalogue({ CODEBUDDY_HOME: home }, true);
    expect(document?.activeModel).toBe('grok-4');
    expect(document?.models.x?.values.contextWindow).toBe(4000);
    expect(document?.models.x?.values).not.toHaveProperty('activeModel');
  });
});

describe('priorité réelle du démarrage', () => {
  it('le active_model généré ne masque ni le réglage sauvé ni le fournisseur détecté', () => {
    const decision = resolveStartupModel({
      argv: ['node', 'buddy'],
      configText: serializeTOML(DEFAULT_CONFIG),
      readDefaultPath: false,
      detected: { provider: 'openai', defaultModel: 'gpt-4o' },
      settingsModel: 'claude-sonnet-4-5',
      isCompatible: (model) => model === 'claude-sonnet-4-5',
    });
    expect(decision.source).toBe('settings');
    expect(decision.model).toBe('claude-sonnet-4-5');
    expect(decision.model).not.toBe('grok-code-fast-1');
  });

  it('un active_model explicite gagne sur le réglage sauvé et le fournisseur', () => {
    const decision = resolveStartupModel({
      configText: 'active_model = "grok-4"\n',
      readDefaultPath: false,
      settingsModel: 'gpt-4o',
      detected: { provider: 'openai', defaultModel: 'gpt-4o' },
    });
    expect(decision.source).toBe('user');
    expect(decision.model).toBe('grok-4-latest');
  });

  it('CODEBUDDY_MODEL gagne sur le profil et sur GROK_MODEL', () => {
    const decision = resolveStartupModel({
      argv: ['node', 'buddy', '--profile', 'rapide'],
      env: { CODEBUDDY_MODEL: 'depuis-env', GROK_MODEL: 'depuis-grok' },
      configText: '[profiles.rapide]\nactive_model = "grok-4"\n',
      readDefaultPath: false,
      detected: { provider: 'openai', defaultModel: 'gpt-4o' },
    });
    expect(decision.source).toBe('env');
    expect(decision.model).toBe('depuis-env');
  });

  it('--model gagne sur CODEBUDDY_MODEL', () => {
    const decision = resolveStartupModel({
      argv: ['node', 'buddy', '--model', 'depuis-cli'],
      env: { CODEBUDDY_MODEL: 'depuis-env' },
      configText: 'active_model = "grok-4"\n',
      readDefaultPath: false,
    });
    expect(decision.source).toBe('cli');
    expect(decision.model).toBe('depuis-cli');
  });
});

describe('contrat réduit', () => {
  it('signale une section non fermée avec le fichier et la ligne', () => {
    expect(() => parseCatalogueConfig('[catalogue\nmode = "merge"\n', 'reglage.toml')).toThrow(CatalogueConfigError);
    expect(() => parseCatalogueConfig('[catalogue\nmode = "merge"\n', 'reglage.toml')).toThrow(
      /section non fermée « \[catalogue » \(reglage.toml, ligne 1\)/,
    );
  });

  it('refuse un alias dont la cible est inconnue', () => {
    expect(() => selectConfiguredModel({
      configText: 'active_model = "monalias"\n[model_aliases]\nmonalias = "cible-inconnue"\n',
      readDefaultPath: false,
    })).toThrow(/« cible-inconnue » \(alias « monalias »\) est inconnu/);
  });

  it('applique un prix TOML à getModelPricing', () => {
    const document = parseCatalogueConfig('[models.grok-4]\nprice_per_m_input = 1.5\nprice_per_m_output = 2.5\n');
    activateCatalogue(document);
    expect(getModelPricing('grok-4').inputPerMillion).toBe(1.5);
    expect(getModelPricing('grok-4-latest').outputPerMillion).toBe(2.5);
  });
});
