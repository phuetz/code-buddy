import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildHermesSkillPackageSummary,
  deleteHermesSkillPackage,
  patchHermesSkillPackage,
  rollbackHermesSkillPackage,
  resetHermesSkillPackage,
  setHermesSkillPackageLifecycle,
  updateHermesSkillPackage,
} from '../../src/agent/hermes-skill-package-summary.js';
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
      health: {
        healthyCount: 2,
        integrityMismatchCount: 0,
        issueCount: 1,
        missingFileCount: 1,
        nextCommand: 'buddy skills doctor --json',
        ok: false,
        staleTempMissingCount: 1,
      },
      installedCount: 3,
      rollbackableCount: 1,
    });
    expect(summary.reviewCommands).toEqual([
      'buddy skills list --all --json',
      'buddy skills doctor --json',
      'buddy skills learning-usage --json',
      'buddy skills enable <name> --approved-by <reviewer>',
      'buddy skills disable <name> --approved-by <reviewer>',
      'buddy skills deprecate <name> --approved-by <reviewer>',
      'buddy skills delete <name> --approved-by <reviewer> --json',
      'buddy skills rollback <name> --approved-by <reviewer> --json',
      'buddy skills reset <name> --approved-by <reviewer> --json',
      'Use skill_manage with approved_by only for patch/update until CLI equivalents exist.',
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
        staleTempPath: true,
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

  it('applies review-gated lifecycle changes to the real workspace lockfile', async () => {
    const hub = new SkillsHub({
      cacheDir: path.join(tempDir, '.codebuddy', 'skills-cache'),
      lockfilePath: path.join(tempDir, '.codebuddy', 'skills-lock.json'),
      skillsDir: path.join(tempDir, '.codebuddy', 'skills'),
    });

    await hub.installFromContent(
      'lifecycle-helper',
      skillContent('lifecycle-helper', '1.0.0', 'Lifecycle-managed helper.'),
    );

    const disabled = setHermesSkillPackageLifecycle(
      tempDir,
      'lifecycle-helper',
      'disable',
      {
        actor: 'Patrice',
        reason: 'Pause for review.',
        updatedAt: 6_000,
      },
    );

    expect(disabled).toMatchObject({
      enabled: false,
      lastLifecycleReason: 'Pause for review.',
      lastLifecycleReviewer: 'Patrice',
      name: 'lifecycle-helper',
      status: 'disabled',
    });

    const deprecated = setHermesSkillPackageLifecycle(
      tempDir,
      'lifecycle-helper',
      'deprecate',
      {
        actor: 'Patrice',
        reason: 'Superseded by a reviewed skill.',
        updatedAt: 7_000,
      },
    );

    expect(deprecated).toMatchObject({
      enabled: false,
      lastLifecycleReason: 'Superseded by a reviewed skill.',
      lastLifecycleReviewer: 'Patrice',
      status: 'deprecated',
    });

    const enabled = setHermesSkillPackageLifecycle(
      tempDir,
      'lifecycle-helper',
      'enable',
      {
        actor: 'Patrice',
        reason: 'Review passed.',
        updatedAt: 8_000,
      },
    );

    expect(enabled).toMatchObject({
      enabled: true,
      lastLifecycleReason: 'Review passed.',
      lastLifecycleReviewer: 'Patrice',
      status: 'active',
    });

    const summary = buildHermesSkillPackageSummary(tempDir);
    expect(summary).toMatchObject({
      disabledCount: 0,
      enabledCount: 1,
      installedCount: 1,
    });
    expect(summary.packages[0]).toMatchObject({
      lastLifecycleReviewer: 'Patrice',
      name: 'lifecycle-helper',
      status: 'active',
    });
  });

  it('rolls back an installed skill from a real rollback snapshot', async () => {
    const hub = new SkillsHub({
      cacheDir: path.join(tempDir, '.codebuddy', 'skills-cache'),
      lockfilePath: path.join(tempDir, '.codebuddy', 'skills-lock.json'),
      skillsDir: path.join(tempDir, '.codebuddy', 'skills'),
    });

    await hub.installFromContent(
      'rollback-helper',
      skillContent('rollback-helper', '1.0.0', 'Original rollback wording.'),
    );
    hub.patchInstalledSkill(
      'rollback-helper',
      'Original rollback wording.',
      'Updated rollback wording.',
      {
        actor: 'Patrice',
        reason: 'Create rollback evidence.',
        updatedAt: 9_000,
      },
    );

    const installedPath = path.join(tempDir, '.codebuddy', 'skills', 'rollback-helper', 'SKILL.md');
    await expect(fs.readFile(installedPath, 'utf8')).resolves.toContain('Updated rollback wording.');

    const rolledBack = rollbackHermesSkillPackage(
      tempDir,
      'rollback-helper',
      {
        actor: 'Patrice',
        reason: 'Restore reviewed snapshot.',
        updatedAt: 10_000,
      },
    );

    expect(rolledBack).toMatchObject({
      lastLifecycleReason: 'Restore reviewed snapshot.',
      lastLifecycleReviewer: 'Patrice',
      name: 'rollback-helper',
      status: 'active',
    });
    await expect(fs.readFile(installedPath, 'utf8')).resolves.toContain('Original rollback wording.');

    const summary = buildHermesSkillPackageSummary(tempDir);
    expect(summary.packages[0]).toMatchObject({
      name: 'rollback-helper',
      rollbackableCount: 2,
    });
  });

  it('deletes an installed skill from the real workspace lockfile', async () => {
    const hub = new SkillsHub({
      cacheDir: path.join(tempDir, '.codebuddy', 'skills-cache'),
      lockfilePath: path.join(tempDir, '.codebuddy', 'skills-lock.json'),
      skillsDir: path.join(tempDir, '.codebuddy', 'skills'),
    });

    await hub.installFromContent(
      'delete-helper',
      skillContent('delete-helper', '1.0.0', 'Delete-reviewed helper.'),
    );
    const installedPath = path.join(tempDir, '.codebuddy', 'skills', 'delete-helper', 'SKILL.md');
    await expect(fs.readFile(installedPath, 'utf8')).resolves.toContain('Delete-reviewed helper.');

    await expect(deleteHermesSkillPackage(
      tempDir,
      'delete-helper',
      {
        actor: 'Patrice',
        reason: 'Remove obsolete reviewed skill.',
      },
    )).resolves.toBe(true);

    await expect(fs.readFile(installedPath, 'utf8')).rejects.toThrow();
    const summary = buildHermesSkillPackageSummary(tempDir);
    expect(summary).toMatchObject({
      disabledCount: 0,
      enabledCount: 0,
      installedCount: 0,
      rollbackableCount: 0,
    });
  });

  it('updates an installed skill from a real local hub cache entry', async () => {
    const hub = new SkillsHub({
      cacheDir: path.join(tempDir, '.codebuddy', 'skills-cache'),
      lockfilePath: path.join(tempDir, '.codebuddy', 'skills-lock.json'),
      skillsDir: path.join(tempDir, '.codebuddy', 'skills'),
    });

    await hub.installFromContent(
      'update-helper',
      skillContent('update-helper', '0.1.0', 'Original cached update wording.'),
    );
    const cachedUpdateContent = skillContent(
      'update-helper',
      '0.2.0',
      'Updated cached update wording.',
    );
    await fs.writeFile(
      path.join(tempDir, '.codebuddy', 'skills-cache', 'registry-cache.json'),
      `${JSON.stringify({
        skills: [{
          author: 'test',
          checksum: 'cached-update-helper',
          description: 'Updated update-helper test skill',
          downloads: 0,
          name: 'update-helper',
          size: Buffer.byteLength(cachedUpdateContent, 'utf8'),
          stars: 0,
          tags: ['hermes', 'skills'],
          updatedAt: '2026-05-30T18:30:00.000Z',
          version: '0.2.0',
        }],
      }, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(tempDir, '.codebuddy', 'skills-cache', 'update-helper@0.2.0.skill.md'),
      `${cachedUpdateContent.trimEnd()}\n`,
      'utf8',
    );

    const updated = await updateHermesSkillPackage(
      tempDir,
      'update-helper',
      {
        actor: 'Patrice',
        reason: 'Use reviewed cached update.',
        updatedAt: 11_000,
      },
    );

    expect(updated).toMatchObject({
      contentPreview: expect.stringContaining('Updated cached update wording.'),
      lastLifecycleReason: 'Use reviewed cached update.',
      lastLifecycleReviewer: 'Patrice',
      name: 'update-helper',
      rollbackableCount: 1,
      status: 'active',
      version: '0.2.0',
    });

    const installedPath = path.join(tempDir, '.codebuddy', 'skills', 'update-helper', 'SKILL.md');
    await expect(fs.readFile(installedPath, 'utf8')).resolves.toContain('Updated cached update wording.');
    const summary = buildHermesSkillPackageSummary(tempDir);
    expect(summary.packages[0]).toMatchObject({
      integrityOk: true,
      name: 'update-helper',
      version: '0.2.0',
    });
  });

  it('resets a tampered skill from a real local hub cache entry', async () => {
    const hub = new SkillsHub({
      cacheDir: path.join(tempDir, '.codebuddy', 'skills-cache'),
      lockfilePath: path.join(tempDir, '.codebuddy', 'skills-lock.json'),
      skillsDir: path.join(tempDir, '.codebuddy', 'skills'),
    });

    const canonicalContent = skillContent(
      'reset-helper',
      '0.1.0',
      'Canonical cached reset wording.',
    );
    await hub.installFromContent('reset-helper', canonicalContent);
    await fs.writeFile(
      path.join(tempDir, '.codebuddy', 'skills-cache', 'reset-helper@0.1.0.skill.md'),
      `${canonicalContent.trimEnd()}\n`,
      'utf8',
    );

    const installedPath = path.join(tempDir, '.codebuddy', 'skills', 'reset-helper', 'SKILL.md');
    await fs.writeFile(
      installedPath,
      `${skillContent('reset-helper', '0.1.0', 'Locally tampered reset wording.').trimEnd()}\n`,
      'utf8',
    );

    const reset = await resetHermesSkillPackage(
      tempDir,
      'reset-helper',
      {
        actor: 'Patrice',
        reason: 'Restore reviewed cache content.',
        updatedAt: 13_000,
      },
    );

    expect(reset).toMatchObject({
      contentPreview: expect.stringContaining('Canonical cached reset wording.'),
      integrityOk: true,
      lastLifecycleReason: 'Restore reviewed cache content.',
      lastLifecycleReviewer: 'Patrice',
      name: 'reset-helper',
      rollbackableCount: 1,
      status: 'active',
      version: '0.1.0',
    });
    await expect(fs.readFile(installedPath, 'utf8')).resolves.toContain('Canonical cached reset wording.');
    await expect(fs.readFile(installedPath, 'utf8')).resolves.not.toContain('Locally tampered reset wording.');

    const summary = buildHermesSkillPackageSummary(tempDir);
    expect(summary.packages[0]).toMatchObject({
      integrityOk: true,
      name: 'reset-helper',
      rollbackableCount: 1,
    });
  });

  it('patches an installed skill with a real SKILL.md snapshot', async () => {
    const hub = new SkillsHub({
      cacheDir: path.join(tempDir, '.codebuddy', 'skills-cache'),
      lockfilePath: path.join(tempDir, '.codebuddy', 'skills-lock.json'),
      skillsDir: path.join(tempDir, '.codebuddy', 'skills'),
    });

    await hub.installFromContent(
      'patch-helper',
      skillContent('patch-helper', '1.0.0', 'Original patch wording.'),
    );

    const patched = patchHermesSkillPackage(
      tempDir,
      'patch-helper',
      {
        actor: 'Patrice',
        expectedReplacements: 1,
        newText: 'Reviewed patch wording.',
        oldText: 'Original patch wording.',
        reason: 'Review exact SKILL.md wording.',
        updatedAt: 12_000,
      },
    );

    expect(patched).toMatchObject({
      contentPreview: expect.stringContaining('Reviewed patch wording.'),
      lastLifecycleReason: 'Review exact SKILL.md wording.',
      lastLifecycleReviewer: 'Patrice',
      name: 'patch-helper',
      rollbackableCount: 1,
      status: 'active',
    });

    const installedPath = path.join(tempDir, '.codebuddy', 'skills', 'patch-helper', 'SKILL.md');
    await expect(fs.readFile(installedPath, 'utf8')).resolves.toContain('Reviewed patch wording.');
    const summary = buildHermesSkillPackageSummary(tempDir);
    expect(summary.packages[0]).toMatchObject({
      integrityOk: true,
      name: 'patch-helper',
      rollbackableCount: 1,
    });
  });
});
