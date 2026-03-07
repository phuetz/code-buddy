import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEditor = {
  dispose: vi.fn(),
  view: vi.fn(),
  create: vi.fn(),
  strReplace: vi.fn(),
};

vi.mock('../../src/tools/index.js', () => ({
  TextEditorTool: vi.fn().mockImplementation(function TextEditorToolMock() {
    return mockEditor;
  }),
}));

import {
  CreateFileTool,
  StrReplaceEditorTool,
  ViewFileTool,
  resetTextEditorInstance,
} from '../../src/tools/registry/text-editor-tools.js';

describe('text-editor-tools aliases', () => {
  beforeEach(() => {
    resetTextEditorInstance();
    vi.clearAllMocks();
  });

  it('ViewFileTool accepts file_path alias', async () => {
    mockEditor.view.mockResolvedValue({ success: true, content: 'ok' });
    const tool = new ViewFileTool();
    const result = await tool.execute({ file_path: 'README.md' });

    expect(tool.validate({ file_path: 'README.md' }).valid).toBe(true);
    expect(mockEditor.view).toHaveBeenCalledWith('README.md', undefined);
    expect(result.success).toBe(true);
  });

  it('CreateFileTool accepts target_file alias', async () => {
    mockEditor.create.mockResolvedValue({ success: true, content: 'created' });
    const tool = new CreateFileTool();
    const result = await tool.execute({ target_file: 'tmp/a.txt', content: 'hello' });

    expect(tool.validate({ target_file: 'tmp/a.txt', content: 'hello' }).valid).toBe(true);
    expect(mockEditor.create).toHaveBeenCalledWith('tmp/a.txt', 'hello');
    expect(result.success).toBe(true);
  });

  it('StrReplaceEditorTool accepts old_text/new_text aliases', async () => {
    mockEditor.strReplace.mockResolvedValue({ success: true, content: 'edited' });
    const tool = new StrReplaceEditorTool();
    const args = {
      file_path: 'src/index.ts',
      old_text: 'foo',
      new_text: 'bar',
      replace_all: true,
    };
    const result = await tool.execute(args);

    expect(tool.validate(args).valid).toBe(true);
    expect(mockEditor.strReplace).toHaveBeenCalledWith('src/index.ts', 'foo', 'bar', true);
    expect(result.success).toBe(true);
  });

  it('StrReplaceEditorTool accepts old_content/new_content aliases', async () => {
    mockEditor.strReplace.mockResolvedValue({ success: true, content: 'edited' });
    const tool = new StrReplaceEditorTool();
    const args = {
      file_path: 'src/index.ts',
      old_content: 'foo',
      new_content: 'bar',
    };
    const result = await tool.execute(args);

    expect(tool.validate(args).valid).toBe(true);
    expect(mockEditor.strReplace).toHaveBeenCalledWith('src/index.ts', 'foo', 'bar', false);
    expect(result.success).toBe(true);
  });

  it('StrReplaceEditorTool accepts find/replace aliases', async () => {
    mockEditor.strReplace.mockResolvedValue({ success: true, content: 'edited' });
    const tool = new StrReplaceEditorTool();
    const args = {
      path: 'src/index.ts',
      find: 'foo',
      replace: 'bar',
    };
    const result = await tool.execute(args);

    expect(tool.validate(args).valid).toBe(true);
    expect(mockEditor.strReplace).toHaveBeenCalledWith('src/index.ts', 'foo', 'bar', false);
    expect(result.success).toBe(true);
  });

  it('StrReplaceEditorTool accepts old_string/new_string aliases', async () => {
    mockEditor.strReplace.mockResolvedValue({ success: true, content: 'edited' });
    const tool = new StrReplaceEditorTool();
    const args = {
      path: 'src/index.ts',
      old_string: 'foo',
      new_string: 'bar',
    };
    const result = await tool.execute(args);

    expect(tool.validate(args).valid).toBe(true);
    expect(mockEditor.strReplace).toHaveBeenCalledWith('src/index.ts', 'foo', 'bar', false);
    expect(result.success).toBe(true);
  });

  it('schema allows alias-only replace args without requiring old_str/new_str keys', () => {
    const tool = new StrReplaceEditorTool();
    const schema = tool.getSchema();
    expect(schema.parameters.required).toEqual(['path']);
    expect(tool.validate({ path: 'a.ts', old_string: 'a', new_string: 'b' }).valid).toBe(true);
  });
});
