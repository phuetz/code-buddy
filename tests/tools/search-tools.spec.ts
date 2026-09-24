import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { UnifiedSearchTool, FindSymbolsTool, FindReferencesTool, FindDefinitionTool, SearchMultipleTool } from '../../src/tools/registry/search-tools.js';
import { FileSearchTool } from '../../src/tools/file-search-tool.js';
import { DiffFilesTool } from '../../src/tools/diff-files-tool.js';
import { WorkspaceSearchTool } from '../../src/tools/workspace-tools.js';

describe('Search Tools Real Output Test', () => {
  let tmpDir: string;
  let homeDir: string;
  let originalHome: string | undefined;
  let originalCwd: string;
  let projectDir: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-search-tests-'));
    homeDir = path.join(tmpDir, 'home');
    await fs.mkdir(homeDir);
    process.env.HOME = homeDir;
    process.env.CODEBUDDY_HOME = path.join(homeDir, '.codebuddy');

    // Create a synthetic project
    projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir);

    const code1 = `
export class UserManagement {
  private users: string[] = [];

  constructor() {
    this.users = ['admin'];
  }

  public addUser(user: string): void {
    this.users.push(user);
  }

  public getUser(index: number): string {
    return this.users[index];
  }
}
`;
    await fs.writeFile(path.join(projectDir, 'user.ts'), code1);

    const code2 = `
import { UserManagement } from './user.js';

const manager = new UserManagement();
manager.addUser('alice');
console.log(manager.getUser(0));
`;
    await fs.writeFile(path.join(projectDir, 'app.ts'), code2);

    const code3 = `
export class UserManagementV2 {
  public addUser(user: string): void {
  }
}
`;
    await fs.writeFile(path.join(projectDir, 'user-v2.ts'), code3);

    const code4 = `
// Random text file
This is a test file for text search.
It contains some special_words_to_find.
Line three is here.
`;
    await fs.writeFile(path.join(projectDir, 'text.txt'), code4);

    const code5 = `
// Random text file modified
This is a test file for text search.
It contains some special_words_to_find.
Line 3 is modified.
Line 4 is added.
`;
    await fs.writeFile(path.join(projectDir, 'text-modified.txt'), code5);

    // Create a .git directory to mock a git repository/workspace
    await fs.mkdir(path.join(projectDir, '.git'));

    process.chdir(projectDir);
  });

  afterAll(async () => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    delete process.env.CODEBUDDY_HOME;
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('UnifiedSearchTool works for text search', async () => {
    const tool = new UnifiedSearchTool();
    const result = await tool.execute({ query: 'special_words_to_find', search_type: 'text' }, { cwd: projectDir });
    expect(result.success).toBe(true);
    // Explicitly check exact hits including line numbers and filename
    expect(String(result.output)).toContain('text.txt (1 matches)');
    expect(String(result.output)).toContain('text-modified.txt (1 matches)');
    console.log('[search]', result.output);
  });

  it('UnifiedSearchTool works for file search', async () => {
    const tool = new UnifiedSearchTool();
    const result = await tool.execute({ query: 'user', search_type: 'files' }, { cwd: projectDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain('user.ts');
  });

  it('FindSymbolsTool works', async () => {
    const tool = new FindSymbolsTool();
    const result = await tool.execute({ name: 'UserManagement' }, { cwd: projectDir });
    expect(result.success).toBe(true);
    // Exact file and line hit
    expect(String(result.output)).toContain('user.ts:2');
  });

  it('FindReferencesTool works', async () => {
    const tool = new FindReferencesTool();
    const result = await tool.execute({ symbol_name: 'addUser' }, { cwd: projectDir });
    expect(result.success).toBe(true);
    // Exact file and line hit
    expect(String(result.output)).toContain('L5: manager.addUser(\'alice\');');
  });

  it('FindDefinitionTool works', async () => {
    const tool = new FindDefinitionTool();
    const result = await tool.execute({ symbol_name: 'UserManagement' }, { cwd: projectDir });
    expect(result.success).toBe(true);
    // Exact file and line hit
    expect(String(result.output)).toContain('user.ts:2');
  });

  it('SearchMultipleTool works', async () => {
    const tool = new SearchMultipleTool();
    const result = await tool.execute({ patterns: ['special_words_to_find', 'alice'], operator: 'OR' }, { cwd: projectDir });
    expect(result.success).toBe(true);
    // Exact file and line hits
    expect(String(result.output)).toContain('text.txt (1 matches)');
    expect(String(result.output)).toContain('app.ts (1 matches)');
  });

  it('FileSearchTool works', async () => {
    const tool = new FileSearchTool();
    const result = await tool.execute({ root: projectDir, pattern: 'special_words_to_find' });
    expect(result.success).toBe(true);
    // Exact hits
    expect(String(result.output)).toContain('match(es)');
    const matches = (result.data as any).matches as any[];
    const lines = matches.map(m => path.basename(m.file) + ':' + m.line);
    expect(lines).toContain('text.txt:4');
    expect(lines).toContain('text-modified.txt:4');
  });

  it('DiffFilesTool works', async () => {
    const tool = new DiffFilesTool();
    const result = await tool.execute({ root: projectDir, left: 'text.txt', right: 'text-modified.txt' });
    expect(result.success).toBe(true);
    // Assert actual diff lines
    expect(String(result.output)).toContain('-Line three is here.');
    expect(String(result.output)).toContain('+Line 3 is modified.');
    expect(String(result.output)).toContain('+Line 4 is added.');
  });

  it('WorkspaceSearchTool works', async () => {
    const tool = new WorkspaceSearchTool();
    const result = await tool.execute({ query: 'special_words_to_find' }, { cwd: projectDir });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Multi-repo workspace is not enabled or has no valid repositories');
  });

});
