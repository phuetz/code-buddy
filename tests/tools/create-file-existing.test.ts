import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CreateFileTool, StrReplaceEditorTool, ViewFileTool, resetTextEditorInstance } from '../../src/tools/registry/text-editor-tools.js';
import { createAliasTools } from '../../src/tools/registry/tool-aliases.js';
import { WritePolicy } from '../../src/security/write-policy.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

describe('existing-file recovery uses the exposed tool names (B5)', () => {
  let cwd: string;
  const original = 'const answer = 1;\n';
  const replacement = 'const answer = 42;\n';

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'cb-existing-'));
    writeFileSync(join(cwd, 'answer.ts'), original);
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
  });

  afterEach(() => {
    resetTextEditorInstance();
    ConfirmationService.getInstance().resetSession();
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function tools() {
    const primary = [new CreateFileTool(), new StrReplaceEditorTool(), new ViewFileTool()];
    return [...primary, ...createAliasTools(primary)];
  }

  it.each([
    ['write_file', 'patch', 'read_file'],
    ['create_file', 'str_replace_editor', 'view_file'],
    ['file_write', 'file_edit', 'file_read'],
  ])('%s refuses overwrite and explains %s with JSON arguments', async (writer, editor, reader) => {
    const registered = tools();
    const result = await registered.find(tool => tool.name === writer)!.execute(
      { path: 'answer.ts', content: replacement },
      { cwd, extra: { exposedToolNames: [writer, editor, reader] } },
    );
    expect(result.success).toBe(false);
    expect(readFileSync(join(cwd, 'answer.ts'), 'utf8')).toBe(original);
    expect(result.error).toContain(`Use ${reader} with {"path":"answer.ts"}`);
    expect(result.error).toContain(`Use ${editor} with {"path":"answer.ts","old_str":"<exact existing text>","new_str":"<replacement text>"}`);
    if (writer !== 'create_file') expect(result.error).not.toContain('create_file');
    if (editor !== 'str_replace_editor') expect(result.error).not.toContain('str_replace_editor');

    // Recover through the advertised reader/editor, using exact text from disk.
    const read = await registered.find(tool => tool.name === reader)!.execute({ path: 'answer.ts' }, { cwd });
    expect(read.output).toContain('const answer = 1;');
    const edit = await registered.find(tool => tool.name === editor)!.execute(
      { path: 'answer.ts', old_str: original, new_str: replacement }, { cwd },
    );
    expect(edit.success).toBe(true);
    expect(readFileSync(join(cwd, 'answer.ts'), 'utf8')).toBe(replacement);
  });

  it('suggests apply_patch only when that editor is exposed', async () => {
    const result = await new CreateFileTool().execute(
      { path: 'answer.ts', content: replacement },
      { cwd, extra: { exposedToolNames: ['write_file', 'apply_patch'] } },
    );
    expect(result.error).toContain('Use apply_patch with {"patch":');
    expect(result.error).toContain('*** Update File: answer.ts');
    expect(result.error).not.toContain('str_replace_editor');
    expect(readFileSync(join(cwd, 'answer.ts'), 'utf8')).toBe(original);
  });

  it('R1: prefers the exposed apply_patch accepted by strict policy', async () => {
    const policy = new WritePolicy();
    policy.setMode('strict');
    const result = await new CreateFileTool().execute(
      { path: 'answer.ts', content: replacement },
      { cwd, extra: { exposedToolNames: ['write_file', 'str_replace_editor', 'apply_patch'] } },
    );
    expect(result.error).toContain('Use apply_patch with');
    expect(result.error).not.toContain('Use str_replace_editor');
    expect(await policy.gate({ toolName: 'str_replace_editor', paths: ['answer.ts'] })).toMatchObject({ allowed: false });
    expect(await policy.gate({ toolName: 'apply_patch', paths: ['answer.ts'] })).toMatchObject({ allowed: true });
    expect(readFileSync(join(cwd, 'answer.ts'), 'utf8')).toBe(original);
  });

  it('uses discovery when no editor is exposed', async () => {
    const result = await new CreateFileTool().execute(
      { path: 'answer.ts', content: replacement },
      { cwd, extra: { exposedToolNames: ['write_file', 'tool_search'] } },
    );
    expect(result.error).toContain('Use tool_search with {"query":"edit existing file"}');
    expect(result.error).not.toContain('str_replace_editor');
    expect(result.error).not.toContain('apply_patch');
  });

  it.each([{ names: undefined }, { names: [] }, { names: ['write_file'] }])('does not invent exposed tools for $names', async ({ names: exposedToolNames }) => {
    const result = await new CreateFileTool().execute(
      { path: 'answer.ts', content: replacement, overwrite: true },
      { cwd, extra: { exposedToolNames } },
    );
    expect(result.error).toContain('No editing tool is exposed');
    expect(result.error).not.toContain('str_replace_editor');
    expect(result.error).not.toContain('apply_patch');
    expect(readFileSync(join(cwd, 'answer.ts'), 'utf8')).toBe(original);
  });
});
