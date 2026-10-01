import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CommentWatcher, resetCommentWatcher } from '../../src/tools/comment-watcher.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('CommentWatcher Isolation and Limits', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-isolation-'));
    resetCommentWatcher();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should not leak triggers to other instances', () => {
    const watcher1 = new CommentWatcher(tmpDir);
    watcher1.addTrigger('ZZZ:', /ZZZ:\s*(.+)/, 'prompt', 3);

    // Add file that matches both triggers
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), '// ZZZ: do something\n// AI: do another thing');

    const watcher2 = new CommentWatcher(tmpDir);

    // Check internal config
    // @ts-expect-error accessing private for test
    const triggers1 = watcher1.config.triggers;
    // @ts-expect-error accessing private for test
    const triggers2 = watcher2.config.triggers;

    expect(triggers1.some((t: any) => t.pattern === 'ZZZ:')).toBe(true);
    expect(triggers2.some((t: any) => t.pattern === 'ZZZ:')).toBe(false);
  });

  it('should not read files larger than 1MB during manualScan', async () => {
    const watcher = new CommentWatcher(tmpDir);
    const largeFile = path.join(tmpDir, 'large.ts');

    // Create a 2MB file
    const mb = 1024 * 1024;
    const content = 'a'.repeat(2 * mb) + '\n// AI: find me in large file';
    fs.writeFileSync(largeFile, content);

    const normalFile = path.join(tmpDir, 'normal.ts');
    fs.writeFileSync(normalFile, '// AI: find me in normal file');

    // Spy on scanFile to see if it's called
    const scanFileSpy = vi.spyOn(watcher, 'scanFile');

    // Make ripgrep fail to fall back to manualScan
    const originalScanProject = watcher.scanProject;
    watcher.scanProject = async function() {
        // Fallback to manual scan directly
        // @ts-expect-error private method
        await this.manualScan();

        // @ts-expect-error private field
        this.detectedComments.sort((a: any, b: any) => b.priority - a.priority);
        // @ts-expect-error private field
        return this.detectedComments;
    };

    await watcher.scanProject();

    // Check that scanFile wasn't called for the large file
    const calledWithLargeFile = scanFileSpy.mock.calls.some(call => call[0] === largeFile);
    expect(calledWithLargeFile).toBe(false);

    // Check that scanFile was called for the normal file
    const calledWithNormalFile = scanFileSpy.mock.calls.some(call => call[0] === normalFile);
    expect(calledWithNormalFile).toBe(true);
  });

  it('stops the fallback after the file limit', async () => {
    const watcher = new CommentWatcher(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'one.ts'), '// AI: first');
    fs.writeFileSync(path.join(tmpDir, 'two.ts'), '// AI: second');
    const scanFileSpy = vi.spyOn(watcher, 'scanFile');

    // @ts-expect-error exercise the private fallback close to its cap
    watcher.scanFileCount = 19_999;
    // @ts-expect-error exercise the private fallback close to its cap
    await watcher.manualScan();

    expect(scanFileSpy).toHaveBeenCalledTimes(1);
  });
});
