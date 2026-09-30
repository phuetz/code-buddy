import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistDoctorLocalContextCap } from '../../src/doctor/local-context-cap.js';
import { parseTOML, resetConfigManager } from '../../src/config/toml-config.js';

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
  afterEach(async () => { resetConfigManager(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
  it('caps the selected local tag at 32768 in TOML', async () => {
    expect(persistDoctorLocalContextCap('qwen3.5:4b', 32768)).toBe(32768);
    const saved = parseTOML(await readFile(file, 'utf8'));
    expect(saved.models).toMatchObject({ 'qwen3.5:4b': { provider: 'ollama', max_context_tokens: 32768 } });
  });
  it('preserves a lower user cap and unrelated model settings', async () => {
    await writeFile(file, '[models."qwen3.5:4b"]\nprovider="ollama"\ncontext_window=8192\n[models.other]\nprovider="ollama"\nmax_context_tokens=16384\n');
    expect(persistDoctorLocalContextCap('qwen3.5:4b', 32768)).toBe(8192);
    const saved = parseTOML(await readFile(file, 'utf8'));
    expect(saved.models).toMatchObject({ 'qwen3.5:4b': { max_context_tokens: 8192 }, other: { max_context_tokens: 16384 } });
  });
});
