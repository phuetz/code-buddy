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
