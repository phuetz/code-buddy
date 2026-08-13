import { describe, expect, it, vi } from 'vitest';

const configMocks = vi.hoisted(() => {
  const runtimeConfig = {
    active_model: 'profile-runtime',
    providers: {
      runtime: {
        base_url: 'http://127.0.0.1:1234/v1',
        api_key_env: 'RUNTIME_KEY',
        type: 'custom',
        enabled: true,
      },
    },
    models: {
      'profile-runtime': {
        provider: 'runtime',
        model_id: 'runtime/profile-model',
        price_per_m_input: 0,
        price_per_m_output: 0,
        max_context_tokens: 32_000,
      },
    },
    tool_config: {},
    middleware: {},
    ui: {},
    agent: {},
    integrations: {},
    task_models: { review: 'runtime/profile-model' },
  };
  return {
    getConfig: vi.fn(() => runtimeConfig),
    reload: vi.fn(() => {
      throw new Error('a read must not reload global config');
    }),
  };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => `/tmp/codebuddy-task-models-no-file-${process.pid}`,
  };
});

vi.mock('../../src/config/toml-config.js', () => ({
  DEFAULT_CONFIG: {
    active_model: 'default-model',
    providers: {},
    models: {},
    tool_config: {},
    middleware: {},
    ui: {},
    agent: {},
    integrations: {},
  },
  getConfigManager: () => configMocks,
  parseTOML: vi.fn(),
}));

import { readTaskModelSettings } from '../../src/config/task-models.js';

describe('readTaskModelSettings runtime state', () => {
  it('reads the current profile without reloading the global singleton', () => {
    const settings = readTaskModelSettings();

    expect(configMocks.getConfig).toHaveBeenCalledOnce();
    expect(configMocks.reload).not.toHaveBeenCalled();
    expect(settings.defaultModel).toBe('runtime/profile-model');
    expect(settings.effectiveMappings).toEqual({ review: 'runtime/profile-model' });
    expect(settings.models).toEqual([
      expect.objectContaining({ id: 'runtime/profile-model', key: 'profile-runtime' }),
    ]);
  });
});
