// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({ ipcMain: { handle: electronMock.handle } }));
vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (relativePath: string) => {
    if (relativePath === 'config/task-models.js') {
      return vi.importActual('../../src/config/task-models.js');
    }
    return null;
  }),
}));
const loggerMock = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../src/main/utils/logger', () => ({
  logError: loggerMock.error,
  log: vi.fn(),
  logWarn: vi.fn(),
}));

import { registerTaskModelsIpcHandlers } from '../src/main/ipc/task-models-ipc';

let directory: string;
let configPath: string;

function call(channel: string, ...args: unknown[]): unknown {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler({}, ...args);
}

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.handle.mockClear();
  loggerMock.error.mockClear();
  directory = mkdtempSync(join(tmpdir(), 'cowork-task-models-'));
  configPath = join(directory, 'config.toml');
  writeFileSync(configPath, [
    'active_model = "local-fast"',
    '',
    '[providers.local]',
    'api_key_env = "LOCAL_KEY"',
    'type = "custom"',
    'enabled = true',
    '',
    '[models.local-fast]',
    'provider = "local"',
    'model_id = "local/fast-v2"',
    'price_per_m_input = 0',
    'price_per_m_output = 0',
    'max_context_tokens = 100000',
    '',
    '[model_pairs]',
    'architect = "legacy-thinker"',
    'editor = "legacy-editor"',
    '',
    '[profiles.keep-me]',
    'active_model = "profile-model"',
    '',
  ].join('\n'));
  registerTaskModelsIpcHandlers();
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('task models IPC', () => {
  it('registers a namespaced, never-throw get/save surface', () => {
    expect([...electronMock.handlers.keys()].sort()).toEqual([
      'taskModels.get',
      'taskModels.save',
    ]);
  });

  it('loads active models and reports dormant legacy mappings separately', async () => {
    const result = await call('taskModels.get', { configPath }) as {
      ok: boolean;
      settings: {
        legacyMappings: Record<string, string>;
        models: Array<{ id: string }>;
      };
    };

    expect(result.ok).toBe(true);
    expect(result.settings.legacyMappings).toEqual({
      architect: 'legacy-thinker',
      edit: 'legacy-editor',
    });
    expect(result.settings.models.some((model) => model.id === 'local/fast-v2')).toBe(true);
  });

  it('saves through the core while preserving unrelated TOML sections', async () => {
    const result = await call(
      'taskModels.save',
      { review: 'local-fast', research: 'local/fast-v2' },
      { configPath },
    ) as { ok: boolean; settings: { mappings: Record<string, string> } };

    expect(result.ok).toBe(true);
    expect(result.settings.mappings).toEqual({
      review: 'local/fast-v2',
      research: 'local/fast-v2',
    });
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain('[task_models]');
    expect(content).toContain('[model_pairs]');
    expect(content).toContain('[profiles.keep-me]');
  });

  it('returns a clean error instead of throwing on an inactive model', async () => {
    const result = await call(
      'taskModels.save',
      { review: 'not-active' },
      { configPath },
    ) as { ok: boolean; error?: string; settings: unknown };

    expect(result).toMatchObject({
      ok: false,
      settings: null,
    });
    expect(result.error).toContain('model is not active');
    expect(loggerMock.error).toHaveBeenCalledOnce();
  });
});
