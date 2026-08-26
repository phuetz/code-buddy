import * as path from 'path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildOllamaUpdatePlan,
  fetchOllamaStatus,
  normalizeOllamaBaseUrl,
} from '../../src/commands/ollama.js';

describe('ollama command helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes Ollama base URLs', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434');
    expect(normalizeOllamaBaseUrl('http://darkstar.tailnet.ts.net:11434')).toBe('http://darkstar.tailnet.ts.net:11434');
  });

  it('builds a Windows update plan that points at the repo script', () => {
    const plan = buildOllamaUpdatePlan({
      platform: 'win32',
      repoRoot: '/repo',
      scriptUrl: 'https://ollama.com/install.ps1',
    });

    // The plan resolves paths on the HOST (drive letter + backslashes when the
    // test itself runs on Windows), whatever the requested target platform.
    const repoRoot = path.resolve('/repo');
    const scriptPath = path.join(repoRoot, 'scripts', 'update-ollama-windows.ps1');
    expect(plan).toMatchObject({
      supported: true,
      platform: 'win32',
      repoRoot,
      scriptPath,
      command: 'powershell',
    });
    expect(plan.args).toEqual([
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-InstallerScriptUrl',
      'https://ollama.com/install.ps1',
    ]);
  });

  it('marks non-Windows updates as unsupported', () => {
    const plan = buildOllamaUpdatePlan({
      platform: 'linux',
      repoRoot: '/repo',
    });

    expect(plan.supported).toBe(false);
    expect(plan.command).toBeUndefined();
    expect(plan.message).toContain('Windows');
  });

  it('fetches Ollama version and models from the local API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/version')) {
        return new Response(JSON.stringify({ version: '0.30.0' }), { status: 200 });
      }
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'phi4:latest' },
            { name: 'gemma4:26b-a4b-it-qat' },
          ],
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));

    const status = await fetchOllamaStatus('http://darkstar.tail2a752c.ts.net:11434/v1');

    expect(status).toMatchObject({
      baseUrl: 'http://darkstar.tail2a752c.ts.net:11434',
      reachable: true,
      version: '0.30.0',
      models: ['phi4:latest', 'gemma4:26b-a4b-it-qat'],
      error: null,
    });
  });
});
