import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUDIO_FILE_CHANNELS, registerStudioFilesIpc } from '../src/main/studio/studio-files-ipc';

describe('studio files IPC', () => {
  it('rejects untrusted roots', async () => {
    const trustedRoot = await mkdtemp(path.join(tmpdir(), 'studio-trusted-'));
    const untrustedRoot = await mkdtemp(path.join(tmpdir(), 'studio-untrusted-'));
    await writeFile(path.join(untrustedRoot, 'any.txt'), 'private');
    const handlers = new Map<string, Function>();
    const fakeIpcMain = {
      handle: (channel: string, handler: Function) => handlers.set(channel, handler),
    };
    registerStudioFilesIpc(fakeIpcMain, { trustedRoots: () => [trustedRoot] });

    const readHandler = handlers.get(STUDIO_FILE_CHANNELS.read);
    expect(readHandler).toBeDefined();

    // Devrait échouer car la racine n'est pas dans trustedRoots
    if (readHandler) {
      const result = await readHandler(null, untrustedRoot, 'any.txt');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/project is outside trusted workspaces/i);
    }
  });
});
