import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHeadlessErrorEnvelope } from '../../src/cli/headless-options.js';

const canSpawnCli = !spawnSync(process.execPath, ['--version'], { encoding: 'utf8' }).error;

function runHeadless(args: string[]) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-headless-error-'));
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home };
    for (const key of [
      'GROK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
      'GOOGLE_API_KEY', 'CODEBUDDY_PROVIDER', 'OLLAMA_HOST', 'VLLM_BASE_URL',
    ]) delete env[key];
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts', ...args],
      { cwd: process.cwd(), env, input: '', encoding: 'utf8', timeout: 30_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe('Headless error envelope', () => {
  it('builds the expected JSON structure', () => {
    expect(buildHeadlessErrorEnvelope('failure', 'test-model')).toEqual({
      error: 'failure', result: null, cost: { total: 0 }, model: 'test-model',
    });
  });

  it.skipIf(!canSpawnCli)('writes JSON to stdout when no provider is configured', () => {
    const result = runHeadless(['-p', 'hi', '-o', 'json']);
    expect(result.error).toContain('No AI provider configured');
    expect(result.result).toBeNull();
    expect(result.cost).toEqual({ total: 0 });
  });

  it.skipIf(!canSpawnCli)('writes JSON to stdout when an unknown agent is requested', () => {
    const result = runHeadless([
      '-p', 'hi', '-k', 'sk-test', '-u', 'http://127.0.0.1:9',
      '--agent', 'unknown-test-agent', '-o', 'json',
    ]);
    expect(result.error).toContain('Agent not found');
    expect(result.result).toBeNull();
    expect(result.cost).toEqual({ total: 0 });
  });
});
