/**
 * Callers of scanFile must not treat a missing read as an authorization.
 * The scanner module is replaced only in this file. The real named-pipe
 * refusal lives in skill-scanner.test.ts (POSIX mkfifo, bounded).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillRegistry } from '../../src/skills/registry.js';
import {
  COMPLEXITY_THRESHOLDS,
  generateSessionSkill,
} from '../../src/skills/session-skill-generator.js';

const scanner = vi.hoisted(() => ({
  mode: 'real' as 'real' | 'empty' | 'special',
  calls: 0,
}));

vi.mock('../../src/security/skill-scanner.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/security/skill-scanner.js')>(
    '../../src/security/skill-scanner.js',
  );
  return {
    ...actual,
    scanFile: (filePath: string) => {
      scanner.calls += 1;
      if (scanner.mode === 'empty') {
        return { file: filePath, findings: [], scannedAt: 1, textRead: false };
      }
      if (scanner.mode === 'special') {
        return {
          file: filePath,
          findings: [{
            severity: 'high' as const,
            pattern: 'special-file-not-read',
            description: 'Refused to read a special; the scan did not follow or block on it',
            file: filePath,
            line: 0,
            evidence: 'SKILL.md',
          }],
          scannedAt: 1,
          textRead: true,
        };
      }
      return actual.scanFile(filePath);
    },
  };
});

const BENIGN = `---
name: benign-skill
description: A benign skill with no dangerous pattern
---

Hello.
`;

const HIGH_ONLY = `---
name: high-only-skill
description: Mentions a child process without a critical pattern
---

const child_process = 1;
`;

function registryIn(dir: string): SkillRegistry {
  return new SkillRegistry({
    workspacePath: path.join(dir, 'workspace'),
    managedPath: path.join(dir, 'managed'),
    bundledPath: path.join(dir, 'bundled'),
    watchEnabled: false,
    cacheEnabled: false,
  });
}

function writeSkill(dir: string, content: string): string {
  const filePath = path.join(dir, 'SKILL.md');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('scanFile callers do not authorize an unread skill', () => {
  let root: string;
  const registries: SkillRegistry[] = [];

  beforeEach(() => {
    scanner.mode = 'real';
    scanner.calls = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scan-callers-'));
  });

  afterEach(() => {
    for (const registry of registries.splice(0)) registry.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('still registers a skill whose scan only has a non-critical finding', () => {
    const registry = registryIn(root);
    registries.push(registry);
    const filePath = writeSkill(root, HIGH_ONLY);
    registry.registerSkillFileSync(filePath, 'workspace');
    expect(scanner.calls, 'le registre n a pas appelé scanFile').toBeGreaterThan(0);
    expect(registry.get('high-only-skill')).toBeDefined();
  });

  it('does not register a skill when the scan read nothing', () => {
    scanner.mode = 'empty';
    const registry = registryIn(root);
    registries.push(registry);
    const filePath = writeSkill(root, BENIGN);
    registry.registerSkillFileSync(filePath, 'workspace');
    expect(scanner.calls, 'le registre n a pas appelé scanFile').toBeGreaterThan(0);
    expect(registry.get('benign-skill'), 'absence de lecture enregistrée comme skill').toBeUndefined();
  });

  it('does not register a skill when the scan reports special-file-not-read', () => {
    scanner.mode = 'special';
    const registry = registryIn(root);
    registries.push(registry);
    const filePath = writeSkill(root, BENIGN);
    registry.registerSkillFileSync(filePath, 'workspace');
    expect(scanner.calls, 'le registre n a pas appelé scanFile').toBeGreaterThan(0);
    expect(
      registry.get('benign-skill'),
      'finding special-file-not-read enregistré comme skill',
    ).toBeUndefined();
  });

  it('does not keep a generated skill when the scan read nothing', () => {
    scanner.mode = 'empty';
    const result = generateSessionSkill({
      workDir: root,
      metrics: {
        toolCalls: COMPLEXITY_THRESHOLDS.minToolCalls,
        errorsRecovered: 0,
        filesTouched: ['src/a.ts', 'src/b.ts'],
        summary: 'Isolated a timer.',
      },
      topic: 'Unread pipe',
      register: false,
    });
    expect(scanner.calls, 'le générateur n a pas appelé scanFile').toBeGreaterThan(0);
    expect(result, 'skill généré malgré un scan non lu').toBeNull();
    expect(fs.existsSync(path.join(root, '.codebuddy', 'skills', 'authored-unread-pipe'))).toBe(false);
  });
});
