import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  acceptAmendment,
  isCommandAllowed,
  loadRules,
  removeRule,
  resetRulesCache,
  type PolicyRule,
} from '../../src/security/policy-amendments.js';

function rule(pattern: string): PolicyRule {
  return {
    pattern,
    decision: 'allow',
    scope: 'project',
    tool: 'bash',
    createdAt: new Date().toISOString(),
  };
}

describe('policy amendments persistence', () => {
  let root: string;
  let projectA: string;
  let projectB: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-amendments-'));
    projectA = path.join(root, 'project-a');
    projectB = path.join(root, 'project-b');
    fs.mkdirSync(projectA);
    fs.mkdirSync(projectB);
    resetRulesCache();
  });

  afterEach(() => {
    resetRulesCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('isolates the in-memory cache and persisted rules by cwd', () => {
    // Prime both empty cache entries before either project is changed.
    expect(loadRules(projectA)).toEqual([]);
    expect(loadRules(projectB)).toEqual([]);

    acceptAmendment(rule('vitest run*'), projectA);

    expect(isCommandAllowed('vitest run tests/a.test.ts', projectA)).toBe(true);
    expect(isCommandAllowed('vitest run tests/a.test.ts', projectB)).toBe(false);
    expect(loadRules(projectA)).toHaveLength(1);
    expect(loadRules(projectB)).toHaveLength(0);
  });

  it('removes a rule only from the requested cwd', () => {
    acceptAmendment(rule('tsc --noEmit*'), projectA);
    acceptAmendment(rule('tsc --noEmit*'), projectB);

    expect(removeRule('tsc --noEmit*', projectA)).toBe(true);
    expect(isCommandAllowed('tsc --noEmit', projectA)).toBe(false);
    expect(isCommandAllowed('tsc --noEmit', projectB)).toBe(true);
  });

  it('atomically replaces the JSON document without leaving temporary files', () => {
    acceptAmendment(rule('vitest run*'), projectA);
    acceptAmendment(rule('eslint src*'), projectA);

    const rulesDir = path.join(projectA, '.codebuddy', 'rules');
    const rulesFile = path.join(rulesDir, 'allow-rules.json');
    const parsed = JSON.parse(fs.readFileSync(rulesFile, 'utf-8')) as PolicyRule[];

    expect(parsed.map(entry => entry.pattern)).toEqual(['vitest run*', 'eslint src*']);
    expect(fs.readdirSync(rulesDir).filter(name => name.includes('.tmp-'))).toEqual([]);
    if (process.platform !== 'win32') {
      expect(fs.statSync(rulesFile).mode & 0o777).toBe(0o600);
    }
  });
});
