import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  scoreSessionComplexity,
  isComplexSession,
  buildSkillDraft,
  generateSkillFromSession,
  resetSessionSkillGenerator,
  type SessionTranscript,
} from './session-skill-generator.js';
import { LiveSkillMutator, resetCreateSkillTool } from '../tools/create-skill-tool.js';

function makeSession(overrides: Partial<SessionTranscript> = {}): SessionTranscript {
  return {
    sessionId: 'sess-abc12345',
    startedAt: '2026-09-21T01:00:00Z',
    endedAt: '2026-09-21T01:30:00Z',
    messages: [
      { role: 'user', content: 'Fix the flaky test in auth module.' },
      { role: 'assistant', content: 'I will inspect the test file and rerun it.' },
      { role: 'tool', content: 'Error: assertion failed on line 42' },
      { role: 'assistant', content: 'Adjusted the timeout and the test passes now.' },
      { role: 'user', content: 'Great, remember to always bump the timeout on CI.' },
    ],
    toolCalls: 10,
    errorsRecovered: 2,
    filesTouched: ['src/auth/test.ts', 'src/auth/service.ts'],
    summary: 'Recovered a flaky auth test by increasing the CI timeout.',
    ...overrides,
  };
}

describe('session-skill-generator', () => {
  let dir: string;
  let mutator: LiveSkillMutator;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-skillgen-'));
    mutator = new LiveSkillMutator(path.join(dir, '.codebuddy', 'skills'));
    resetSessionSkillGenerator();
    resetCreateSkillTool();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetSessionSkillGenerator();
    resetCreateSkillTool();
  });

  it('scores a complex session above the threshold', () => {
    const s = makeSession();
    expect(scoreSessionComplexity(s)).toBeGreaterThanOrEqual(6);
    expect(isComplexSession(s)).toBe(true);
  });

  it('rejects a trivial session', () => {
    const s = makeSession({ toolCalls: 1, errorsRecovered: 0, filesTouched: [] });
    expect(isComplexSession(s)).toBe(false);
  });

  it('builds a draft with steps, errors and files', () => {
    const draft = buildSkillDraft(makeSession());
    expect(draft.name.startsWith('authored-session-')).toBe(true);
    expect(draft.content).toContain('## Steps that worked');
    expect(draft.content).toContain('## Errors recovered');
    expect(draft.content).toContain('src/auth/test.ts');
    expect(draft.complexityScore).toBeGreaterThan(0);
  });

  it('generates and installs a skill for a complex session', async () => {
    const result = await generateSkillFromSession(makeSession(), { mutator });
    expect(result.generated).toBe(true);
    expect(result.installed).toBe(true);
    expect(mutator.has(result.skill!.name)).toBe(true);
    const installed = mutator.readInstalled(result.skill!.name);
    expect(installed).toContain('authored-session-');
    expect(installed).toContain('## When to use');
  });

  it('does not install for a trivial session', async () => {
    const result = await generateSkillFromSession(
      makeSession({ toolCalls: 1, errorsRecovered: 0 }),
      { mutator },
    );
    expect(result.generated).toBe(false);
    expect(result.reason).toMatch(/not complex enough/);
  });
});
