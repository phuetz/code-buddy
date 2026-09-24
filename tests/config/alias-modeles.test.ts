/**
 * Alias résolus avant le catalogue.
 * Le profil de la machine n'est pas ouvert : textes fournis, ou répertoire temporaire.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { renderModelShow } from '../../src/commands/models-command.js';
import { setConfigValue } from '../../src/config/config-mutator.js';
import { resolveStartupModel } from '../../src/config/model-catalogue.js';
import { resetModelRegistry } from '../../src/config/model-registry.js';
import { assessUserConfigText, parseTOML, resetConfigManager } from '../../src/config/toml-config.js';

const previousHome = process.env.HOME;
const previousCodebuddyHome = process.env.CODEBUDDY_HOME;
const previousConfig = process.env.CODEBUDDY_CONFIG;
const previousAlias = process.env.CODEBUDDY_ALIAS_SONNET;
const previousCwd = process.cwd();

afterEach(() => {
  resetModelRegistry();
  resetConfigManager();
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousCodebuddyHome === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = previousCodebuddyHome;
  if (previousConfig === undefined) delete process.env.CODEBUDDY_CONFIG;
  else process.env.CODEBUDDY_CONFIG = previousConfig;
  if (previousAlias === undefined) delete process.env.CODEBUDDY_ALIAS_SONNET;
  else process.env.CODEBUDDY_ALIAS_SONNET = previousAlias;
  process.chdir(previousCwd);
});

const ATELIER = [
  '[models.atelier-local]',
  'max_context_tokens = 8000',
  'reasoning = false',
  '',
].join('\n');

function startup(configText: string, extra: {
  cli?: string;
  env?: Record<string, string | undefined>;
  argv?: string[];
} = {}) {
  return resolveStartupModel({
    configText,
    readDefaultPath: false,
    ...(extra.cli ? { cli: extra.cli } : {}),
    ...(extra.argv ? { argv: extra.argv } : {}),
    env: extra.env ?? {},
  });
}

describe('résolution avant le catalogue', () => {
  it('suit une chaîne jusqu\'au modèle, sans s\'arrêter sur l\'alias intermédiaire', () => {
    const decision = startup([
      'active_model = "a"',
      '[model_aliases]',
      'a = "b"',
      'b = "grok-4"',
      '',
    ].join('\n'));
    expect(decision.model).toBe('grok-4-latest');
    expect(decision.model).not.toBe('b');
    expect(decision.viaAlias).toBe(true);
    expect(decision.source).toBe('user');
  });

  it('un alias de la ligne de commande vers une cible inconnue échoue sans prendre le modèle d\'environnement', () => {
    expect(() => startup(
      '[model_aliases]\ncourt = "pas-un-modele"\n',
      { cli: 'court', env: { CODEBUDDY_MODEL: 'gpt-4o' } },
    )).toThrow(/pas-un-modele/);
    expect(() => startup(
      '[model_aliases]\ncourt = "pas-un-modele"\n',
      { cli: 'court', env: { CODEBUDDY_MODEL: 'gpt-4o' } },
    )).toThrow(/inconnu/);
  });

  it('un nom qui n\'est pas un alias reste tel quel, même s\'il est absent du catalogue', () => {
    const decision = startup('', { cli: 'pas-un-modele' });
    expect(decision.model).toBe('pas-un-modele');
    expect(decision.viaAlias).toBeUndefined();
    expect(decision.provider).toBeUndefined();
  });

  it('la ligne de commande gagne encore sur l\'environnement quand le jeton est un alias', () => {
    const decision = startup(
      '[model_aliases]\ncourt = "grok-4"\n',
      { cli: 'court', env: { CODEBUDDY_MODEL: 'gpt-4o' } },
    );
    expect(decision.source).toBe('cli');
    expect(decision.model).toBe('grok-4');
    expect(decision.model).not.toBe('gpt-4o');
  });
});

describe('alias intégrés surchargeables', () => {
  it('la configuration remplace la cible intégrée de sonnet', () => {
    const decision = startup('[model_aliases]\nsonnet = "grok-4"\n', { cli: 'sonnet' });
    expect(decision.model).toBe('grok-4');
    expect(decision.model).not.toBe('claude-sonnet-4-20250514');
  });

  it('une surcharge inconnue ne revient pas à la cible intégrée', () => {
    let message = '';
    try {
      startup('[model_aliases]\nsonnet = "pas-un-modele"\n', { cli: 'sonnet' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/inconnu/);
    expect(message).toMatch(/pas-un-modele/);
    expect(message).not.toContain('claude-sonnet-4-20250514');
  });

  it('un alias vers sonnet suit la cible intégrée, puis la surcharge', () => {
    const integrated = startup('[model_aliases]\ncourt = "sonnet"\n', { cli: 'court' });
    expect(integrated.model).toBe('claude-sonnet-4-20250514');
    const overridden = startup(
      '[model_aliases]\ncourt = "sonnet"\nsonnet = "grok-4"\n',
      { cli: 'court' },
    );
    expect(overridden.model).toBe('grok-4');
    expect(overridden.model).not.toBe('claude-sonnet-4-20250514');
  });

  it('la configuration gagne sur CODEBUDDY_ALIAS_SONNET', () => {
    process.env.CODEBUDDY_ALIAS_SONNET = 'gpt-4o';
    resetModelRegistry();
    const decision = startup('[model_aliases]\nsonnet = "grok-4"\n', { cli: 'sonnet' });
    expect(decision.model).toBe('grok-4');
    expect(decision.model).not.toBe('gpt-4o');
  });
});

describe('provider et base_url de l\'alias', () => {
  it('le provider d\'une entrée de catalogue ne choisit pas le fournisseur', () => {
    const decision = startup([
      'active_model = "exemple"',
      '[models.exemple]',
      'provider = "openai"',
      'max_context_tokens = 1000',
      '',
    ].join('\n'));
    expect(decision.model).toBe('exemple');
    expect(decision.provider).toBeUndefined();
    expect(decision.baseUrl).toBeUndefined();
  });

  it('l\'alias le plus proche fixe le fournisseur et l\'URL, le modèle est la fin de la chaîne', () => {
    const text = [
      ATELIER,
      '[model_aliases.a]',
      'model = "b"',
      'provider = "openai"',
      'base_url = "https://models.example/v1"',
      '',
      '[model_aliases.b]',
      'model = "atelier-local"',
      'provider = "ollama"',
      'base_url = "https://autres.example/v1"',
      '',
    ].join('\n');
    const decision = startup(text, { cli: 'a' });
    expect(decision.model).toBe('atelier-local');
    expect(decision.provider).toBe('openai');
    expect(decision.baseUrl).toBe('https://models.example/v1');
    expect(decision.provider).not.toBe('ollama');
  });

  it('un alias sans fournisseur hérite de celui de la cible', () => {
    const text = [
      ATELIER,
      '[model_aliases]',
      'a = "b"',
      '',
      '[model_aliases.b]',
      'model = "atelier-local"',
      'provider = "openai"',
      'base_url = "https://models.example/v1"',
      '',
    ].join('\n');
    const decision = startup(text, { cli: 'a' });
    expect(decision.model).toBe('atelier-local');
    expect(decision.provider).toBe('openai');
    expect(decision.baseUrl).toBe('https://models.example/v1');
  });

  it('la session utilise la clé, l\'URL et le modèle de l\'alias, pas ceux détectés', async () => {
    const decision = startup([
      ATELIER,
      '[model_aliases.local]',
      'model = "atelier-local"',
      'provider = "openai"',
      'base_url = "https://models.example/v1"',
      '',
    ].join('\n'), { cli: 'local' });
    const { sessionLaunchFromDecision } = await import('../../src/config/alias-session.js');
    const launched = sessionLaunchFromDecision(
      { apiKey: 'cle-detectee', baseURL: 'https://detecte.example/v1', model: 'ancien' },
      decision,
      { OPENAI_API_KEY: 'sk-alias-example' },
    );
    expect(launched.apiKey).toBe('sk-alias-example');
    expect(launched.baseURL).toBe('https://models.example/v1');
    expect(launched.model).toBe('atelier-local');
    expect(launched.apiKey).not.toBe('cle-detectee');
    const client = new CodeBuddyClient(launched.apiKey, launched.model, launched.baseURL, {
      enableFallbacks: false,
    });
    expect(client.getApiKey()).toBe('sk-alias-example');
    expect(client.getBaseURL()).toBe('https://models.example/v1');
    expect(client.getCurrentModel()).toBe('atelier-local');
  });

  it('un fournisseur local n\'emprunte pas la clé détectée', async () => {
    const decision = startup([
      ATELIER,
      '[model_aliases.local]',
      'model = "atelier-local"',
      'provider = "ollama"',
      'base_url = "https://models.example/v1"',
      '',
    ].join('\n'), { cli: 'local' });
    const { sessionLaunchFromDecision } = await import('../../src/config/alias-session.js');
    const launched = sessionLaunchFromDecision(
      { apiKey: 'cle-detectee', baseURL: 'https://detecte.example/v1', model: 'ancien' },
      decision,
      {},
    );
    expect(launched.apiKey).toBe('ollama');
    expect(launched.apiKey).not.toBe('cle-detectee');
    expect(launched.baseURL).toBe('https://models.example/v1');
    expect(launched.model).toBe('atelier-local');
  });

  it('sans clé pour le fournisseur demandé, la clé détectée n\'est pas reprise', async () => {
    const decision = startup([
      ATELIER,
      '[model_aliases.local]',
      'model = "atelier-local"',
      'provider = "openai"',
      'base_url = "https://models.example/v1"',
      '',
    ].join('\n'), { cli: 'local' });
    const { sessionLaunchFromDecision } = await import('../../src/config/alias-session.js');
    expect(() => sessionLaunchFromDecision(
      { apiKey: 'cle-detectee', baseURL: 'https://detecte.example/v1', model: 'ancien' },
      decision,
      {},
    )).toThrow(/aucune clé/);
  });

  it('une URL seule change l\'URL et garde la clé déjà choisie', async () => {
    const decision = startup([
      ATELIER,
      '[model_aliases.local]',
      'model = "atelier-local"',
      'base_url = "https://models.example/v1"',
      '',
    ].join('\n'), { cli: 'local' });
    expect(decision.provider).toBeUndefined();
    const { sessionLaunchFromDecision } = await import('../../src/config/alias-session.js');
    const launched = sessionLaunchFromDecision(
      { apiKey: 'cle-detectee', baseURL: 'https://detecte.example/v1', model: 'ancien' },
      decision,
      {},
    );
    expect(launched.apiKey).toBe('cle-detectee');
    expect(launched.baseURL).toBe('https://models.example/v1');
    expect(launched.model).toBe('atelier-local');
  });

  it('un alias sans provider ni URL ne change ni la clé ni l\'URL', async () => {
    const decision = startup('[model_aliases]\ncourt = "grok-4"\n', { cli: 'court' });
    expect(decision.provider).toBeUndefined();
    expect(decision.baseUrl).toBeUndefined();
    const { sessionLaunchFromDecision } = await import('../../src/config/alias-session.js');
    const launched = sessionLaunchFromDecision(
      { apiKey: 'cle-detectee', baseURL: 'https://detecte.example/v1', model: 'ancien' },
      decision,
      {},
    );
    expect(launched).toEqual({
      apiKey: 'cle-detectee',
      baseURL: 'https://detecte.example/v1',
      model: 'grok-4',
    });
  });

  it('un fournisseur qu\'un alias ne peut pas choisir est refusé', () => {
    expect(() => startup([
      ATELIER,
      '[model_aliases.local]',
      'model = "atelier-local"',
      'provider = "pas-un-fournisseur"',
      '',
    ].join('\n'), { cli: 'local' })).toThrow(/pas-un-fournisseur/);
  });

  it('la ligne de commande garde sa clé et son URL', async () => {
    const decision = startup([
      ATELIER,
      '[model_aliases.local]',
      'model = "atelier-local"',
      'provider = "openai"',
      'base_url = "https://models.example/v1"',
      '',
    ].join('\n'), { cli: 'local' });
    const { sessionLaunchFromDecision } = await import('../../src/config/alias-session.js');
    const launched = sessionLaunchFromDecision(
      { apiKey: 'cle-ligne', baseURL: 'https://ligne.example/v1', model: 'ancien' },
      decision,
      {},
      { apiKey: 'cle-ligne', baseURL: 'https://ligne.example/v1' },
    );
    expect(launched.apiKey).toBe('cle-ligne');
    expect(launched.baseURL).toBe('https://ligne.example/v1');
    expect(launched.model).toBe('atelier-local');
  });

  it('buddy models show affiche le modèle résolu, le fournisseur et l\'URL, pas la clé', () => {
    const shown = renderModelShow('local', {
      configText: [
        ATELIER,
        '[model_aliases.local]',
        'model = "atelier-local"',
        'provider = "openai"',
        'base_url = "https://models.example/v1"',
        '',
      ].join('\n'),
    });
    expect(shown).toContain('id: atelier-local');
    expect(shown).toContain('fournisseur: openai');
    expect(shown).toContain('url: https://models.example/v1');
    expect(shown).not.toContain('sk-');
    expect(shown).toContain('demandé: local');
  });
});

describe('écriture, étendue et non dupliquée', () => {
  it('accepte une chaîne vers un modèle connu et un alias intégré', () => {
    expect(assessUserConfigText([
      '[model_aliases]',
      'a = "b"',
      'b = "grok-4"',
      'court = "sonnet"',
      '',
    ].join('\n'))).toBeNull();
  });

  it('accepte une table model, provider et base_url', () => {
    expect(assessUserConfigText([
      ATELIER,
      '[model_aliases.local]',
      'model = "atelier-local"',
      'provider = "openai"',
      'base_url = "https://models.example/v1"',
      '',
    ].join('\n'))).toBeNull();
  });

  it('refuse toujours une cible inconnue et une boucle', () => {
    expect(assessUserConfigText('[model_aliases]\nmonalias = "cible-inconnue"\n')).toMatch(/inconnu/);
    expect(assessUserConfigText('[model_aliases]\na = "b"\nb = "a"\n')).toMatch(/circulaire/);
  });

  it('le projet remplace l\'alias de l\'utilisateur', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cb-alias-projet-'));
    const home = path.join(root, 'home');
    const project = path.join(root, 'projet');
    mkdirSync(path.join(home, '.codebuddy'), { recursive: true });
    mkdirSync(path.join(project, '.codebuddy'), { recursive: true });
    writeFileSync(path.join(home, '.codebuddy', 'config.toml'), '[model_aliases]\nsonnet = "gpt-4o"\n');
    writeFileSync(path.join(project, '.codebuddy', 'config.toml'), '[model_aliases]\nsonnet = "grok-4"\n');
    process.env.HOME = home;
    process.env.CODEBUDDY_HOME = home;
    delete process.env.CODEBUDDY_CONFIG;
    process.chdir(project);
    const decision = resolveStartupModel({
      argv: ['node', 'buddy', '--model', 'sonnet'],
      env: { CODEBUDDY_HOME: home },
      allowUserHome: true,
    });
    expect(decision.model).toBe('grok-4');
    expect(decision.model).not.toBe('gpt-4o');
  });

  it('set écrit une table d\'alias et la relit', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cb-alias-set-'));
    const home = path.join(root, 'home');
    const project = path.join(root, 'projet');
    mkdirSync(path.join(home, '.codebuddy'), { recursive: true });
    mkdirSync(project, { recursive: true });
    const file = path.join(home, '.codebuddy', 'config.toml');
    writeFileSync(file, 'active_model = "grok-4"\n');
    process.env.HOME = home;
    process.env.CODEBUDDY_HOME = home;
    delete process.env.CODEBUDDY_CONFIG;
    process.chdir(project);
    resetConfigManager();
    const result = await setConfigValue('model_aliases.local', {
      model: 'grok-4',
      provider: 'openai',
      base_url: 'https://models.example/v1',
    });
    expect(result.success, result.error).toBe(true);
    const parsed = parseTOML(readFileSync(file, 'utf8'));
    const aliases = parsed.model_aliases as Record<string, { model?: string; provider?: string; base_url?: string }>;
    expect(aliases.local?.model).toBe('grok-4');
    expect(aliases.local?.provider).toBe('openai');
    expect(aliases.local?.base_url).toBe('https://models.example/v1');
    const decision = resolveStartupModel({
      env: { CODEBUDDY_HOME: home },
      allowUserHome: true,
      cli: 'local',
    });
    expect(decision.model).toBe('grok-4');
    expect(decision.provider).toBe('openai');
    expect(decision.baseUrl).toBe('https://models.example/v1');
  });
});
