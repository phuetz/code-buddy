import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';
import { getWorkspaceIsolation, resetWorkspaceIsolation } from '../../src/workspace/workspace-isolation.js';

// Real filesystem and isolation. Only the human response and the ensureDir
// pause are scripted to provoke the interleaving without a background process.
describe('B1: creation stays within the editor base with review off', () => {
  let root: string;
  let base: string;
  let outside: string;
  let editor: TextEditorTool;
  const allocated: string[] = [];

  beforeEach(() => {
    ConfirmationService.getInstance().resetSession();
    resetWorkspaceIsolation();
    vi.stubEnv('CODEBUDDY_DIFF_REVIEW', 'off');
    vi.stubEnv('CODEBUDDY_SHADOW_WORKSPACE', 'false');
    editor = new TextEditorTool();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    editor.dispose();
    ConfirmationService.getInstance().resetSession();
    resetWorkspaceIsolation();
    for (const p of allocated.splice(0)) fs.rmSync(p, { recursive: true, force: true });
  });

  function configure(location: 'tmp' | 'workspace', destination: 'tmp' | 'workspace'): void {
    const prefix = location === 'tmp' ? join(tmpdir(), 'cb-base-') : resolve('_qa/write-file/base-');
    fs.mkdirSync(resolve('_qa/write-file'), { recursive: true });
    root = fs.mkdtempSync(prefix);
    allocated.push(root);
    base = join(root, 'editor');
    fs.mkdirSync(base);
    outside = destination === 'tmp' ? fs.mkdtempSync(join(tmpdir(), 'cb-outside-base-')) : join(root, 'outside-base');
    if (destination === 'tmp') allocated.push(outside);
    else fs.mkdirSync(outside);
    getWorkspaceIsolation({ enabled: true, workspaceRoot: root });
    editor.setBaseDirectory(base);
    fs.mkdirSync(join(base, 'parent'));
  }

  function replaceParent(): void {
    fs.renameSync(join(base, 'parent'), join(base, 'original-parent'));
    fs.symlinkSync(outside, join(base, 'parent'), 'dir');
  }

  it.each([
    ['tmp', 'tmp'], ['workspace', 'tmp'], ['workspace', 'workspace'],
  ] as const)('rejects a parent swapped during confirmation: base %s, destination %s', async (location, destination) => {
    configure(location, destination);
    const target = join(base, 'parent', 'nested', 'answer.txt');
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async () => {
      replaceParent();
      return { confirmed: true };
    });
    const result = await editor.create(target, 'AGENT\n');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside.*base/i);
    expect(fs.readdirSync(outside)).toEqual([]); // No mkdir, temporary or publication.
    expect(fs.readdirSync(join(base, 'original-parent'))).toEqual([]);
  });

  it('rechecks the physical base after the ensureDir pause', async () => {
    configure('workspace', 'tmp');
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
    const original = UnifiedVfsRouter.Instance.ensureDir.bind(UnifiedVfsRouter.Instance);
    vi.spyOn(UnifiedVfsRouter.Instance, 'ensureDir').mockImplementation(async dir => {
      await original(dir);
      replaceParent();
    });
    const result = await editor.create(join(base, 'parent', 'answer.txt'), 'AGENT\n');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside.*base/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('the direct VFS creator also rejects a whitelisted parent outside its explicit base', async () => {
    configure('workspace', 'tmp');
    replaceParent();
    await expect(UnifiedVfsRouter.Instance.createFile(join(base, 'parent', 'answer.txt'), 'AGENT\n', 'utf8', base))
      .rejects.toThrow(/outside.*base/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('still creates nested files and follows a parent link staying within the base', async () => {
    configure('workspace', 'tmp');
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
    fs.mkdirSync(join(base, 'destination'));
    fs.symlinkSync(join(base, 'destination'), join(base, 'inside-link'), 'dir');
    for (const p of ['parent/nested/answer.txt', 'inside-link/nested/answer.txt']) {
      const result = await editor.create(join(base, p), 'AGENT\n');
      expect(result.success).toBe(true);
      expect(fs.readFileSync(join(base, p), 'utf8')).toBe('AGENT\n');
    }
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});
