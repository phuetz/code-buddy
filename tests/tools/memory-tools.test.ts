import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { RememberTool, RecallTool, ForgetTool, ReplaceMemoryTool, MemoryProposeTool } from '../../src/tools/registry/memory-tools.js';
import { LessonsAddTool } from '../../src/tools/registry/lessons-tools.js';
import { RelationshipContextTool } from '../../src/tools/registry/relationship-intelligence-tools.js';
import * as persistentMemory from '../../src/memory/persistent-memory.js';
import * as candidateQueue from '../../src/memory/memory-candidate-queue.js';

function applyFixtureResets(): void {
  persistentMemory.resetMemoryManagerForTests();
  candidateQueue.resetMemoryCandidateQueues();
}

describe('Memory Tools', () => {
  let tmpHome: string;
  let tmpCodeBuddyHome: string;
  let tmpCwd: string;
  
  let realHomedirCodebuddy: string;
  let homedirBeforeMtime: number | null = null;
  
  beforeEach(async () => {
    // Record homedir state to enforce isolation
    realHomedirCodebuddy = join(homedir(), '.codebuddy');
    homedirBeforeMtime = existsSync(realHomedirCodebuddy) ? statSync(realHomedirCodebuddy).mtimeMs : null;

    tmpHome = mkdtempSync(join(tmpdir(), 'codebuddy-test-home-'));
    tmpCodeBuddyHome = join(tmpHome, '.codebuddy');
    mkdirSync(tmpCodeBuddyHome, { recursive: true });
    
    tmpCwd = mkdtempSync(join(tmpdir(), 'codebuddy-test-cwd-'));
    mkdirSync(join(tmpCwd, '.codebuddy'), { recursive: true });

    // Initialize an empty lessons.md to avoid missing directory errors during tests
    writeFileSync(join(tmpCwd, '.codebuddy', 'lessons.md'), '# Lessons\n');

    vi.stubEnv('HOME', tmpHome);
    vi.stubEnv('USERPROFILE', tmpHome);
    vi.stubEnv('CODEBUDDY_HOME', tmpCodeBuddyHome);
    vi.stubEnv('CODEBUDDY_DISABLE_HOOKS', '1'); // ensure no webhooks are called in bg

    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);
    applyFixtureResets();
  });

  it('propage une erreur de resetMemoryManagerForTests', () => {
    vi.spyOn(persistentMemory, 'resetMemoryManagerForTests').mockImplementation(() => {
      throw new Error('RESET_CASSE');
    });
    expect(() => applyFixtureResets()).toThrow(/RESET_CASSE/);
  });

  afterEach(() => {
    // Check that we didn't write to homedir (or if we did, nothing changed)
    const homedirAfterMtime = existsSync(realHomedirCodebuddy) ? statSync(realHomedirCodebuddy).mtimeMs : null;
    expect(homedirAfterMtime).toBe(homedirBeforeMtime);

    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const getTools = () => ({
    remember: new RememberTool(),
    recall: new RecallTool(),
    forget: new ForgetTool(),
    replaceMemory: new ReplaceMemoryTool(),
    memoryPropose: new MemoryProposeTool(),
    lessonsAdd: new LessonsAddTool(),
    relationshipContext: new RelationshipContextTool(),
  });

  it('verifies remember then recall round-trip', async () => {
    const { remember, recall } = getTools();
    
    const rememberResult = await remember.execute({
      key: 'test-key',
      value: 'this is a test memory',
      scope: 'project'
    });
    
    console.log('[REMEMBER RAW OUTPUT]', rememberResult);
    expect(rememberResult.success).toBe(true);
    
    const recallResult = await recall.execute({
      key: 'test-key',
      scope: 'project'
    });
    
    console.log('[RECALL RAW OUTPUT]', recallResult);
    expect(recallResult.success).toBe(true);
    expect(recallResult.output).toContain('this is a test memory');
  });

  it('verifies forget then recall absent', async () => {
    const { remember, recall, forget } = getTools();
    
    await remember.execute({
      key: 'delete-key',
      value: 'to be deleted',
      scope: 'project'
    });
    
    const forgetResult = await forget.execute({
      key: 'delete-key',
      scope: 'project'
    });
    console.log('[FORGET RAW OUTPUT]', forgetResult);
    expect(forgetResult.success).toBe(true);
    
    const recallResult = await recall.execute({
      key: 'delete-key',
      scope: 'project'
    });
    console.log('[RECALL ABSENT RAW OUTPUT]', recallResult);
    expect(recallResult.success).toBe(true); 
    expect(recallResult.output).toContain('No memory found');
  });

  it('verifies replace_memory then recall new value', async () => {
    const { remember, replaceMemory, recall } = getTools();
    
    await remember.execute({
      key: 'replace-key',
      value: 'old value',
      scope: 'project'
    });
    
    const replaceResult = await replaceMemory.execute({
      key: 'replace-key',
      value: 'new value',
      scope: 'project'
    });
    console.log('[REPLACE RAW OUTPUT]', replaceResult);
    expect(replaceResult.success).toBe(true);
    
    const recallResult = await recall.execute({
      key: 'replace-key',
      scope: 'project'
    });
    console.log('[RECALL REPLACED RAW OUTPUT]', recallResult);
    expect(recallResult.success).toBe(true);
    expect(recallResult.output).toContain('new value');
  });
  
  it('verifies memory_propose', async () => {
    const { memoryPropose } = getTools();
    const proposeResult = await memoryPropose.execute({
      key: 'propose-key',
      value: 'proposed value',
      scope: 'project'
    });
    
    console.log('[MEMORY_PROPOSE RAW OUTPUT]', proposeResult);
    expect(proposeResult.success).toBe(true);
  });

  it('verifies lessons_add', async () => {
    const { lessonsAdd } = getTools();
    
    const lessonsResult = await lessonsAdd.execute(
      {
        category: 'PATTERN',
        content: 'Use mkdtemp for testing directories',
        context: 'Writing tests',
        source: 'manual'
      },
      { cwd: tmpCwd } // mock exec context
    );
    
    console.log('[LESSONS_ADD RAW OUTPUT]', lessonsResult);
    expect(lessonsResult.success).toBe(true);
  });
  
  it('verifies relationship_context', async () => {
    const { relationshipContext } = getTools();
    const relationshipResult = await relationshipContext.execute({
      subject: 'Bob',
      subjectType: 'known_person',
      mode: 'robot_conversation',
      publicFacts: ['Developer']
    });
    
    console.log('[RELATIONSHIP_CONTEXT RAW OUTPUT]', relationshipResult);
    expect(relationshipResult.success).toBe(true);
  });
});
