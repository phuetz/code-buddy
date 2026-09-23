import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { KnowledgeAddTool, KnowledgeSearchTool } from '../../src/tools/registry/knowledge-tools.js';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('Knowledge Tools', () => {
  let tmpDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-test-'));
    // The knowledge manager uses global app config which relies on process.env.HOME
    // or os.homedir(). We need to override env vars that control the path.
    // getHomeDir in core codebuddy typically uses HOME.
    // Windows: os.homedir() reads USERPROFILE, not HOME.
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
  });

  afterEach(async () => {
    restoreEnv('HOME', originalHome);
    restoreEnv('USERPROFILE', originalUserProfile);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should add and search knowledge', async () => {
    const addTool = new KnowledgeAddTool();
    const searchTool = new KnowledgeSearchTool();

    // 1. Add knowledge
    const addResult = await addTool.execute({
      title: 'Test Convention',
      content: 'All test files must use synthetic inputs.',
      tags: ['testing']
    });

    console.log('KNOWLEDGE_ADD_OUTPUT:', JSON.stringify(addResult, null, 2));
    expect(addResult.success).toBe(true);
    expect(addResult.output).toContain(tmpDir); // Should save to the temp home dir

    // 2. Search knowledge
    const searchResult = await searchTool.execute({
      query: 'synthetic inputs'
    });

    console.log('KNOWLEDGE_SEARCH_OUTPUT:', JSON.stringify(searchResult, null, 2));
    expect(searchResult.success).toBe(true);
    expect(searchResult.output).toContain('Test Convention');
    expect(searchResult.output).toContain('synthetic inputs');
  });
});
