import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CatalogueConfigError,
  activateCatalogue,
  discoverContextWindow,
  emptyContextCache,
  freshContextWindow,
  mergeCatalogue,
  parseCatalogueConfig,
  readContextCache,
  resolveModelByPriority,
  resolveRole,
  selectConfiguredModel,
  selectionFromDocument,
} from '../../src/config/model-catalogue.js';
import {
  getModelToolConfig,
  resetModelCatalogueOverlays,
} from '../../src/config/model-tools.js';
import { MODEL_DEFAULTS } from '../../src/config/model-defaults.js';
import {
  createModelsCommand,
  refreshModelContext,
  renderModelShow,
  renderModelsList,
} from '../../src/commands/models-command.js';

const BASE = {
  'grok-4': {
    id: 'grok-4',
    provider: 'xai',
    modelId: 'grok-4-latest',
    contextWindow: 256000,
    maxTokens: 8192,
    reasoning: true,
    vision: false,
    tools: true,
    costInputPerMillion: 6,
    costOutputPerMillion: 18,
  },
};

afterEach(() => {
  resetModelCatalogueOverlays();
});

describe('fusion du catalogue', () => {
  it('une surcharge modifie la fenêtre sans effacer le reste de la fiche', () => {
    const document = parseCatalogueConfig(`
[catalogue]
mode = "merge"
[models.grok-4]
max_context_tokens = 111111
`);
    const merged = mergeCatalogue(BASE, document)['grok-4'];
    expect(merged?.contextWindow).toBe(111111);
    expect(merged?.provider).toBe('xai');
    expect(merged?.modelId).toBe('grok-4-latest');
    expect(merged?.maxTokens).toBe(8192);
    expect(merged?.reasoning).toBe(true);
    expect(merged?.vision).toBe(false);
    expect(merged?.tools).toBe(true);
    expect(merged?.costInputPerMillion).toBe(6);
  });

  it('le mode replace n\'est pas le défaut et n\'emprunte pas la fiche intégrée', () => {
    const document = parseCatalogueConfig(`
[catalogue]
mode = "replace"
[models.exemple-seul]
provider = "openai"
model_id = "exemple-seul"
max_context_tokens = 4096
`);
    const merged = mergeCatalogue(BASE, document);
    expect(merged['grok-4']).toBeUndefined();
    expect(merged['exemple-seul']?.provider).toBe('openai');
    expect(merged['exemple-seul']?.contextWindow).toBe(4096);
  });

  it('la surcharge atteint getModelToolConfig sans remplacer les autres capacités', () => {
    const document = parseCatalogueConfig(`
[models.exemple-principal]
provider = "openai"
model_id = "exemple-principal"
max_context_tokens = 131072
`);
    activateCatalogue(document);
    const config = getModelToolConfig('exemple-principal');
    expect(config.contextWindow).toBe(131072);
    expect(config.supportsToolCalls).toBe(true);
    expect(config.maxOutputTokens).toBe(4096);
  });
});

describe('modèle par défaut configurable', () => {
  it('change le modèle servi sans modifier la constante intégrée', () => {
    expect(MODEL_DEFAULTS.xai).toBe('grok-code-fast-1');
    const chosen = selectConfiguredModel({
      configText: 'active_model = "grok-4"\n',
      readDefaultPath: false,
    });
    expect(chosen).toBe('grok-4-latest');
    expect(chosen).not.toBe(MODEL_DEFAULTS.xai);
  });

  it('expose les rôles principal, rapide et vision', () => {
    const document = parseCatalogueConfig(`
[model_roles]
primary = "exemple-principal"
fast = "exemple-rapide"
vision = "exemple-vision"
[models.exemple-principal]
provider = "openai"
model_id = "exemple-principal"
max_context_tokens = 128000
[models.exemple-rapide]
provider = "openai"
model_id = "exemple-rapide"
max_context_tokens = 32000
[models.exemple-vision]
provider = "openai"
model_id = "exemple-vision"
max_context_tokens = 128000
vision = true
input = ["text", "image"]
`);
    expect(resolveRole(document, 'primary')).toBe('exemple-principal');
    expect(resolveRole(document, 'fast')).toBe('exemple-rapide');
    expect(resolveRole(document, 'vision')).toBe('exemple-vision');
    expect(selectConfiguredModel({ configText: readBack(document), readDefaultPath: false })).toBe('exemple-principal');
  });
});

