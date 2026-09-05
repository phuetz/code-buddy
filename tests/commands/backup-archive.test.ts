import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handleBackup } from '../../src/commands/handlers/backup-handlers.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('R17 backup archive', () => {
  it('writes payload bytes, verifies them, and lists a custom output directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-r17-backup-'));
    roots.push(root);
    const previousCwd = process.cwd();
    const source = path.join(root, '.codebuddy');
    const output = path.join(root, 'backups');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'settings.json'), '{"r17":true}\n', 'utf8');
    process.chdir(root);

    try {
      const created = await handleBackup(`create --only-config --output ${output}`);
      expect(created.exitCode).toBeUndefined();
      const archivePath = created.response?.match(/^Backup created: (.+)$/mu)?.[1];
      expect(archivePath).toBeDefined();

      const archive = JSON.parse(fs.readFileSync(archivePath!, 'utf8')) as {
        fileCount: number;
        files: Array<{ content: string; path: string }>;
        totalSize: number;
      };
      expect(archive.fileCount).toBe(1);
      expect(archive.totalSize).toBeGreaterThan(0);
      expect(archive.files).toEqual([
        expect.objectContaining({ path: 'settings.json', content: expect.any(String) }),
      ]);

      const verified = await handleBackup(`verify ${archivePath}`);
      expect(verified.exitCode).toBeUndefined();
      expect(verified.response).toContain('Backup valid');

      const listed = await handleBackup(`list --output ${output}`);
      expect(listed.response).toContain(output);
      expect(listed.response).toContain(path.basename(archivePath!));
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('rejects an archive whose manifest has no payload files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-r17-empty-backup-'));
    roots.push(root);
    const archivePath = path.join(root, 'empty.json');
    fs.writeFileSync(archivePath, JSON.stringify({
      manifest: {
        version: '1.0.0',
        createdAt: '2026-09-02T00:00:00Z',
        files: [],
        flags: { onlyConfig: false, includeWorkspace: true },
      },
      fileCount: 0,
      files: [],
      totalSize: 0,
    }), 'utf8');

    const result = await handleBackup(`verify ${archivePath}`);
    expect(result.exitCode).toBe(1);
    expect(result.response).toContain('empty');
  });
});
