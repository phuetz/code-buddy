/**
 * GK16 — real-filesystem backup create/verify/list/restore.
 * Temp dirs live under the clone `tmp/` (never shared /tmp, never ~/.codebuddy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleBackup } from '../../src/commands/handlers/backup-handlers.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

describe('GK16 backup create must not announce success with nothing to restore', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('gk16-backup-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it('refuses create when .codebuddy/ only contains skipped folders', async () => {
    fs.mkdirSync(path.join(workspace, '.codebuddy', 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'screenshots', 'shot.png'), 'skip-me');
    const output = path.join(workspace, 'backups');

    const created = await handleBackup(`create --output ${output}`);

    expect(created.exitCode).toBe(1);
    expect(created.response).toMatch(/no files to back up|empty/i);
    expect(created.response ?? '').not.toMatch(/Backup created/i);
    expect(fs.existsSync(output) ? fs.readdirSync(output).filter((name) => name.endsWith('.json')) : []).toEqual(
      [],
    );
  });
});

describe('GK16 backup I/O failures must not crash or pretend to have read the archive', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('gk16-backup-io-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
    fs.mkdirSync(path.join(workspace, '.codebuddy'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'settings.json'), '{"theme":"dark"}\n');
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it('returns a user-facing error when create cannot write the archive (unwritable directory)', async () => {
    const output = path.join(workspace, 'backups');
    fs.mkdirSync(output);
    fs.chmodSync(output, 0o555);
    let thrown: unknown;
    let created: Awaited<ReturnType<typeof handleBackup>> | undefined;
    try {
      created = await handleBackup(`create --output ${output}`);
    } catch (err) {
      thrown = err;
    } finally {
      fs.chmodSync(output, 0o755);
    }

    expect(thrown).toBeUndefined();
    expect(created?.exitCode).toBe(1);
    expect(created?.response).toMatch(/cannot write|permission denied|no space left/i);
    expect(created?.response ?? '').not.toMatch(/Backup created/i);
    expect(created?.response ?? '').not.toMatch(/Unhandled promise rejection/i);
  });

  it('does not report a restore write failure as a read failure', async () => {
    const output = path.join(workspace, 'backups');
    const created = await handleBackup(`create --output ${output}`);
    expect(created.exitCode ?? 0).toBe(0);
    const archive = fs.readdirSync(output).filter((name) => name.endsWith('.json'))[0];
    expect(archive).toBeDefined();
    const archivePath = path.join(output, archive!);

    const dest = path.join(workspace, '.codebuddy', 'settings.json');
    fs.chmodSync(dest, 0o444);

    let thrown: unknown;
    let restored: Awaited<ReturnType<typeof handleBackup>> | undefined;
    try {
      restored = await handleBackup(`restore ${archivePath} --confirm`);
    } catch (err) {
      thrown = err;
    } finally {
      fs.chmodSync(dest, 0o644);
    }

    expect(thrown).toBeUndefined();
    expect(restored?.exitCode).toBe(1);
    expect(restored?.response).toMatch(/cannot write|permission denied|no space left/i);
    expect(restored?.response ?? '').not.toMatch(/Failed to read backup/i);
  });
});
