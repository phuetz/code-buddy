/**
 * P2 — skill activity telemetry: real files in temp dirs, real child processes
 * for concurrency, real skill_view tool executor.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from '../../src/utils/logger.js';
import {
  listSkillActivity,
  readSkillActivity,
  recordSkillActivity,
  resetSkillActivityWarningForTests,
} from '../../src/skills/skill-usage-store.js';
import { SkillExecutor } from '../../src/skills/executor.js';
import type { Skill } from '../../src/skills/types.js';

const repoRoot = path.resolve(__dirname, '..', '..');

describe('skill activity store', () => {
  let dir: string;
  let previousDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-usage-'));
    previousDir = process.env.CODEBUDDY_SKILL_USAGE_DIR;
    process.env.CODEBUDDY_SKILL_USAGE_DIR = dir;
    resetSkillActivityWarningForTests();
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(() => {
    if (previousDir === undefined) delete process.env.CODEBUDDY_SKILL_USAGE_DIR;
    else process.env.CODEBUDDY_SKILL_USAGE_DIR = previousDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('aggregates views and uses with last activity', () => {
    recordSkillActivity('qa-repo-check', 'view', { now: new Date('2026-09-10T10:00:00Z') });
    recordSkillActivity('qa-repo-check', 'use', { now: new Date('2026-09-12T10:00:00Z') });
    recordSkillActivity('other', 'view', { now: new Date('2026-09-11T10:00:00Z') });
    const summary = readSkillActivity().get('qa-repo-check');
    expect(summary).toMatchObject({ viewCount: 1, useCount: 1, lastActivityAt: '2026-09-12T10:00:00.000Z' });
    expect(listSkillActivity().map((s) => s.skill)).toEqual(['qa-repo-check', 'other']);
    const mode = fs.statSync(path.join(dir, 'events.jsonl')).mode & 0o777;
    if (process.platform !== 'win32') expect(mode).toBe(0o600);
  });

  it('ignores truncated or foreign lines without rewriting the log', () => {
    recordSkillActivity('a', 'view');
    fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"v":1,"skill":"a","kind":"vi');
    fs.appendFileSync(path.join(dir, 'events.jsonl'), '\n{"v":2,"skill":"a","kind":"view","at":"x"}\n');
    const before = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8');
    expect(readSkillActivity().get('a')?.viewCount).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8')).toBe(before);
  });

  it('two concurrent processes never lose an increment', async () => {
    const script = path.join(dir, 'writer.ts');
    const storeModule = path.join(repoRoot, 'src', 'skills', 'skill-usage-store.ts');
    fs.writeFileSync(script, `import { recordSkillActivity } from ${JSON.stringify(storeModule)};\nfor (let i = 0; i < 250; i++) recordSkillActivity('shared-skill', 'use');\n`);
    const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const run = () => new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [tsx, script], { env: { ...process.env, CODEBUDDY_SKILL_USAGE_DIR: dir }, stdio: 'ignore' });
      child.on('close', (code) => resolve(code ?? 1));
    });
    expect(await Promise.all([run(), run()])).toEqual([0, 0]);
    expect(readSkillActivity().get('shared-skill')?.useCount).toBe(500);
    const lines = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n');
    expect(lines.every((line) => JSON.parse(line).skill === 'shared-skill')).toBe(true);
  }, 60_000);

  it('unwritable store: skill_view still succeeds and warns once', async () => {
    const blocker = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocker, 'file blocks mkdir');
    process.env.CODEBUDDY_SKILL_USAGE_DIR = path.join(blocker, 'nested');
    const hubModule = await import('../../src/skills/hub.js');
    const info = vi.spyOn(hubModule.SkillsHub.prototype, 'info').mockReturnValue({
      installed: { name: 'qa-repo-check' },
      integrityOk: true,
      content: '---\nname: qa-repo-check\n---\nbody',
    } as never);
    try {
      const { executeSkillViewTool } = await import('../../src/tools/skills-inspection-tool.js');
      const first = await executeSkillViewTool({ name: 'qa-repo-check' });
      const second = await executeSkillViewTool({ name: 'qa-repo-check' });
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
    } finally {
      info.mockRestore();
    }
  });

  it('skill_view records views and never modifies SKILL.md', async () => {
    const skillFile = path.join(dir, 'SKILL.md');
    fs.writeFileSync(skillFile, '---\nname: qa-repo-check\ndescription: fixture\n---\nCount markers.\n');
    const hash = () => createHash('sha256').update(fs.readFileSync(skillFile)).digest('hex');
    const before = hash();
    const hubModule = await import('../../src/skills/hub.js');
    const info = vi.spyOn(hubModule.SkillsHub.prototype, 'info').mockImplementation(() => ({
      installed: { name: 'qa-repo-check', path: skillFile },
      integrityOk: true,
      content: fs.readFileSync(skillFile, 'utf8'),
    }) as never);
    try {
      const { executeSkillViewTool } = await import('../../src/tools/skills-inspection-tool.js');
      await executeSkillViewTool({ name: 'qa-repo-check' });
      await executeSkillViewTool({ name: 'qa-repo-check', include_content: false });
    } finally {
      info.mockRestore();
    }
    expect(readSkillActivity().get('qa-repo-check')).toMatchObject({ viewCount: 2, useCount: 0 });
    expect(hash()).toBe(before);
  });

  it('SkillExecutor records a use for every execution', async () => {
    const skill = {
      metadata: { name: 'guidance-only', description: 'fixture' },
      content: { description: 'Do the thing', rawMarkdown: 'Do the thing' },
      sourcePath: path.join(dir, 'SKILL.md'),
      tier: 'workspace',
      loadedAt: new Date(),
      enabled: true,
    } as unknown as Skill;
    const executor = new SkillExecutor();
    const result = await executor.execute(skill, { request: 'go', cwd: dir } as never);
    expect(result.success).toBe(true);
    expect(readSkillActivity().get('guidance-only')?.useCount).toBe(1);
  });
});