describe('priorité de résolution', () => {
  it('l\'option CLI gagne sur l\'environnement', () => {
    const choice = resolveModelByPriority({
      cli: 'depuis-cli',
      env: 'depuis-env',
      profile: 'depuis-profil',
      user: 'depuis-config',
      discovered: 'depuis-decouverte',
      builtin: 'depuis-integre',
    });
    expect(choice.source).toBe('cli');
    expect(choice.model).toBe('depuis-cli');
  });

  it('l\'environnement gagne sur le profil', () => {
    const choice = resolveModelByPriority({
      env: 'depuis-env',
      profile: 'depuis-profil',
      user: 'depuis-config',
      builtin: 'depuis-integre',
    });
    expect(choice.source).toBe('env');
    expect(choice.model).toBe('depuis-env');
  });

  it('le profil gagne sur la configuration utilisateur', () => {
    const document = parseCatalogueConfig(`
active_model = "gpt-4o"
[profiles.rapide]
active_model = "grok-4"
`);
    const choice = selectionFromDocument(document, { profileName: 'rapide', builtin: 'depuis-integre' });
    expect(choice.source).toBe('profile');
    expect(choice.model).toBe('grok-4');
    expect(selectConfiguredModel({
      configText: `
active_model = "gpt-4o"
[profiles.rapide]
active_model = "grok-4"
`,
      argv: ['buddy', '--profile', 'rapide'],
      readDefaultPath: false,
    })).toBe('grok-4-latest');
  });

  it('la configuration utilisateur gagne sur le catalogue découvert', () => {
    const choice = resolveModelByPriority({
      user: 'depuis-config',
      discovered: 'depuis-decouverte',
      builtin: 'depuis-integre',
    });
    expect(choice.source).toBe('user');
    expect(choice.model).toBe('depuis-config');
  });

  it('le catalogue découvert gagne sur le catalogue intégré', () => {
    const choice = resolveModelByPriority({
      discovered: 'depuis-decouverte',
      builtin: 'depuis-integre',
    });
    expect(choice.source).toBe('discovered');
    expect(choice.model).toBe('depuis-decouverte');
  });

  it('ne remplace jamais le modèle demandé par le catalogue intégré', () => {
    const choice = resolveModelByPriority({ cli: 'modele-demande', builtin: 'depuis-integre' });
    expect(choice.model).toBe('modele-demande');
    expect(choice.model).not.toBe('depuis-integre');
  });
});

describe('configuration invalide', () => {
  it('refuse un mode inconnu avec un message explicite', () => {
    expect(() => parseCatalogueConfig('[catalogue]\nmode = "explode"\n')).toThrow(CatalogueConfigError);
    expect(() => parseCatalogueConfig('[catalogue]\nmode = "explode"\n')).toThrow(
      /Configuration de modèle invalide : mode « explode » inconnu/,
    );
  });

  it('refuse un fichier illisible au lieu de revenir au modèle intégré', () => {
    expect(() => selectConfiguredModel({ configText: '{{{ pas du toml', readDefaultPath: false })).toThrow(
      /Configuration de modèle invalide : le fichier ne contient aucune clé TOML reconnaissable/,
    );
  });

  it('refuse un modèle inconnu sans lui substituer le modèle intégré', () => {
    expect(() => selectConfiguredModel({
      configText: 'active_model = "modele-inexistant"\n',
      readDefaultPath: false,
    })).toThrow(/« modele-inexistant » est inconnu du catalogue/);
    expect(() => selectConfiguredModel({
      configText: 'active_model = "modele-inexistant"\n',
      readDefaultPath: false,
    })).toThrow(/Aucun autre modèle n'est utilisé à sa place/);
  });
});

describe('découverte du contexte', () => {
  it('interroge le fournisseur, puis le cache, puis expire', async () => {
    const calls: string[] = [];
    const windows = [111111, 222222];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      const contextWindow = windows[Math.min(calls.length, windows.length) - 1];
      return {
        ok: true,
        json: async () => ({ model_info: { 'exemple.context_length': contextWindow } }),
      };
    }) as typeof fetch;

    const first = await discoverContextWindow({
      source: 'ollama',
      baseURL: 'http://127.0.0.1:11434',
      model: 'exemple',
      cache: emptyContextCache(),
      now: 1_000,
      ttlMs: 500,
      fetchImpl,
    });
    expect(first.fromCache).toBe(false);
    expect(first.contextWindow).toBe(111111);
    expect(calls).toHaveLength(1);

    const second = await discoverContextWindow({
      source: 'ollama',
      baseURL: 'http://127.0.0.1:11434',
      model: 'exemple',
      cache: first.cache,
      now: 1_200,
      ttlMs: 500,
      fetchImpl,
    });
    expect(second.fromCache).toBe(true);
    expect(second.contextWindow).toBe(111111);
    expect(calls).toHaveLength(1);

    const third = await discoverContextWindow({
      source: 'ollama',
      baseURL: 'http://127.0.0.1:11434',
      model: 'exemple',
      cache: second.cache,
      now: 1_700,
      ttlMs: 500,
      fetchImpl,
    });
    expect(third.fromCache).toBe(false);
    expect(third.contextWindow).toBe(222222);
    expect(calls).toHaveLength(2);
    expect(freshContextWindow(second.cache, 'ollama|http://127.0.0.1:11434|exemple', 1_700, 500)).toBeNull();
  });

  it('lit la fenêtre OpenAI-compatible et n\'invente rien si le fournisseur est injoignable', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'exemple', context_length: 128000 }] }),
    })) as typeof fetch;
    const found = await discoverContextWindow({
      source: 'openai',
      baseURL: 'http://127.0.0.1:8080/v1',
      model: 'exemple',
      cache: emptyContextCache(),
      now: 10,
      ttlMs: 1000,
      fetchImpl,
    });
    expect(found.contextWindow).toBe(128000);

    const down = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9');
    }) as typeof fetch;
    await expect(discoverContextWindow({
      source: 'openai',
      baseURL: 'http://127.0.0.1:9/v1',
      model: 'exemple',
      cache: emptyContextCache(),
      now: 10,
      ttlMs: 1000,
      fetchImpl: down,
    })).rejects.toThrow(/Découverte de contexte impossible/);
  });

  it('refuse un cache corrompu', () => {
    expect(() => readContextCache('{')).toThrow(/Configuration de modèle invalide : le cache de contexte/);
  });
});

