import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UnifiedDiffEditor } from '../../src/tools/unified-diff-editor';

describe('UnifiedDiffEditor - listBackups with real FS', () => {
  let backupDir: string;
  let tempWorkspace: string;
  let editor: UnifiedDiffEditor;

  beforeEach(() => {
    tempWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diff-editor-workspace-')));
    backupDir = path.join(tempWorkspace, '.backups');
    fs.mkdirSync(backupDir, { recursive: true });
    editor = new UnifiedDiffEditor({
      enableBackups: true,
      backupDir,
    });
  });

  afterEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it('should correctly list backups for files with special characters', async () => {
    const filesToTest = [
      'notes(1).ts',
      'a+b.ts',
      '[id].tsx',
      'c++.cpp'
    ];

    const expectedBackups = new Map<string, string>();

    for (const fileName of filesToTest) {
      const filePath = path.join(tempWorkspace, fileName);
      fs.writeFileSync(filePath, `content of ${fileName}`);

      const diff = {
        filePath: filePath,
        hunks: [{
          oldStart: 1, oldLines: 1,
          newStart: 1, newLines: 1,
          lines: ['-content of ' + fileName, '+new content']
        }]
      };

      await editor.applyDiff(diff);

      const filesInBackupDir = fs.readdirSync(backupDir);
      const backupFile = filesInBackupDir.find(f => f.startsWith(fileName));
      if (backupFile) {
        expectedBackups.set(fileName, path.join(backupDir, backupFile));
      }
    }

    for (const fileName of filesToTest) {
      const filePath = path.join(tempWorkspace, fileName);
      const backups = await editor.listBackups(filePath);

      expect(backups).toHaveLength(1);
      expect(backups[0]).toBe(expectedBackups.get(fileName));
    }
  });

  it('should not confuse plain.ts with plain.ts.old.ts', async () => {
    const filePathPlain = path.join(tempWorkspace, 'plain.ts');
    const filePathPlainOld = path.join(tempWorkspace, 'plain.ts.old.ts');

    fs.writeFileSync(filePathPlain, 'plain content');
    fs.writeFileSync(filePathPlainOld, 'plain old content');

    await editor.applyDiff({
      filePath: filePathPlain,
      hunks: [{
        oldStart: 1, oldLines: 1,
        newStart: 1, newLines: 1,
        lines: ['-plain content', '+new plain']
      }]
    });

    await editor.applyDiff({
      filePath: filePathPlainOld,
      hunks: [{
        oldStart: 1, oldLines: 1,
        newStart: 1, newLines: 1,
        lines: ['-plain old content', '+new plain old']
      }]
    });

    const plainBackups = await editor.listBackups(filePathPlain);
    const plainOldBackups = await editor.listBackups(filePathPlainOld);

    expect(plainBackups).toHaveLength(1);
    expect(plainOldBackups).toHaveLength(1);

    expect(path.basename(plainBackups[0])).toMatch(/^plain\.ts\.[^.]+\.bak$/);
    expect(path.basename(plainOldBackups[0])).toMatch(/^plain\.ts\.old\.ts\.[^.]+\.bak$/);

    expect(plainBackups[0]).not.toEqual(plainOldBackups[0]);
  });
});
