/**
 * GK16 — real-filesystem backup create/verify/list/restore.
 * Temp dirs live under the clone `tmp/` (never shared /tmp, never ~/.codebuddy).
 */
import { createHash } from 'node:crypto';
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

describe('GK16 verify must not call an unrestorable archive valid', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('gk16-backup-verify-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
    fs.mkdirSync(path.join(workspace, '.codebuddy'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it.each([
    '/etc/passwd',
    '../victim-outside.txt',
    '..\\..\\etc\\x',
  ])('rejects verify for archive path %s', async (archivePath) => {
    const payload = Buffer.from('pwned');
    const checksum = createHash('sha256').update(payload).digest('hex').slice(0, 16);
    const file = path.join(workspace, 'evil.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        manifest: {
          version: '1.0.0',
          createdAt: '2026-01-01T00:00:00.000Z',
          files: [{ path: archivePath, size: payload.length, checksum }],
          flags: { onlyConfig: false, includeWorkspace: true },
        },
        files: [{ path: archivePath, content: payload.toString('base64') }],
      }),
    );

    const verified = await handleBackup(`verify ${file}`);
    expect(verified.exitCode).toBe(1);
    expect(verified.response).toMatch(/escapes destination|\.\.|not a valid restore path/i);
    expect(verified.response ?? '').not.toMatch(/Backup valid/i);

    const restored = await handleBackup(`restore ${file} --confirm`);
    expect(restored.exitCode).toBe(1);
  });
});

describe('GK16 create must not follow source symlinks out of .codebuddy/', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('gk16-backup-symlink-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it('skips a symlink pointing outside the project instead of packing the target bytes', async () => {
    const outside = path.join(workspace, 'outside-secret.txt');
    fs.writeFileSync(outside, 'SECRET_OUTSIDE\n');
    fs.mkdirSync(path.join(workspace, '.codebuddy'), { recursive: true });
    fs.symlinkSync(outside, path.join(workspace, '.codebuddy', 'settings.json'));
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'hooks.json'), '{"hooks":[]}\n');
    const output = path.join(workspace, 'backups');

    const created = await handleBackup(`create --output ${output}`);
    expect(created.exitCode ?? 0).toBe(0);
    expect(created.response).toMatch(/symbolic link|skipped/i);
    expect(created.response).toContain('hooks.json');

    const archives = fs.readdirSync(output).filter((name) => name.endsWith('.json'));
    expect(archives).toHaveLength(1);
    const archive = JSON.parse(fs.readFileSync(path.join(output, archives[0]!), 'utf8')) as {
      files: Array<{ path: string; content: string }>;
    };
    expect(archive.files.map((file) => file.path)).toEqual(['hooks.json']);
    expect(archive.files.some((file) => Buffer.from(file.content, 'base64').toString().includes('SECRET_OUTSIDE'))).toBe(
      false,
    );
  });
});

describe('GK16 create must not silently drop files larger than 1 MB', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('gk16-backup-large-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
    fs.mkdirSync(path.join(workspace, '.codebuddy'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'settings.json'), '{"ok":true}\n');
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it('reports a skipped file larger than 1 MB instead of omitting it quietly', async () => {
    fs.writeFileSync(
      path.join(workspace, '.codebuddy', 'session-big.json'),
      Buffer.alloc(1024 * 1024 + 1, 0x78),
    );
    const output = path.join(workspace, 'backups');

    const created = await handleBackup(`create --output ${output}`);
    expect(created.exitCode ?? 0).toBe(0);
    expect(created.response).toMatch(/skipped/i);
    expect(created.response).toMatch(/session-big\.json/);
    expect(created.response).toMatch(/1 MB/i);

    const archives = fs.readdirSync(output).filter((name) => name.endsWith('.json'));
    const archive = JSON.parse(fs.readFileSync(path.join(output, archives[0]!), 'utf8')) as {
      files: Array<{ path: string }>;
    };
    expect(archive.files.map((file) => file.path)).toEqual(['settings.json']);
  });
});

