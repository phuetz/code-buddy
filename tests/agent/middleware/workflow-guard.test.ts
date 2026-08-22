/**
 * Tests for WorkflowGuardMiddleware
 *
 * Verifies that the guard fires only on the first turn (toolRound === 0),
 * counts distinct action verbs correctly (including conjugated forms), and
 * checks for PLAN.md / .codebuddy/PLAN.md before emitting a steer warning.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { WorkflowGuardMiddleware } from '../../../src/agent/middleware/workflow-guard.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';

// Helper that builds a minimal MiddlewareContext
function makeContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    toolRound: 0,
    maxToolRounds: 50,
    sessionCost: 0,
    sessionCostLimit: 10,
    inputTokens: 100,
    outputTokens: 50,
    history: [],
    messages: [],
    isStreaming: false,
    ...overrides,
  };
}

// Helper that builds a context with a single user message
function makeUserContext(text: string, toolRound = 0): MiddlewareContext {
  return makeContext({
    toolRound,
    messages: [{ role: 'user', content: text }] as MiddlewareContext['messages'],
  });
}

describe('WorkflowGuardMiddleware', () => {
  const mw = new WorkflowGuardMiddleware();

  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-guard-test-'));
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  it('should have name "workflow-guard"', () => {
    expect(mw.name).toBe('workflow-guard');
  });

  it('should have priority 45', () => {
    expect(mw.priority).toBe(45);
  });

  // --------------------------------------------------------------------------
  // toolRound guard — only fires on round 0
  // --------------------------------------------------------------------------

  it('should return continue when toolRound > 0', () => {
    const ctx = makeUserContext(
      'create add implement build fix update test deploy refactor migrate integrate configure',
      1
    );
    const result = mw.beforeTurn(ctx);
    expect(result.action).toBe('continue');
  });

  // --------------------------------------------------------------------------
  // Verb counting
  // --------------------------------------------------------------------------

  it('should return continue with 1–2 distinct action verbs', () => {
    // Only 2 distinct verbs: "create" and "fix"
    const ctx = makeUserContext('create a file and fix the bug');
    const result = mw.beforeTurn(ctx);
    expect(result.action).toBe('continue');
  });

  it('should return warn with 3+ distinct verbs and no PLAN.md present', () => {
    // 3 distinct verbs: create, fix, update
    const ctx = makeUserContext('create a module, fix the tests, and update the docs');
    const result = mw.beforeTurn(ctx);
    expect(result.action).toBe('warn');
    expect(result.message?.toLowerCase()).toContain('plan');
  });

  it('should count present-participle forms that strip -ing to a known verb', () => {
    // fixing→fix, building→build, checking→check (all 3 are in ACTION_VERBS)
    const ctx = makeUserContext('fixing tests, building the module, and checking the output');
    const result = mw.beforeTurn(ctx);
    expect(result.action).toBe('warn');
  });

  it('should count third-person-singular (-s) and past-tense (-ed) verb forms', () => {
    // creates→create (-s rule), removes→remove (-s rule), tested→test (-ed rule)
    const ctx = makeUserContext('code that creates files, removes modules, and tested the config');
    const result = mw.beforeTurn(ctx);
    expect(result.action).toBe('warn');
  });

  // --------------------------------------------------------------------------
  // PLAN.md check
  // --------------------------------------------------------------------------

  it('should return continue when PLAN.md exists in cwd', () => {
    fs.writeFileSync(path.join(tmpDir, 'PLAN.md'), '# Plan\n', 'utf-8');
    const ctx = makeUserContext('create a module, fix the tests, and update the docs');
    const result = mw.beforeTurn(ctx);
    expect(result.action).toBe('continue');
  });

  it('should return continue when .codebuddy/PLAN.md exists', () => {
    const cbDir = path.join(tmpDir, '.codebuddy');
    fs.mkdirSync(cbDir, { recursive: true });
    fs.writeFileSync(path.join(cbDir, 'PLAN.md'), '# Plan\n', 'utf-8');
    const ctx = makeUserContext('create a module, fix the tests, and update the docs');
    const result = mw.beforeTurn(ctx);
    expect(result.action).toBe('continue');
  });

  // --------------------------------------------------------------------------
  // Multipart content (array of {text: string} objects)
  // --------------------------------------------------------------------------

  it('should extract text from array-of-objects message content', () => {
    const ctx = makeContext({
      toolRound: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'create a new module and' },
            { type: 'text', text: 'fix the failing tests and update the docs' },
          ],
        },
      ] as MiddlewareContext['messages'],
    });
    const result = mw.beforeTurn(ctx);
    // create, fix, update = 3 verbs → warn
    expect(result.action).toBe('warn');
  });

  // --------------------------------------------------------------------------
  // No user message
  // --------------------------------------------------------------------------

  it('should return continue when there is no user message in context', () => {
    const ctx = makeContext({ messages: [] });
    const result = mw.beforeTurn(ctx);
    expect(result.action).toBe('continue');
  });
});
