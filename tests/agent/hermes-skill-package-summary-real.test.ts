import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildHermesSkillPackageSummary } from '../../src/agent/hermes-skill-package-summary.js';
import { SkillsHub } from '../../src/skills/hub.js';

let tempDir: string;

function skillContent(name: string, version: string, body: string): string {
  return [
    '---',
    `name: ${name}`,
    `version: ${version}`,
    `description: ${name} test skill`,
    '---',
    '',
    `# ${name}`,
    '',
    body,
  ].join('\n');
}

describe('Hermes skill package summary on real SkillsHub lockfiles', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-skill-package-summary-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('summarizes installed skills, lifecycle state, usage and rollback snapshots', async () => {
    const hub = new SkillsHub({
      cacheDir: path.join(tempDir, '.codebuddy', 'skills-cache'),
      lockfilePath: path.join(tempDir, '.codebuddy', 'skills-lock.json'),
      skillsDir: path.join(tempDir, '.codebuddy', 'skills'),
    });

    await hub.installFromContent(
      'audit-helper',
      skillContent('audit-helper', '1.0.0', 'Run real checks before reporting.'),
    );
    await hub.installFromContent(
      'disabled-helper',
      skillContent('disabled-helper', '1.0.0', 'Temporarily disabled helper.'),
    );
    await hub.installFromContent(
      'deprecated-helper',
      skillContent('deprecated-helper', '1.0.0', 'Deprecated helper.'),
    );

    hub.recordUsage('audit-helper', { success: true, durationMs: 40, usedAt: 1_000 });
    hub.recordUsage('audit-helper', {
      error: 'real verification failed',
      success: false,
      usedAt: 2_000,
    });
    hub.patchInstalledSkill(
      'audit-helper',
      'Run real checks before reporting.',
      'Run real checks and capture evidence before reporting.',
      {
        actor: 'Patrice',
        reason: 'Strengthen verification wording.',
        updatedAt: 3_000,
      },
    );
    hub.setEnabled('disabled-helper', false, {
      actor: 'Patrice',
      reason: 'Paused during review.',
      updatedAt: 4_000,
    });
    hub.setEnabled('deprecated-helper', false, {
      actor: 'Patrice',
      reason: 'Superseded by audit-helper.',
      status: 'deprecated',
      updatedAt: 5_000,
    });
    await fs.rm(path.join(tempDir, '.codebuddy', 'skills', 'disabled-helper', 'SKILL.md'), {
      force: true,
    });

    const summary = buildHermesSkillPackageSummary(tempDir, { previewChars: 80 });

    expect(summary).toMatchObject({
      disabledCount: 2,
      enabledCount: 1,
      installedCount: 3,
      rollbackableCount: 1,
    });
    expect(summary.reviewCommands).toEqual([
      'buddy skills list --all --json',
      'buddy skills doctor --json',
      'buddy skills learning-usage --json',
      'Use skill_manage with approved_by for enable/disable/deprecate/patch/rollback/update.',
    ]);
    expect(summary.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentPreview: expect.stringContaining('Run real checks and capture evidence'),
        exists: true,
        failureCount: 1,
        integrityOk: true,
        invocationCount: 2,
        lastError: 'real verification failed',
        name: 'audit-helper',
        rollbackableCount: 1,
        status: 'active',
        successCount: 1,
      }),
      expect.objectContaining({
        enabled: false,
        exists: false,
        integrityOk: false,
        lastLifecycleReason: 'Paused during review.',
        lastLifecycleReviewer: 'Patrice',
        name: 'disabled-helper',
        status: 'disabled',
      }),
      expect.objectContaining({
        enabled: false,
        lastLifecycleReason: 'Superseded by audit-helper.',
        lastLifecycleReviewer: 'Patrice',
        name: 'deprecated-helper',
        status: 'deprecated',
      }),
    ]));
    expect(summary.packages[0]?.status).toBe('deprecated');
  });
});
