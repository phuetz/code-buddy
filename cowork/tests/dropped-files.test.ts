import { describe, expect, it } from 'vitest';
import { resolveDroppedDirectoryPath } from '../src/renderer/utils/dropped-files';

function fileLike(name: string, type = '', size = 0): File {
  return { name, type, size } as File;
}

describe('resolveDroppedDirectoryPath', () => {
  it('uses the browser directory entry when Electron exposes one', async () => {
    const folder = fileLike('project.v1');
    const item = {
      getAsFile: () => folder,
      webkitGetAsEntry: () => ({ isDirectory: true }),
    } as DataTransferItem;

    const result = await resolveDroppedDirectoryPath(
      [folder],
      [item],
      () => 'C:\\work\\project.v1',
      async () => false
    );

    expect(result).toBe('C:\\work\\project.v1');
  });

  it('falls back to the main-process directory check for dotted folder names', async () => {
    const folder = fileLike('client.assets');

    const result = await resolveDroppedDirectoryPath(
      [folder],
      [],
      () => 'C:\\work\\client.assets',
      async (filePath) => filePath.endsWith('client.assets')
    );

    expect(result).toBe('C:\\work\\client.assets');
  });

  it('does not treat extensionless files as folders when stat rejects them', async () => {
    const extensionlessFile = fileLike('README');

    const result = await resolveDroppedDirectoryPath(
      [extensionlessFile],
      [],
      () => 'C:\\work\\README',
      async () => false
    );

    expect(result).toBeNull();
  });
});