describe('GK16 restore into a non-empty profile is an explicit merge', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('gk16-backup-merge-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
    fs.mkdirSync(path.join(workspace, '.codebuddy'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'settings.json'), '{"theme":"dark"}\n');
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it('names extra files that will be left in place instead of implying a full replace', async () => {
    const output = path.join(workspace, 'backups');
    const created = await handleBackup(`create --output ${output}`);
    expect(created.exitCode ?? 0).toBe(0);
    const archive = path.join(output, fs.readdirSync(output).filter((name) => name.endsWith('.json'))[0]!);

    fs.writeFileSync(path.join(workspace, '.codebuddy', 'settings.json'), '{"theme":"wiped"}\n');
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'extra-not-in-archive.md'), 'I should survive merge\n');

    const preview = await handleBackup(`restore ${archive}`);
    expect(preview.exitCode ?? 0).toBe(0);
    expect(preview.response).toMatch(/leave|left in place|merge|not in the archive/i);
    expect(preview.response).toContain('extra-not-in-archive.md');

    const restored = await handleBackup(`restore ${archive} --confirm`);
    expect(restored.exitCode ?? 0).toBe(0);
    expect(restored.response).toMatch(/left in place|merged/i);
    expect(restored.response).toContain('extra-not-in-archive.md');
    expect(fs.readFileSync(path.join(workspace, '.codebuddy', 'extra-not-in-archive.md'), 'utf8')).toBe(
      'I should survive merge\n',
    );
    expect(fs.readFileSync(path.join(workspace, '.codebuddy', 'settings.json'), 'utf8')).toBe('{"theme":"dark"}\n');
  });
});

describe('GK16 backup size and unreadable archives are honest', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('gk16-backup-ux-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
    fs.mkdirSync(path.join(workspace, '.codebuddy'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.codebuddy', 'settings.json'), '{"ok":true}\n');
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it('says create archives the current project .codebuddy, not the home profile', async () => {
    const created = await handleBackup(`create --output ${path.join(workspace, 'backups')}`);
    expect(created.exitCode ?? 0).toBe(0);
    expect(created.response).toMatch(/current project/i);
    expect(created.response).toContain(path.join(workspace, '.codebuddy'));
    expect(created.response ?? '').not.toMatch(/home profile/i);
  });

  it('reports create size in bytes when the payload is under 1 KB', async () => {
    const created = await handleBackup(`create --output ${path.join(workspace, 'backups')}`);
    expect(created.exitCode ?? 0).toBe(0);
    expect(created.response).toMatch(/Size: \d+ B\b/);
    expect(created.response ?? '').not.toMatch(/Size: 0 KB/);
  });

  it('describes a truncated file as an unreadable backup, not a raw JSON parse error', async () => {
    const file = path.join(workspace, 'truncated.json');
    fs.writeFileSync(file, '{"manifest":{"version":"1.0.0",');
    const verified = await handleBackup(`verify ${file}`);
    expect(verified.exitCode).toBe(1);
    expect(verified.response).toMatch(/not a readable Code Buddy backup|truncated/i);
    expect(verified.response ?? '').not.toMatch(/Unterminated string in JSON/i);

    const restored = await handleBackup(`restore ${file} --confirm`);
    expect(restored.exitCode).toBe(1);
    expect(restored.response).toMatch(/not a readable Code Buddy backup|truncated/i);
    expect(restored.response ?? '').not.toMatch(/Failed to read backup/i);
  });

  it('rejects an older backup format with an explicit version error', async () => {
    const file = path.join(workspace, 'old-v0.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        manifest: {
          version: '0.9.0',
          createdAt: '2025-06-01T00:00:00Z',
          files: [{ path: 'settings.json', size: 11, checksum: 'deadbeefdeadbeef' }],
          flags: { onlyConfig: true, includeWorkspace: false },
        },
        files: [{ path: 'settings.json', content: Buffer.from('{"old":true}\n').toString('base64') }],
      }),
    );
    const verified = await handleBackup(`verify ${file}`);
    expect(verified.exitCode).toBe(1);
    expect(verified.response).toMatch(/unsupported backup format|version 1/i);
    expect(verified.response ?? '').not.toMatch(/Backup valid/i);
  });
});
