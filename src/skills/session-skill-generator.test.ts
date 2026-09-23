import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  COMPLEXITY_THRESHOLDS,
  generateSessionSkill,
  isComplexSession,
  type SessionMetrics,
} from './session-skill-generator.js';

function complexMetrics(over: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    toolCalls: COMPLEXITY_THRESHOLDS.minToolCalls,
    errorsRecovered: 0,
    filesTouched: ['src/a.ts', 'src/b.ts'],
    summary: 'Fixed a flaky test suite by isolating timers.',
    ...over,
  };
}

describe('session-skill-generator', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-skillgen-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('detects complex vs simple sessions', () => {
    expect(isComplexSession({ toolCalls: 1, errorsRecovered: 0, filesTouched: [] })).toBe(false);
    expect(isComplexSession(complexMetrics())).toBe(true);
    expect(isComplexSession(complexMetrics({ toolCalls: 0, errorsRecovered: 2, filesTouched: [] }))).toBe(true);
  });

  it('returns null for a simple session', () => {
    const r = generateSessionSkill({
      workDir: root,
      metrics: { toolCalls: 1, errorsRecovered: 0, filesTouched: ['x.ts'] },
      register: false,
    });
    expect(r).toBeNull();
    expect(fs.existsSync(path.join(root, '.codebuddy', 'skills'))).toBe(false);
  });

  it('generates an authored skill and installs it', () => {
    const r = generateSessionSkill({
      workDir: root,
      metrics: complexMetrics(),
      topic: 'Fix flaky timers',
      register: false,
    });
    expect(r).not.toBeNull();
    expect(r!.name.startsWith('authored-')).toBe(true);
    expect(r!.slug).toBe('fix-flaky-timers');
    const file = path.join(root, '.codebuddy', 'skills', r!.name, 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('authored-fix-flaky-timers');
    expect(content).toContain('Fix flaky timers');
    expect(content).toContain('session-generated');
    expect(content).toMatch(/Tool calls: 8/);
  });

  it('is idempotent across repeated calls', () => {
    generateSessionSkill({ workDir: root, metrics: complexMetrics(), topic: 'idem', register: false });
    generateSessionSkill({ workDir: root, metrics: complexMetrics(), topic: 'idem', register: false });
    const dir = path.join(root, '.codebuddy', 'skills');
    const authored = fs.readdirSync(dir).filter((d) => d.startsWith('authored-'));
    expect(authored).toHaveLength(1);
  });
});