describe('commande models', () => {
  it('liste la surcharge et montre la fiche', () => {
    const configText = `
[model_roles]
primary = "exemple-principal"
fast = "exemple-rapide"
vision = "exemple-vision"
[models.exemple-principal]
provider = "openai"
model_id = "exemple-principal"
max_context_tokens = 128000
tools = true
[models.grok-4]
max_context_tokens = 111111
`;
    const list = renderModelsList({ configText });
    expect(list).toContain('exemple-principal [surcharge] contexte=128000');
    expect(list).toContain('principal: exemple-principal');
    const show = renderModelShow('grok-4', { configText });
    expect(show).toContain('contexte: 111111 (configuration)');
    expect(show).toContain('fournisseur: xai (intégré)');
  });

  it('déclare les sous-commandes list, show et refresh', () => {
    const names = createModelsCommand().commands.map((command) => command.name());
    expect(names).toEqual(['list', 'show', 'refresh']);
  });

  it('écrit le cache rafraîchi à l\'endroit demandé', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'catalogue-'));
    const configPath = path.join(dir, 'config.toml');
    const cachePath = path.join(dir, 'context-length-cache.json');
    writeFileSync(configPath, '[catalogue]\nmode = "merge"\ncontext_cache_ttl_seconds = 60\n');
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ model_info: { 'exemple.context_length': 65536 } }),
    })) as typeof fetch;
    const result = await refreshModelContext({
      configPath,
      cachePath,
      model: 'exemple',
      baseURL: 'http://127.0.0.1:11434',
      provider: 'ollama',
      now: 50,
      fetchImpl,
    });
    expect(result.message).toContain('65536');
    const stored = readContextCache(readFileSync(cachePath, 'utf8'));
    expect(stored.entries['ollama|http://127.0.0.1:11434|exemple']?.contextWindow).toBe(65536);
  });
});

describe('exemple de la documentation', () => {
  it('l\'exemple TOML du guide se parse et choisit le modèle principal', () => {
    const guide = readFileSync(path.join(process.cwd(), 'docs/catalogue-modeles.md'), 'utf8');
    const block = guide.match(/```toml\n([\s\S]*?)```/);
    expect(block?.[1]).toBeTruthy();
    const chosen = selectConfiguredModel({ configText: block?.[1] ?? '', readDefaultPath: false });
    expect(chosen).toBe('exemple-principal');
    const document = parseCatalogueConfig(block?.[1] ?? '');
    const merged = mergeCatalogue({
      'grok-4': { ...BASE['grok-4'] },
    }, document);
    expect(merged['grok-4']?.contextWindow).toBe(128000);
    expect(merged['grok-4']?.provider).toBe('xai');
  });
});

function readBack(document: ReturnType<typeof parseCatalogueConfig>): string {
  const lines = ['[model_roles]'];
  if (document.roles.primary) lines.push(`primary = "${document.roles.primary}"`);
  if (document.roles.fast) lines.push(`fast = "${document.roles.fast}"`);
  if (document.roles.vision) lines.push(`vision = "${document.roles.vision}"`);
  for (const patch of Object.values(document.models)) {
    lines.push(`[models.${patch.id}]`);
    if (patch.values.provider) lines.push(`provider = "${patch.values.provider}"`);
    if (patch.values.modelId) lines.push(`model_id = "${patch.values.modelId}"`);
    if (patch.values.contextWindow) lines.push(`max_context_tokens = ${patch.values.contextWindow}`);
    if (patch.values.vision !== undefined) lines.push(`vision = ${patch.values.vision}`);
    if (patch.values.input) lines.push(`input = [${patch.values.input.map((item) => `"${item}"`).join(', ')}]`);
  }
  lines.push('');
  return lines.join('\n');
}
