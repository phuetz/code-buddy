import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenShellBackend } from '../../src/sandbox/openshell-backend.js';

describe('OpenShellBackend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes remote API errors as output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: vi.fn().mockResolvedValue('backend offline'),
    } as unknown as Response));

    const backend = new OpenShellBackend({
      mode: 'remote',
      apiUrl: 'https://openshell.example',
      apiKey: 'test-key',
    });

    const result = await backend.execute('echo hello');

    expect(result.success).toBe(false);
    expect(result.error).toBe('OpenShell API error 503: backend offline');
    expect(result.output).toBe(result.error);
  });

  it('uses remote execution errors as output when stdout is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        exitCode: 2,
        error: 'remote command failed',
      }),
    } as unknown as Response));

    const backend = new OpenShellBackend({
      mode: 'remote',
      apiUrl: 'https://openshell.example',
      apiKey: 'test-key',
    });

    const result = await backend.execute('bad-command');

    expect(result.success).toBe(false);
    expect(result.error).toBe('remote command failed');
    expect(result.output).toBe('remote command failed');
    expect(result.exitCode).toBe(2);
  });
});
