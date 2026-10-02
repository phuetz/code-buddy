import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getModelToolConfig } from '../../src/config/model-tools.js';
import { toOllamaNativeRequest } from '../../src/codebuddy/providers/ollama-native-transport.js';

const runtime = JSON.parse(fs.readFileSync(new URL('../fixtures/ollama-deepseek-r1-runtime.json', import.meta.url), 'utf8'));
afterEach(() => vi.unstubAllEnvs());

describe('profil R1 du serveur local observé pendant B', () => {
  it('garde les capacités réelles au lieu de supprimer tous les outils', () => {
    const config = getModelToolConfig(runtime.model);
    expect(config.supportsToolCalls).toBe(runtime.capabilities.includes('tools'));
    expect(config.supportsReasoning).toBe(runtime.capabilities.includes('thinking'));
  });

  it('ne force pas la désactivation du raisonnement pour une mission avec outils sans tête', () => {
    vi.stubEnv('CODEBUDDY_HEADLESS', 'true');
    const request = toOllamaNativeRequest({ model: 'qwen3.6:35b-a3b-q4_K_M', messages: [{ role: 'user', content: 'Fix the regression and test it' }],
      tools: [{ type: 'function', function: { name: 'bash', description: 'Shell', parameters: { type: 'object' } } }], max_tokens: 8192 }, 32768);
    expect(request.think).toBeUndefined();
  });
});
