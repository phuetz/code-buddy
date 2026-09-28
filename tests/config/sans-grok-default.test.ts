import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function managerInTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sans-grok-'));
  temporary.push(directory);
  const userSettingsPath = path.join(directory, 'user-settings.json');
  const projectSettingsPath = path.join(directory, 'settings.json');
  const { SettingsManager } = await import('../../src/utils/settings-manager.js');
  (SettingsManager as unknown as { instance?: SettingsManager }).instance = undefined;
  const manager = SettingsManager.getInstance({ userSettingsPath, projectSettingsPath });
  return { manager, userSettingsPath, projectSettingsPath };
}

describe('unselected model migration', () => {
  it('leaves a new profile absent and resolves no model without a provider', async () => {
    const { manager, userSettingsPath } = await managerInTemporaryDirectory();
    expect(manager.loadUserSettings()).toEqual({});
    expect(fs.existsSync(userSettingsPath)).toBe(false);
  });

  it('ignores the exact old generated Grok pair without changing the file', async () => {
    const { manager, userSettingsPath } = await managerInTemporaryDirectory();
    const old = JSON.stringify({
      baseURL: 'https://api.x.ai/v1',
      defaultModel: 'grok-code-fast-1',
      models: ['grok-code-fast-1', 'grok-4-latest', 'grok-3-latest', 'grok-3-fast', 'grok-3-mini-fast'],
    });
    fs.writeFileSync(userSettingsPath, old);
    const loaded = manager.loadUserSettings();
    expect(loaded.defaultModel).toBeUndefined();
    expect(loaded.models).toBeUndefined();
    expect(loaded.baseURL).toBeUndefined();
    const { resetConfigResolver } = await import('../../src/config/config-resolver.js');
    resetConfigResolver();
    const resolved = manager.getResolvedConfig();
    expect(resolved.provider).not.toBe('grok');
    expect(resolved.model).not.toBe('grok-code-fast-1');
    expect(fs.readFileSync(userSettingsPath, 'utf8')).toBe(old);
  });

  it('keeps an explicitly selected xAI profile usable without rewriting settings', async () => {
    const { manager, userSettingsPath } = await managerInTemporaryDirectory();
    const chosen = JSON.stringify({ provider: 'grok', apiKey: 'xai-key', model: 'grok-4-latest' });
    fs.writeFileSync(userSettingsPath, chosen);
    const { resetConfigResolver } = await import('../../src/config/config-resolver.js');
    resetConfigResolver();
    expect(manager.getResolvedConfig()).toMatchObject({
      provider: 'grok', model: 'grok-4-latest', baseURL: 'https://api.x.ai/v1', apiKey: 'xai-key',
    });
    expect(fs.readFileSync(userSettingsPath, 'utf8')).toBe(chosen);
  });

  it('respects a Grok model explicitly chosen with a different list', async () => {
    const { manager, userSettingsPath } = await managerInTemporaryDirectory();
    fs.writeFileSync(userSettingsPath, JSON.stringify({
      defaultModel: 'grok-code-fast-1', models: ['grok-code-fast-1'],
    }));
    expect(manager.loadUserSettings().defaultModel).toBe('grok-code-fast-1');
  });

  it('ignores an exact project scaffold while preserving an explicit project model', async () => {
    const { manager, projectSettingsPath } = await managerInTemporaryDirectory();
    const scaffold = JSON.stringify({ model: 'grok-code-fast-1', maxToolRounds: 50, theme: 'default' });
    fs.writeFileSync(projectSettingsPath, scaffold);
    expect(manager.loadProjectSettings().model).toBeUndefined();
    expect(fs.readFileSync(projectSettingsPath, 'utf8')).toBe(scaffold);
    fs.writeFileSync(projectSettingsPath, JSON.stringify({ model: 'grok-code-fast-1', theme: 'custom' }));
    expect(manager.loadProjectSettings().model).toBe('grok-code-fast-1');
  });
});

