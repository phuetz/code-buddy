import { afterEach, describe, expect, it, vi } from 'vitest';
import { LSPClient, type LSPDiagnostic } from '../../src/lsp/lsp-client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function diagnosticClient() {
  const client = new LSPClient();
  const diagnostics = new Map<string, LSPDiagnostic[]>();
  const internals = client as unknown as {
    ensureServer: () => Promise<{ diagnostics: typeof diagnostics }>;
    openDocument: () => Promise<void>;
  };
  vi.spyOn(internals, 'ensureServer').mockResolvedValue({ diagnostics });
  vi.spyOn(internals, 'openDocument').mockResolvedValue(undefined);
  return { client, diagnostics };
}

describe('LSP diagnostic publication', () => {
  it('waits for a publication arriving after the old two-second delay', async () => {
    vi.useFakeTimers();
    const { client, diagnostics } = diagnosticClient();
    const path = await import('node:path');
    const file = path.resolve('late.ts');
    const expected: LSPDiagnostic[] = [{ file, line: 1, column: 1, severity: 'error', message: 'Delayed type error' }];
    const result = client.getDiagnostics(file);
    await vi.advanceTimersByTimeAsync(2100);
    diagnostics.set(file, expected);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual(expected);
  });

  it('fails when the server never publishes instead of returning a clean result', async () => {
    vi.useFakeTimers();
    const { client } = diagnosticClient();
    const result = client.getDiagnostics('missing-publication.ts');
    const assertion = expect(result).rejects.toThrow('No diagnostics received');
    await vi.advanceTimersByTimeAsync(5100);
    await assertion;
  });
});
