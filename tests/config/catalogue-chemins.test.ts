/**
 * Troisième passe : le préchargement de --profile, /config set et
 * l'affichage `models` suivent le même fichier que la session.
 * HOME et CODEBUDDY_HOME restent des répertoires temporaires.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { preloadRequestedProfile } from '../../src/cli/preload-profile.js';
import { renderModelShow, renderModelsList } from '../../src/commands/models-command.js';
import { setConfigValue } from '../../src/config/config-mutator.js';
import { assertUserCatalogue, resolveStartupModel } from '../../src/config/model-catalogue.js';
import { resetModelCatalogueOverlays } from '../../src/config/model-tools.js';
import { getConfigManager, resetConfigManager } from '../../src/config/toml-config.js';

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

function isolated(): {
  ordinary: string;
  alternate: string;
  project: string;
  ordinaryFile: string;
  alternateFile: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'cb-catalogue-chemins-'));
  const ordinary = path.join(root, 'ordinaire');
  const alternate = path.join(root, 'alternatif');
  const project = path.join(root, 'projet');
  mkdirSync(path.join(ordinary, '.codebuddy'), { recursive: true });
  mkdirSync(path.join(alternate, '.codebuddy'), { recursive: true });
  mkdirSync(project, { recursive: true });
  return {
    ordinary,
    alternate,
    project,
    ordinaryFile: path.join(ordinary, '.codebuddy', 'config.toml'),
    alternateFile: path.join(alternate, '.codebuddy', 'config.toml'),
  };
}

function useOrdinaryHome(ordinary: string, project: string): void {
  process.env.HOME = ordinary;
  delete process.env.CODEBUDDY_HOME;
  delete process.env.CODEBUDDY_CONFIG;
  process.chdir(project);
  process.exitCode = undefined;
  resetConfigManager();
}

const CATALOGUE = [
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
  'max_context_tokens = 64000',
  'reasoning = true',
  'vision = false',
  'tools = true',
  '',
  '[profiles.rapide]',
  'active_model = "grok-4"',
  '',
].join('\n');

describe('préchargement de --profile sur le chemin documenté', () => {
  it('applique un profil défini seulement dans CODEBUDDY_HOME', () => {
    const { ordinary, alternate, project, alternateFile } = isolated();
    writeFileSync(alternateFile, '[profiles.rapide]\nactive_model = "grok-4"\n');
    useOrdinaryHome(ordinary, project);
    process.env.CODEBUDDY_HOME = alternate;
    resetConfigManager();
    const stderr: string[] = [];
    preloadRequestedProfile(['node', 'buddy', '--profile', 'rapide'], {
      write(chunk: string) {
        stderr.push(chunk);
      },
    });
    expect(stderr.join(''), 'le vrai préchargement lit CODEBUDDY_HOME').toBe('');
    expect(process.exitCode ?? 0).not.toBe(1);
    expect(getConfigManager().getConfigPath()).toBe(alternateFile);
    expect(getConfigManager().getConfig().active_model).toBe('grok-4');
    const decision = resolveStartupModel({
      argv: ['node', 'buddy', '--profile', 'rapide'],
      env: { CODEBUDDY_HOME: alternate },
      allowUserHome: true,
      detected: { provider: 'openai', defaultModel: 'gpt-4o' },
    });
    expect(decision.source).toBe('profile');
    expect(decision.model).toBe('grok-4-latest');
  });

  it('applique un profil défini seulement dans CODEBUDDY_CONFIG', () => {
    const { ordinary, project } = isolated();
    const configFile = path.join(project, 'reglage.toml');
    writeFileSync(configFile, '[profiles.rapide]\nactive_model = "grok-4"\n');
    useOrdinaryHome(ordinary, project);
    process.env.CODEBUDDY_CONFIG = configFile;
    resetConfigManager();
    const stderr: string[] = [];
    preloadRequestedProfile(['node', 'buddy', '--profile', 'rapide'], {
      write(chunk: string) {
        stderr.push(chunk);
      },
    });
    expect(stderr.join(''), 'le vrai préchargement lit CODEBUDDY_CONFIG').toBe('');
    expect(process.exitCode ?? 0).not.toBe(1);
    expect(getConfigManager().getConfigPath()).toBe(configFile);
    expect(getConfigManager().getConfig().active_model).toBe('grok-4');
  });

});

describe('/config set sur le chemin documenté', () => {
  it('écrit dans CODEBUDDY_HOME et garde le catalogue', async () => {
    const { ordinary, alternate, project, ordinaryFile, alternateFile } = isolated();
    writeFileSync(alternateFile, CATALOGUE);
    useOrdinaryHome(ordinary, project);
    process.env.CODEBUDDY_HOME = alternate;
    resetConfigManager();
    const result = await setConfigValue('ui.theme', 'papier');
    expect(result.success).toBe(true);
    const saved = readFileSync(alternateFile, 'utf8');
    expect(saved, `ordinaire créé=${existsSync(ordinaryFile)}`).toContain('theme = "papier"');
    expect(existsSync(ordinaryFile)).toBe(false);
    expect(saved).toContain('[catalogue]');
    expect(saved).toContain('mode = "merge"');
    expect(saved).toContain('[model_roles]');
    expect(saved).toContain('primary = "grok-4"');
    expect(saved).toContain('[model_aliases]');
    expect(saved).toContain('court = "grok-4"');
    expect(saved).toContain('[models.exemple-fenetre]');
    expect(saved).toContain('max_context_tokens = 64000');
    expect(saved).toContain('[profiles.rapide]');
    expect(saved).toContain('active_model = "grok-4"');
  });

  it('écrit dans CODEBUDDY_CONFIG et garde le catalogue', async () => {
    const { ordinary, project, ordinaryFile } = isolated();
    const configFile = path.join(project, 'reglage.toml');
    writeFileSync(configFile, CATALOGUE);
    useOrdinaryHome(ordinary, project);
    process.env.CODEBUDDY_CONFIG = configFile;
    resetConfigManager();
    const result = await setConfigValue('ui.theme', 'papier');
    expect(result.success).toBe(true);
    const saved = readFileSync(configFile, 'utf8');
    expect(saved, `ordinaire créé=${existsSync(ordinaryFile)}`).toContain('theme = "papier"');
    expect(existsSync(ordinaryFile)).toBe(false);
    expect(saved).toContain('[catalogue]');
    expect(saved).toContain('[models.exemple-fenetre]');
    expect(saved).toContain('max_context_tokens = 64000');
    expect(saved).toContain('[profiles.rapide]');
  });
});

describe('model_id retiré de cette version', () => {
  it('refuse un model_id qui substitue une cible inconnue', () => {
    const text = 'active_model = "x"\n[models.x]\nmodel_id = "cible-inconnue"\n';
    expect(() => resolveStartupModel({ configText: text, readDefaultPath: false })).toThrow(
      /model_id n'est pas pris en charge/,
    );
    expect(() => resolveStartupModel({ configText: text, readDefaultPath: false })).toThrow(
      /Retirez model_id/,
    );
  });

  it('refuse aussi un model_id qui pointe vers un autre modèle connu', () => {
    expect(() => resolveStartupModel({
      configText: 'active_model = "x"\n[models.x]\nmodel_id = "grok-4"\n',
      readDefaultPath: false,
    })).toThrow(/model_id n'est pas pris en charge/);
  });

  it('accepte la répétition exacte de l\'identifiant intégré sans changer le nom', () => {
    const decision = resolveStartupModel({
      configText: 'active_model = "grok-4"\n[models.grok-4]\nmodel_id = "grok-4-latest"\n',
      readDefaultPath: false,
    });
    expect(decision.source).toBe('user');
    expect(decision.model).toBe('grok-4-latest');
  });
});

describe('models list/show et la session', () => {
  it('affiche la même fusion personnel + projet que la session', () => {
    const { ordinary, alternate, project, alternateFile } = isolated();
    writeFileSync(
      alternateFile,
      '[models.grok-4]\nmax_context_tokens = 1000\nreasoning = false\n',
    );
    mkdirSync(path.join(project, '.codebuddy'), { recursive: true });
    writeFileSync(
      path.join(project, '.codebuddy', 'config.toml'),
      '[models.grok-4]\nmax_context_tokens = 222222\n',
    );
    useOrdinaryHome(ordinary, project);
    const env = { HOME: ordinary, CODEBUDDY_HOME: alternate };
    const session = assertUserCatalogue(env, true);
    const window = session?.models['grok-4']?.values.contextWindow;
    expect(window).toBe(222222);
    expect(session?.models['grok-4']?.values.reasoning).toBe(false);
    const list = renderModelsList({ env });
    const show = renderModelShow('grok-4', { env });
    expect(list).toContain(`grok-4 [surcharge] contexte=${window}`);
    expect(list).not.toContain('grok-4 [surcharge] contexte=1000');
    expect(show).toContain('contexte: 222222 (configuration)');
    expect(show).toContain('raisonnement: false (configuration)');
    expect(show).not.toContain('contexte: 1000');
  });

  it('--config lit exactement ce fichier, sans fusion du projet', () => {
    const { ordinary, alternate, project, alternateFile } = isolated();
    writeFileSync(alternateFile, '[models.grok-4]\nmax_context_tokens = 1000\n');
    mkdirSync(path.join(project, '.codebuddy'), { recursive: true });
    writeFileSync(
      path.join(project, '.codebuddy', 'config.toml'),
      '[models.grok-4]\nmax_context_tokens = 222222\n',
    );
    useOrdinaryHome(ordinary, project);
    const show = renderModelShow('grok-4', {
      configPath: alternateFile,
      env: { HOME: ordinary, CODEBUDDY_HOME: alternate },
    });
    expect(show).toContain('contexte: 1000 (configuration)');
    expect(show).not.toContain('222222');
  });
});