describe('provider resolution', () => {
  it('probes xAI with an xAI model even when a generic model is configured', async () => {
    const { xaiProbeModel } = await import('../../src/config/legacy-env.js');
    expect(xaiProbeModel({ CODEBUDDY_MODEL: 'gpt-4o' })).toBe('grok-3');
    expect(xaiProbeModel({ XAI_MODEL: 'grok-4-1-fast' })).toBe('grok-4-1-fast');
  });
  it('prioritizes an authenticated ChatGPT session over configured providers', async () => {
    const { resolveProviderFromCatalog } = await import('../../src/providers/provider-catalog.js');
    const found = resolveProviderFromCatalog({
      hasChatGptOAuth: true,
      env: { CODEBUDDY_API_KEY: 'custom', CODEBUDDY_BASE_URL: 'https://custom.example/v1' },
    });
    expect(found).toMatchObject({ provider: 'chatgpt', apiKey: 'oauth-chatgpt', defaultModel: 'gpt-6-sol' });
  });

  it('uses a configured provider before an ambient local endpoint', async () => {
    const { resolveProviderFromCatalog } = await import('../../src/providers/provider-catalog.js');
    expect(resolveProviderFromCatalog({ env: {
      OLLAMA_HOST: 'http://localhost:11434',
      CODEBUDDY_API_KEY: 'custom', CODEBUDDY_BASE_URL: 'https://custom.example/v1',
    } })?.provider).toBe('custom');
  });

  it('selects the installed tool-capable Ollama model when there is no provider', async () => {
    const { resolveProviderFromCatalog } = await import('../../src/providers/provider-catalog.js');
    const { detectZeroConfigLocal } = await import('../../src/cli/zero-config.js');
    expect(resolveProviderFromCatalog({ env: {} })).toBeNull();
    const result = await detectZeroConfigLocal({
      freeMemoryBytes: () => 64 * 1024 ** 3,
      probeOllama: async () => ({
        id: 'ollama', label: 'Ollama', kind: 'local', free: true, detail: 'running',
        available: true, baseURL: 'http://localhost:11434/v1',
        models: ['qwen3:8b'], modelDetails: [{ name: 'qwen3:8b', sizeBytes: 5 * 1024 ** 3 }],
      }),
    });
    expect(result).toMatchObject({ kind: 'ollama', model: 'qwen3:8b' });
  });

  it('reports no provider when Ollama is unavailable', async () => {
    const { resolveProviderFromCatalog } = await import('../../src/providers/provider-catalog.js');
    const { detectZeroConfigLocal, buildNoProviderGuidance } = await import('../../src/cli/zero-config.js');
    expect(resolveProviderFromCatalog({ env: {} })).toBeNull();
    const result = await detectZeroConfigLocal({ probeOllama: async () => ({
      id: 'ollama', label: 'Ollama', kind: 'local', free: true, detail: 'unavailable', available: false,
    }) });
    expect(result.kind).toBe('none');
    expect(buildNoProviderGuidance(result)).toContain('buddy login');
  });

  it('accepts legacy aliases with a single process warning and neutral precedence', async () => {
    vi.resetModules();
    const { logger } = await import('../../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { resolveProviderFromCatalog } = await import('../../src/providers/provider-catalog.js');
    const legacy = {
      GROK_API_KEY: 'old-key', GROK_BASE_URL: 'https://api.x.ai/v1', GROK_MODEL: 'grok-4-latest',
    };
    expect(resolveProviderFromCatalog({ env: legacy })).toMatchObject({
      provider: 'grok', apiKey: 'old-key', defaultModel: 'grok-4-latest',
    });
    expect(resolveProviderFromCatalog({ env: legacy })?.provider).toBe('grok');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(resolveProviderFromCatalog({ env: { ...legacy, XAI_MODEL: 'grok-4-1-fast' } })?.defaultModel)
      .toBe('grok-4-1-fast');
    expect(resolveProviderFromCatalog({ env: {
      ...legacy, CODEBUDDY_API_KEY: 'new-key', CODEBUDDY_BASE_URL: 'https://custom.example/v1', CODEBUDDY_MODEL: 'new-model',
    } })).toMatchObject({
      provider: 'custom', apiKey: 'new-key', baseURL: 'https://custom.example/v1', defaultModel: 'new-model',
    });
    warn.mockRestore();
  });
});
