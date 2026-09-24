import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CatalogueConfigError,
  activateCatalogue,
  mergeCatalogue,
  parseCatalogueConfig,
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

  it('le mode replace est refusé : cette version ne l\'applique pas', () => {
    expect(() => parseCatalogueConfig(`
[catalogue]
mode = "replace"
[models.exemple-seul]
max_context_tokens = 4096
`)).toThrow(/mode « replace » n'est pas pris en charge/);
  });

  it('la surcharge atteint getModelToolConfig sans remplacer les autres capacités', () => {
    const document = parseCatalogueConfig(`
[models.exemple-principal]
provider = "openai"
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

  it('le rôle primary choisit le modèle, les autres rôles sont refusés', () => {
    const document = parseCatalogueConfig(`
[model_roles]
primary = "exemple-principal"
[models.exemple-principal]
provider = "openai"
max_context_tokens = 128000
vision = true
input = ["text", "image"]
`);
    expect(resolveRole(document)).toBe('exemple-principal');
    expect(() => parseCatalogueConfig('[model_roles]\nfast = "exemple-rapide"\n')).toThrow(
      /le rôle « fast » n'est pas pris en charge/,
    );
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
      settings: 'depuis-reglage',
      detected: 'depuis-fournisseur',
    });
    expect(choice.source).toBe('cli');
    expect(choice.model).toBe('depuis-cli');
  });

  it('l\'environnement gagne sur le profil', () => {
    const choice = resolveModelByPriority({
      env: 'depuis-env',
      profile: 'depuis-profil',
      user: 'depuis-config',
      detected: 'depuis-fournisseur',
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
    const choice = selectionFromDocument(document, { profileName: 'rapide', detected: 'depuis-fournisseur' });
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

  it('la configuration utilisateur gagne sur le réglage sauvé et le fournisseur détecté', () => {
    const choice = resolveModelByPriority({
      user: 'depuis-config',
      settings: 'depuis-reglage',
      detected: 'depuis-fournisseur',
    });
    expect(choice.source).toBe('user');
    expect(choice.model).toBe('depuis-config');
  });

  it('le réglage sauvé gagne sur le fournisseur détecté', () => {
    const choice = resolveModelByPriority({
      settings: 'depuis-reglage',
      detected: 'depuis-fournisseur',
    });
    expect(choice.source).toBe('settings');
    expect(choice.model).toBe('depuis-reglage');
  });

  it('ne remplace jamais le modèle demandé par le fournisseur détecté', () => {
    const choice = resolveModelByPriority({ cli: 'modele-demande', detected: 'depuis-fournisseur' });
    expect(choice.model).toBe('modele-demande');
    expect(choice.model).not.toBe('depuis-fournisseur');
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

describe('commande models', () => {
  it('liste la surcharge et montre les capacités réellement lues', () => {
    const configText = `
[model_roles]
primary = "exemple-principal"
[models.exemple-principal]
max_context_tokens = 128000
tools = true
reasoning = true
[models.grok-4]
max_context_tokens = 111111
`;
    const list = renderModelsList({ configText });
    expect(list).toContain('exemple-principal [surcharge] contexte=128000');
    expect(list).toContain('principal: exemple-principal');
    expect(list).not.toContain('fournisseur=');
    const show = renderModelShow('grok-4', { configText });
    expect(show).toContain('contexte: 111111 (configuration)');
    expect(show).not.toContain('fournisseur:');
    expect(show).not.toContain('model_id');
  });

  it('ne déclare pas de sous-commande refresh', () => {
    const names = createModelsCommand().commands.map((command) => command.name());
    expect(names).toEqual(['list', 'show']);
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
