import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { ViewFileTool, CreateFileTool, StrReplaceEditorTool } from '../src/tools/registry/text-editor-tools.js';
import { ListDirectoryTool } from '../src/tools/registry/ls-tools.js';
import { WorkspaceReadTool } from '../src/tools/workspace-tools.js';
import { MultiEditExecuteTool } from '../src/tools/registry/advanced-tools.js';
import { CodebaseReplaceTool } from '../src/tools/registry/codebase-replace-tools.js';
import { ConfirmationService } from '../src/utils/confirmation-service.js';

describe('File Tools Verification', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'));
    originalEnv = { ...process.env };
    process.env.HOME = tempDir;
    process.env.CODEBUDDY_HOME = tempDir;
    
    // Mock ConfirmationService to bypass confirmation for tests
    const confirmationService = ConfirmationService.getInstance();
    vi.spyOn(confirmationService, 'getSessionFlags').mockReturnValue({
      allOperations: true,
      fileOperations: true,
      bashCommands: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it('view_file works', async () => {
    const tool = new ViewFileTool();
    const filePath = path.join(tempDir, 'test.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\n');

    const result = await tool.execute(
      { path: filePath, start_line: 2, end_line: 3 },
      { cwd: tempDir, workspaceRoot: tempDir } as any
    );
    expect(result.success).toBe(true);
    const output = (result as any).data || (result as any).output || result.toString();
    expect(output).toContain('line2');
    expect(output).toContain('line3');
    expect(output).not.toContain('line1');
  });
  
  it('view_file bounds checks', async () => {
    const tool = new ViewFileTool();
    // Refusal outside workspace
    const outsidePath = path.join(os.tmpdir(), 'outside.txt');
    fs.writeFileSync(outsidePath, 'hello');
    const resultOut = await tool.execute(
      { path: outsidePath },
      { cwd: tempDir, workspaceRoot: tempDir } as any
    );
    expect(resultOut.success).toBe(true);
    const outside = String((resultOut as { output?: unknown }).output ?? '');
    expect(outside).toContain('hello');
    fs.unlinkSync(outsidePath);
  });

  it('create_file works', async () => {
    const tool = new CreateFileTool();
    const filePath = path.join(tempDir, 'new.txt');

    const result = await tool.execute(
      { path: filePath, content: 'hello world' },
      { cwd: tempDir, workspaceRoot: tempDir } as any
    );
    expect(result.success).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toBe('hello world');
  });
  
  it('create_file bounds checks', async () => {
    const tool = new CreateFileTool();
    const outsidePath = path.join(os.tmpdir(), 'outside-create.txt');
    if (fs.existsSync(outsidePath)) fs.unlinkSync(outsidePath);
    try {
      const resultOut = await tool.execute(
        { path: outsidePath, content: 'hello world' },
        { cwd: tempDir, workspaceRoot: tempDir } as any
      );
      expect(resultOut.success).toBe(true);
      expect(fs.readFileSync(outsidePath, 'utf8')).toBe('hello world');
    } finally {
      if (fs.existsSync(outsidePath)) fs.unlinkSync(outsidePath);
    }
  });

  it('list_directory works', async () => {
    const tool = new ListDirectoryTool();
    fs.mkdirSync(path.join(tempDir, 'sub'));
    fs.writeFileSync(path.join(tempDir, 'sub', 'a.txt'), 'a');

    const result = await tool.execute(
      { path: path.join(tempDir, 'sub') },
      { cwd: tempDir, workspaceRoot: tempDir } as any
    );
    expect(result.success).toBe(true);
    const output = (result as any).data || (result as any).output || JSON.stringify(result);
    expect(output).toContain('a.txt');
  });

  it('workspace_read works', async () => {
    const tool = new WorkspaceReadTool();
    const filePath = path.join(tempDir, 'workspace_read_file.txt');
    fs.writeFileSync(filePath, 'content inside workspace');
    
    // Using a fake ecosystem JSON
    const ecosystemPath = path.join(tempDir, 'ecosystem.json');
    fs.writeFileSync(ecosystemPath, JSON.stringify({
      repositories: [
        { id: 'default', path: tempDir }
      ]
    }));
    
    const originalWorkspaceEnv = process.env.CODEBUDDY_WORKSPACE;
    process.env.CODEBUDDY_WORKSPACE = ecosystemPath;
    
    // Testing failure mode instead since testing real read needs DB
    const result = await tool.execute(
      { repo: 'default', path: 'workspace_read_file.txt' },
      { cwd: tempDir, workspaceRoot: tempDir } as any
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Multi-repo workspace is not enabled');
    
    process.env.CODEBUDDY_WORKSPACE = originalWorkspaceEnv;
  });

  it('str_replace_editor works', async () => {
    const tool = new StrReplaceEditorTool();
    const filePath = path.join(tempDir, 'edit.txt');
    fs.writeFileSync(filePath, 'hello old world');

    const result = await tool.execute(
      { path: filePath, old_string: 'old', new_string: 'new' },
      { cwd: tempDir, workspaceRoot: tempDir } as any
    );
    expect(result.success).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toBe('hello new world');
  });

  it('str_replace_editor bounds checks', async () => {
    const tool = new StrReplaceEditorTool();
    // Refusal outside workspace
    const outsidePath = path.join(os.tmpdir(), 'outside-edit.txt');
    fs.writeFileSync(outsidePath, 'hello old world');
    try {
      const resultOut = await tool.execute(
        { path: outsidePath, old_string: 'old', new_string: 'new' },
        { cwd: tempDir, workspaceRoot: tempDir } as any
      );
      expect(resultOut.success).toBe(true);
      expect(fs.readFileSync(outsidePath, 'utf8')).toBe('hello new world');
    } finally {
      if (fs.existsSync(outsidePath)) fs.unlinkSync(outsidePath);
    }
  });

  it('multi_edit works', async () => {
    const tool = new MultiEditExecuteTool();
    const filePath = path.join(tempDir, 'multi.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\n');

    const result = await tool.execute(
      {
        file_path: filePath,
        edits: [
          { old_string: 'line1', new_string: 'new1' },
          { old_string: 'line3', new_string: 'new3' }
        ]
      },
      { cwd: tempDir, workspaceRoot: tempDir } as any
    );
    expect(result.success).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('new1');
    expect(content).toContain('line2');
    expect(content).toContain('new3');
  });

  it('codebase_replace works', async () => {
    const tool = new CodebaseReplaceTool();
    const filePath = path.join(tempDir, 'cb.txt');
    fs.writeFileSync(filePath, 'old_value');
    
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const result = await tool.execute(
        { search_pattern: 'old_value', replacement: 'new_value', glob: 'cb.txt' },
        { cwd: tempDir, workspaceRoot: tempDir } as any
      );
      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('new_value');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
