import { beforeEach, describe, expect, it, vi } from 'vitest';
const selected = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../../src/server/provider-resolution.js', () => ({ resolveServerProvider: selected.resolve }));
vi.mock('../../src/utils/provider-detector.js', () => ({ detectProviderFromEnv: vi.fn(() => null) }));
import { listServerModels, resolveServerAgentConfig } from '../../src/server/agent-adapter.js';

describe('HTTP agent uses the saved provider', () => {
  beforeEach(() => {
    selected.resolve.mockReturnValue({ provider: 'ollama', apiKey: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', model: 'qa-saved-local' });
  });
  it.each([1, 2, 3, 4, 5])('uses the saved local target without an ambient key, replay %i', () => {
    expect(resolveServerAgentConfig()).toEqual({ apiKey: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', model: 'qa-saved-local' });
  });
  it('advertises the same configured model that handles requests', () => {
    expect(listServerModels()).toEqual([{ id: 'qa-saved-local', object: 'model', created: expect.any(Number), owned_by: 'ollama' }]);
  });
});
