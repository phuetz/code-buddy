/**
 * Bundled skills load in a NORMAL checkout — no env override, no host bridge.
 *
 * Before the module-relative candidate in getBundledSkillsPath(), a plain
 * checkout resolved to a non-existent `.codebuddy/skills/bundled` and the
 * bundled tier silently never loaded (loadTier no-ops on a missing dir); only
 * Cowork worked around it via CODEBUDDY_BUNDLED_SKILLS_DIR. These tests pin
 * the fixed resolution and the actual registry load of the shipped skills.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import * as path from 'path';

import { getBundledSkillsPath } from '../../src/skills/index.js';
import { SkillRegistry } from '../../src/skills/registry.js';

const SHIPPED_SKILLS = [
  'code-explorer',
  'file-edit',
  'git-commit',
  'pubcommander-control',
  'typescript-expert',
  'weather',
  'web-app-testing',
  'web-search',
];

describe('bundled skills — normal checkout resolution', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.CODEBUDDY_BUNDLED_SKILLS_DIR;
    delete process.env.CODEBUDDY_BUNDLED_SKILLS_DIR;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CODEBUDDY_BUNDLED_SKILLS_DIR;
    else process.env.CODEBUDDY_BUNDLED_SKILLS_DIR = savedEnv;
  });

  it('getBundledSkillsPath() resolves to an EXISTING directory without any override', () => {
    const resolved = getBundledSkillsPath();
    expect(existsSync(resolved)).toBe(true);
    expect(resolved.replace(/\\/g, '/')).toMatch(/skills\/bundled$/);
  });

  it('the registry actually loads the shipped skills from that path', async () => {
    const registry = new SkillRegistry({
      bundledPath: getBundledSkillsPath(),
      // Point the other tiers at nowhere so this test only sees the bundled tier.
      managedPath: path.join('/nonexistent', 'managed'),
      workspacePath: path.join('/nonexistent', 'workspace'),
      watchEnabled: false,
    });
    await registry.load();

    for (const name of SHIPPED_SKILLS) {
      expect(registry.get(name), `bundled skill "${name}" should load`).toBeDefined();
    }
    expect(registry.get('code-explorer')!.tier).toBe('bundled');
  });

  it('the env override still wins over the shipped skills', () => {
    process.env.CODEBUDDY_BUNDLED_SKILLS_DIR = path.dirname(getBundledSkillsPath());
    // Any existing dir set via env must be returned verbatim.
    expect(getBundledSkillsPath()).toBe(process.env.CODEBUDDY_BUNDLED_SKILLS_DIR);
  });
});
