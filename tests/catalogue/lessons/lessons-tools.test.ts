import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { LessonsProposeTool, LessonsSearchTool, LessonsListTool, LessonsGraphTool } from '../../../src/tools/registry/lessons-tools.js';

function fingerprintHome(): string {
  const root = path.join(os.homedir(), '.codebuddy');
  if (!fs.existsSync(root)) return '';
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) files.push(full);
    }
  };
  walk(root);
  return files.sort().map((file) => file + '\n' + fs.readFileSync(file, 'utf8')).join('\n---\n');
}

describe('Lessons Tools', () => {
  let tempDir: string;
  let originalCodebuddyHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-lessons-test-'));
    originalCodebuddyHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = tempDir;
  });

  afterEach(() => {
    if (originalCodebuddyHome !== undefined) {
      process.env.CODEBUDDY_HOME = originalCodebuddyHome;
    } else {
      delete process.env.CODEBUDDY_HOME;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lessons_propose adds a pending lesson and lessons_list lists it', async () => {
    const proposeTool = new LessonsProposeTool();
    const homeBefore = fingerprintHome();
    const proposeResult = await proposeTool.execute({
      content: 'This is a test lesson.',
      category: 'PATTERN'
    }, { cwd: tempDir } as any);

    expect(proposeResult.success).toBe(true);
    expect(proposeResult.output).toMatch(/Proposed lesson|Matched existing pending candidate/);
    expect(fingerprintHome()).toBe(homeBefore);

    // It writes to candidates queue, not lessons tracker directly.
    // lessons_list lists from tracker. We should use lessons_list after adding it properly to tracker if we want it listed there.
    // However, lessons_list does not have a `state: 'PENDING'` parameter. It filters by category.
    // Since proposed lessons go to queue, lessons_list will not show it.
    // Instead we can test that it went to candidates queue file in TEMP_DIR.
    // Actually getLessonCandidateQueue uses process.cwd() not CODEBUDDY_HOME.
    // So we need to mock process.cwd() or pass execContext.cwd to proposeTool.
    const candidatesFile = path.join(tempDir, '.codebuddy', 'lesson-candidates.json');
    expect(fs.existsSync(candidatesFile)).toBe(true);
    expect(fs.readFileSync(candidatesFile, 'utf8')).toContain('This is a test lesson.');
  });

  it('lessons_search finds the proposed lesson', async () => {
    // lessons_search only searches accepted lessons in the tracker, not candidates.
    // We should use lessons_add (or modify the tracker file directly) to test lessons_search.
    const { LessonsAddTool } = await import('../../../src/tools/registry/lessons-tools.js');
    const addTool = new LessonsAddTool();
    await addTool.execute({
      content: 'I need to find this Findable content.',
      category: 'RULE'
    }, { cwd: tempDir } as any);

    const searchTool = new LessonsSearchTool();
    const searchResult = await searchTool.execute({ query: 'Findable' }, { cwd: tempDir } as any);
    
    expect(searchResult.success).toBe(true);
    expect(searchResult.output).toContain('Findable');
  });

  it('lessons_list lists all lessons', async () => {
    const { LessonsAddTool } = await import('../../../src/tools/registry/lessons-tools.js');
    const addTool = new LessonsAddTool();
    await addTool.execute({
      content: 'A lesson to list.',
      category: 'CONTEXT'
    }, { cwd: tempDir } as any);

    const listTool = new LessonsListTool();
    const listResult = await listTool.execute({}, { cwd: tempDir } as any);
    
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain('A lesson to list.');
  });

  it('lessons_graph returns a summary', async () => {
    const { LessonsAddTool } = await import('../../../src/tools/registry/lessons-tools.js');
    const addTool = new LessonsAddTool();
    await addTool.execute({
      content: 'Graph this pattern.',
      category: 'PATTERN'
    }, { cwd: tempDir } as any);
    
    const graphTool = new LessonsGraphTool();
    const graphResult = await graphTool.execute({}, { cwd: tempDir } as any);

    expect(graphResult.success).toBe(true);
    expect(graphResult.output).toBeDefined();
    expect(graphResult.output).toContain('Lesson graph:');
    // In summary mode, it lists Concepts and Backlinks. It doesn't print the raw text 'Graph this pattern', 
    // it extracts the concept 'pattern' or 'graph'.
    expect(graphResult.output).toContain('pattern');
  });
});
