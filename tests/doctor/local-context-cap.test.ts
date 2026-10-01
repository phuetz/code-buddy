import { primeLocalRuntimeModelConfig, resetLocalRuntimeContextProbeCache } from '../../src/config/local-runtime-context.js';
import { getModelToolConfig, resetRuntimeModelContextCache } from '../../src/config/model-tools.js';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '@iarna/toml';
import { parseCatalogueConfig } from '../../src/config/model-catalogue.js';
import { resolveOllamaNumCtx } from '../../src/codebuddy/providers/ollama-native-transport.js';
import { persistDoctorLocalContextCap, readDoctorLocalContextCap } from '../../src/doctor/local-context-cap.js';
import { resetConfigManager } from '../../src/config/toml-config.js';

describe('doctor persists a model-specific context cap', () => {
  let root: string;
  let file: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'doctor-context-cap-'));
    file = join(root, 'config.toml');
    vi.stubEnv('CODEBUDDY_CONFIG', file);
    await writeFile(file, '# existing user settings\n[models."qwen3.5:4b"]\nprovider = "ollama"\nmax_context_tokens = 262144\n');
    resetConfigManager();
  });
  afterEach(async () => { resetLocalRuntimeContextProbeCache(); resetRuntimeModelContextCache(); resetConfigManager(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
  it('caps the selected local tag at 32768 in TOML', async () => {
    expect(persistDoctorLocalContextCap('qwen3.5:4b', 32768)).toBe(32768);
    const saved = parse(await readFile(file, 'utf8'));
    expect(saved.models).toMatchObject({ 'qwen3.5:4b': { provider: 'ollama', max_context_tokens: 32768 } });
    expect(readDoctorLocalContextCap('qwen3.5:4b')).toBe(32768);
    expect(() => parseCatalogueConfig(readFileSync(file, 'utf8'))).not.toThrow();
    expect(resolveOllamaNumCtx('qwen3.5:4b')).toBe(32768);
  });
  it('keeps the capped prompt window after discovering larger Ollama metadata', async () => {
    persistDoctorLocalContextCap('qwen3.5:4b', 8192);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(
      String(url).endsWith('/api/show') ? { model_info: { 'qwen.context_length': 262144 } } : { models: [] },
    ))) as unknown as typeof fetch;
    const info = await primeLocalRuntimeModelConfig({ model: 'qwen3.5:4b', baseURL: 'http://127.0.0.1:11434/v1', fetchImpl });
    expect(info?.contextWindow).toBe(8192);
    expect(getModelToolConfig('qwen3.5:4b').contextWindow).toBe(8192);
    expect(resolveOllamaNumCtx('qwen3.5:4b')).toBe(8192);
  });
  it('preserves a lower user cap and unrelated model settings', async () => {
    await writeFile(file, '[models."qwen3.5:4b"]\nprovider="ollama"\ncontext_window=8192\n[models.other]\nprovider="ollama"\nmax_context_tokens=16384\n');
    expect(persistDoctorLocalContextCap('qwen3.5:4b', 32768)).toBe(8192);
    const saved = parse(await readFile(file, 'utf8'));
    expect(saved.models).toMatchObject({ 'qwen3.5:4b': { max_context_tokens: 8192 }, other: { max_context_tokens: 16384 } });
    expect(resolveOllamaNumCtx('qwen3.5:4b')).toBe(8192);
  });
});
