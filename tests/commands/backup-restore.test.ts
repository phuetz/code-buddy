/**
 * Real-filesystem restore: a backup success is only announced after the
 * restored bytes are on disk and re-read with an identical hash.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleBackup } from '../../src/commands/handlers/backup-handlers.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

describe('backup restore writes verified bytes', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('r30-backup-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
    fs.mkdirSync(path.join(workspace, '.codebuddy', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'settings.json'), '{"theme":"dark"}');
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'rules', 'style.md'), '# keep it short\n');
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it('writes restored files to disk and re-reads the same hash before announcing success', async () => {
    const originals = {
      settings: fs.readFileSync(path.join(workspace, '.codebuddy', 'settings.json')),
      style: fs.readFileSync(path.join(workspace, '.codebuddy', 'rules', 'style.md')),
    };
    const originalHashes = {
      settings: createHash('sha256').update(originals.settings).digest('hex'),
      style: createHash('sha256').update(originals.style).digest('hex'),
    };

    const created = await handleBackup(`create --output ${path.join(workspace, 'backups')}`);
    expect(created.handled).toBe(true);
    expect(created.exitCode ?? 0).toBe(0);
    expect(created.response).toContain('Backup created');

    const backupDir = path.join(workspace, 'backups');
    const backupFiles = fs.readdirSync(backupDir).filter((name) => name.endsWith('.json'));
    expect(backupFiles).toHaveLength(1);
    const archivePath = path.join(backupDir, backupFiles[0]!);

    fs.writeFileSync(path.join(workspace, '.codebuddy', 'settings.json'), '{"theme":"wiped"}');
    fs.rmSync(path.join(workspace, '.codebuddy', 'rules'), { recursive: true, force: true });

    const preview = await handleBackup(`restore ${archivePath}`);
    expect(preview.exitCode ?? 0).toBe(0);
    expect(preview.response).toContain('--confirm');
    expect(fs.readFileSync(path.join(workspace, '.codebuddy', 'settings.json'), 'utf8')).toBe(
      '{"theme":"wiped"}',
    );
    expect(fs.existsSync(path.join(workspace, '.codebuddy', 'rules', 'style.md'))).toBe(false);

    const restored = await handleBackup(`restore ${archivePath} --confirm`);
    expect(restored.exitCode ?? 0).toBe(0);
    expect(restored.response).toMatch(/restored/i);
    expect(restored.response).not.toContain('Ready to restore');

    const settingsOnDisk = fs.readFileSync(path.join(workspace, '.codebuddy', 'settings.json'));
    const styleOnDisk = fs.readFileSync(path.join(workspace, '.codebuddy', 'rules', 'style.md'));
    expect(createHash('sha256').update(settingsOnDisk).digest('hex')).toBe(originalHashes.settings);
    expect(createHash('sha256').update(styleOnDisk).digest('hex')).toBe(originalHashes.style);
    expect(settingsOnDisk.toString('utf8')).toBe('{"theme":"dark"}');
    expect(styleOnDisk.toString('utf8')).toBe('# keep it short\n');
  });
});
