/**
 * V2 — apply_patch must be a REGISTERED, executable tool.
 *
 * WritePolicy.strict (buddy dev default) blocks direct str_replace/create_file
 * writes and points the agent at apply_patch, which the gate always allows. But
 * apply_patch was defined and never registered, so strict mode was an edit
 * DEADLOCK: apply_patch → "Unknown tool", any direct editor → blocked. These
 * tests pin the registration + the deadlock resolution.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTextEditorTools, ApplyPatchExecuteTool } from '../../src/tools/registry/text-editor-tools.js';
import { WritePolicy } from '../../src/security/write-policy.js';

describe('apply_patch registration (V2)', () => {
  it('is included in createTextEditorTools() with a required `patch` param', () => {
    const tools = createTextEditorTools();
    const applyPatch = tools.find((t) => t.name === 'apply_patch');
    expect(applyPatch).toBeDefined();
    const schema = applyPatch!.getSchema!();
    expect(schema.parameters.required).toContain('patch');
  });

  describe('WritePolicy.strict resolves the edit deadlock', () => {
    afterEach(() => WritePolicy.getInstance().setMode('off'));

    it('allows apply_patch but blocks direct str_replace in strict mode', async () => {
      const wp = WritePolicy.getInstance();
      wp.setMode('strict');

      const patchGate = await wp.gate({ toolName: 'apply_patch', paths: ['x.ts'] });
      expect(patchGate.allowed).toBe(true);

      const editGate = await wp.gate({ toolName: 'str_replace_editor', paths: ['x.ts'] });
      expect(editGate.allowed).toBe(false);
      expect(editGate.reason).toMatch(/apply_patch/);
    });
  });

  describe('ApplyPatchExecuteTool applies a real patch', () => {
    let dir: string;
    let prevCwd: string;
    const outsidePaths: string[] = [];
    beforeEach(() => {
      prevCwd = process.cwd();
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-applypatch-'));
      process.chdir(dir);
    });
    afterEach(() => {
      process.chdir(prevCwd);
      fs.rmSync(dir, { recursive: true, force: true });
      for (const outsidePath of outsidePaths.splice(0)) {
        fs.rmSync(outsidePath, { recursive: true, force: true });
      }
    });

    it('adds a new file from a Codex-style patch', async () => {
      const tool = new ApplyPatchExecuteTool();
      const patch = '*** Begin Patch\n*** Add File: hello.txt\n+hello world\n*** End Patch';
      const result = await tool.execute({ patch });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf-8')).toContain('hello world');
    });

    it('rejects an empty patch', async () => {
      const tool = new ApplyPatchExecuteTool();
      const result = await tool.execute({ patch: '' });
      expect(result.success).toBe(false);
    });

    it('preflights every target and rejects lexical workspace escapes atomically', async () => {
      const outsideFile = path.join(path.dirname(dir), `${path.basename(dir)}-escape.txt`);
      outsidePaths.push(outsideFile);
      const tool = new ApplyPatchExecuteTool();
      const patch = [
        '*** Begin Patch',
        '*** Add File: inside.txt',
        '+must not be partially applied',
        `*** Add File: ../${path.basename(outsideFile)}`,
        '+outside',
        '*** End Patch',
      ].join('\n');

      const result = await tool.execute({ patch });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside workspace/i);
      expect(fs.existsSync(path.join(dir, 'inside.txt'))).toBe(false);
      expect(fs.existsSync(outsideFile)).toBe(false);
    });

    it('rejects absolute targets and move destinations outside the workspace', async () => {
      const absoluteTarget = path.join(path.dirname(dir), `${path.basename(dir)}-absolute.txt`);
      const movedTarget = path.join(path.dirname(dir), `${path.basename(dir)}-moved.txt`);
      outsidePaths.push(absoluteTarget, movedTarget);
      fs.writeFileSync(path.join(dir, 'source.txt'), 'before\n');
      const tool = new ApplyPatchExecuteTool();

      const absoluteResult = await tool.execute({
        patch: `*** Begin Patch\n*** Add File: ${absoluteTarget}\n+outside\n*** End Patch`,
      });
      const moveResult = await tool.execute({
        patch: [
          '*** Begin Patch',
          '*** Update File: source.txt',
          `*** Move to: ../${path.basename(movedTarget)}`,
          '@@',
          '-before',
          '+after',
          '*** End Patch',
        ].join('\n'),
      });

      expect(absoluteResult.success).toBe(false);
      expect(moveResult.success).toBe(false);
      expect(fs.existsSync(absoluteTarget)).toBe(false);
      expect(fs.existsSync(movedTarget)).toBe(false);
      expect(fs.readFileSync(path.join(dir, 'source.txt'), 'utf-8')).toBe('before\n');
    });

    it('rejects a missing target below a symlinked parent that escapes the workspace', async () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-applypatch-outside-'));
      outsidePaths.push(outsideDir);
      fs.symlinkSync(outsideDir, path.join(dir, 'escape'), 'dir');
      const tool = new ApplyPatchExecuteTool();
      const patch = '*** Begin Patch\n*** Add File: escape/new.txt\n+outside\n*** End Patch';

      const result = await tool.execute({ patch });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(outsideDir, 'new.txt'))).toBe(false);
    });
  });
});
