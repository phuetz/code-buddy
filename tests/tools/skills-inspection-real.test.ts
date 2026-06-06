import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildResearchScriptJobArtifact } from '../../src/agent/research-script-job-artifact.js';
import {
  buildResearchScriptSkillCandidate,
  materializeResearchScriptSkillCandidate,
} from '../../src/agent/research-script-skill-candidate.js';
import type { ResearchScriptJobRunResult } from '../../src/agent/research-script-job-runner.js';

let tempHome: string;
let tempWorkspace: string;
let originalCwd: string;

async function parseToolOutput(result: { success: boolean; output?: string; error?: string }) {
  expect(result.success, result.error).toBe(true);
  expect(result.output).toBeTruthy();
  return JSON.parse(result.output as string) as Record<string, unknown>;
}

function runResult(overrides: Partial<ResearchScriptJobRunResult> = {}): ResearchScriptJobRunResult {
  return {
    commandPreview: 'node script.js',
    durationMs: 25,
    exitCode: 0,
    jobId: 'research-skill-manage',
    outputPath: 'research-scripts/skill-manage/output.json',
    outputStatus: 'written',
    outputVerified: true,
    signal: null,
    status: 'completed',
    stderrPath: 'research-scripts/skill-manage/stderr.log',
    stdoutPath: 'research-scripts/skill-manage/stdout.log',
    summaryPath: 'research-scripts/skill-manage/summary.md',
    timedOut: false,
    ...overrides,
  };
}

describe('skills_list and skill_view real SkillsHub integration', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-skills-tools-'));
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-skill-manage-'));
    process.chdir(tempWorkspace);
  });

  afterEach(async () => {
    const { resetSkillsHub } = await import('../../src/skills/hub.js');
    process.chdir(originalCwd);
    resetSkillsHub();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(tempWorkspace, { recursive: true, force: true });
  });

  it('lists and reads installed SKILL.md packages from the real lockfile', async () => {
    const { getSkillsHub, resetSkillsHub } = await import('../../src/skills/hub.js');
    resetSkillsHub();
    const hub = getSkillsHub({
      cacheDir: path.join(tempHome, 'cache'),
      skillsDir: path.join(tempHome, 'skills'),
      lockfilePath: path.join(tempHome, 'lock.json'),
    });

    await hub.installFromContent(
      'audit-helper',
      [
        '---',
        'name: audit-helper',
        'version: 1.2.3',
        'description: Real audit helper skill',
        '---',
        '',
        '# Audit Helper',
        '',
        'Run concrete checks and report evidence.',
      ].join('\n'),
    );
    hub.setEnabled('disabled-helper', false, {
      path: path.join(tempHome, 'disabled-helper', 'SKILL.md'),
      version: '0.1.0',
    });

    const { createSkillsInspectionTools } = await import('../../src/tools/registry/skills-inspection-tools.js');
    const [listTool, viewTool, manageTool] = createSkillsInspectionTools();

    const enabledOnly = await parseToolOutput(await listTool!.execute({}));
    expect(enabledOnly.count).toBe(1);
    expect((enabledOnly.skills as Array<{ name: string }>).map((skill) => skill.name)).toEqual(['audit-helper']);

    const allSkills = await parseToolOutput(await listTool!.execute({ include_disabled: true }));
    expect(allSkills.count).toBe(2);
    expect(allSkills.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        exists: true,
        integrityOk: true,
        name: 'audit-helper',
      }),
      expect.objectContaining({
        enabled: false,
        exists: false,
        integrityOk: false,
        name: 'disabled-helper',
      }),
    ]));

    const viewed = await parseToolOutput(await viewTool!.execute({ name: 'audit-helper' }));
    expect((viewed.installed as { version: string }).version).toBe('1.2.3');
    expect(viewed.integrityOk).toBe(true);
    expect(viewed.content).toContain('# Audit Helper');

    const managedList = await parseToolOutput(await manageTool!.execute({ action: 'list', include_disabled: true }));
    expect(managedList.action).toBe('skills_list');
    expect(managedList.count).toBe(2);
    expect(managedList.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        exists: false,
        integrityOk: false,
        name: 'disabled-helper',
      }),
    ]));

    const managedView = await parseToolOutput(await manageTool!.execute({ action: 'view', name: 'audit-helper' }));
    expect(managedView.action).toBe('skill_view');
    expect(managedView.content).toContain('Run concrete checks and report evidence.');

    const missingDiscoverQuery = await manageTool!.execute({ action: 'discover' });
    expect(missingDiscoverQuery.success).toBe(false);
    expect(missingDiscoverQuery.error).toContain('query is required');

    const created = await manageTool!.execute({
      action: 'create',
      name: 'real-test-skill',
      description: 'Real skill_manage creation test',
      body: ['# Real Test Skill', '', 'Use this to verify real SKILL.md file creation.'].join('\n'),
      tags: ['hermes', 'test'],
    });
    expect(created.success, created.error).toBe(true);
    expect(created.output).toContain('Skill created');

    const createdFile = path.join(
      tempWorkspace,
      '.codebuddy',
      'skills',
      'workspace',
      'real-test-skill',
      'SKILL.md',
    );
    await expect(fs.readFile(createdFile, 'utf8')).resolves.toContain('Real Test Skill');

    const job = buildResearchScriptJobArtifact({
      id: 'research-skill-manage',
      goal: 'Promote a repeated real workflow through skill_manage.',
      title: 'Skill manage candidate',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: { network: 'disabled' },
    });
    const candidate = buildResearchScriptSkillCandidate(job, [
      runResult(),
      runResult({ durationMs: 50 }),
    ]);
    const materialized = await materializeResearchScriptSkillCandidate(candidate, {
      rootDir: tempWorkspace,
    });
    const candidateDir = path.dirname(materialized.skillPath);

    const candidateList = await parseToolOutput(await manageTool!.execute({ action: 'candidate_list' }));
    expect(candidateList.action).toBe('skill_manage_candidate_list');
    expect(candidateList.count).toBe(1);
    expect(candidateList.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gradedTasks: expect.arrayContaining([
          expect.objectContaining({
            command: 'node script.js',
            expected: 'pass',
            toolName: 'research_script',
          }),
        ]),
        installState: 'not-installed',
        proofSummary: expect.objectContaining({
          expected: 'pass',
          gradedTaskCount: 2,
          replayCommandCount: 1,
        }),
        replayCommands: ['node script.js'],
        reviewCommands: expect.arrayContaining([
          `skill_manage action=candidate_install candidate_path=${candidate.skillPath} approved_by=<reviewer>`,
        ]),
        skillName: 'research-skill-manage-candidate',
      }),
    ]));

    const candidateView = await parseToolOutput(await manageTool!.execute({
      action: 'candidate_view',
      candidate_path: candidateDir,
    }));
    expect(candidateView.action).toBe('skill_manage_candidate_view');
    expect(candidateView.candidate).toMatchObject({
      proofSummary: expect.objectContaining({
        gradedTaskCount: 2,
        latestReplayCommand: 'node script.js',
      }),
      replayCommands: ['node script.js'],
      installState: 'not-installed',
      skillName: 'research-skill-manage-candidate',
    });
    expect(candidateView.content).toContain('Status: eligible for human review');

    const installWithoutApproval = await manageTool!.execute({
      action: 'candidate_install',
      candidate_path: candidateDir,
    });
    expect(installWithoutApproval.success).toBe(false);
    expect(installWithoutApproval.error).toContain('approved_by is required');

    const installed = await parseToolOutput(await manageTool!.execute({
      action: 'candidate_install',
      approved_at: '2026-05-30T15:05:00.000Z',
      approved_by: 'Patrice',
      candidate_path: candidateDir,
    }));
    expect(installed.action).toBe('skill_manage_candidate_install');
    expect((installed.installed as { approvedBy: string }).approvedBy).toBe('Patrice');
    const installedSkillPath = path.join(
      tempWorkspace,
      '.codebuddy',
      'skills',
      'research-skill-manage-candidate',
      'SKILL.md',
    );
    const workspaceLock = JSON.parse(
      await fs.readFile(path.join(tempWorkspace, '.codebuddy', 'skills-lock.json'), 'utf8'),
    ) as { skills: Record<string, unknown> };
    expect(workspaceLock.skills).toHaveProperty('research-skill-manage-candidate');
    await expect(
      fs.readFile(
        path.join(tempWorkspace, '.codebuddy', 'skills', 'research-skill-manage-candidate', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toContain('- Approved by: Patrice');

    const visibleAfterInstall = await parseToolOutput(await manageTool!.execute({
      action: 'list',
      include_disabled: true,
    }));
    expect((visibleAfterInstall.skills as Array<{ name: string }>).map((skill) => skill.name)).toContain(
      'research-skill-manage-candidate',
    );

    const viewedAfterInstall = await parseToolOutput(await manageTool!.execute({
      action: 'view',
      name: 'research-skill-manage-candidate',
    }));
    expect(viewedAfterInstall.integrityOk).toBe(true);
    expect(viewedAfterInstall.content).toContain('- Approved by: Patrice');

    const candidateViewAfterInstall = await parseToolOutput(await manageTool!.execute({
      action: 'candidate_view',
      candidate_path: candidateDir,
    }));
    expect(candidateViewAfterInstall.candidate).toMatchObject({
      installState: 'installed-current',
      installedIntegrityOk: true,
      installedVersion: '0.1.0',
      skillName: 'research-skill-manage-candidate',
    });

    const historyWithoutName = await manageTool!.execute({ action: 'history' });
    expect(historyWithoutName.success).toBe(false);
    expect(historyWithoutName.error).toContain('name is required');

    const patchWithoutApproval = await manageTool!.execute({
      action: 'patch',
      name: 'research-skill-manage-candidate',
      old_text: '- Promote a repeated real workflow through skill_manage.',
      new_text: '- Promote a repeated Hermes lifecycle workflow through skill_manage.',
    });
    expect(patchWithoutApproval.success).toBe(false);
    expect(patchWithoutApproval.error).toContain('approved_by is required');

    const patched = await parseToolOutput(await manageTool!.execute({
      action: 'patch',
      approved_by: 'Patrice',
      expected_replacements: 1,
      name: 'research-skill-manage-candidate',
      old_text: '- Promote a repeated real workflow through skill_manage.',
      new_text: '- Promote a repeated Hermes lifecycle workflow through skill_manage.',
      reason: 'Refine the reviewed usage trigger.',
    }));
    expect(patched.action).toBe('skill_manage_patch');
    expect(patched.replacements).toBe(1);
    expect(patched.snapshot).toMatchObject({
      createdBy: 'Patrice',
      reason: 'Refine the reviewed usage trigger.',
    });

    const viewedAfterPatch = await parseToolOutput(await manageTool!.execute({
      action: 'view',
      name: 'research-skill-manage-candidate',
    }));
    expect(viewedAfterPatch.integrityOk).toBe(true);
    expect(viewedAfterPatch.content).toContain(
      '- Promote a repeated Hermes lifecycle workflow through skill_manage.',
    );

    const candidateViewAfterPatch = await parseToolOutput(await manageTool!.execute({
      action: 'candidate_view',
      candidate_path: candidateDir,
    }));
    expect(candidateViewAfterPatch.candidate).toMatchObject({
      installState: 'installed-different',
      skillName: 'research-skill-manage-candidate',
    });
    expect(candidateViewAfterPatch.candidate).toHaveProperty('candidateDiffPreview');
    expect(
      (candidateViewAfterPatch.candidate as {
        candidateDiffPreview: { preview: string };
      }).candidateDiffPreview.preview,
    ).toContain('+- Promote a repeated real workflow through skill_manage.');

    const rolledBack = await parseToolOutput(await manageTool!.execute({
      action: 'rollback',
      approved_by: 'Patrice',
      name: 'research-skill-manage-candidate',
      reason: 'Restore original reviewed wording.',
      snapshot_id: (patched.snapshot as { id: string }).id,
    }));
    expect(rolledBack.action).toBe('skill_manage_rollback');
    expect(rolledBack.restoredSnapshot).toMatchObject({
      id: (patched.snapshot as { id: string }).id,
    });

    const viewedAfterRollback = await parseToolOutput(await manageTool!.execute({
      action: 'view',
      name: 'research-skill-manage-candidate',
    }));
    expect(viewedAfterRollback.integrityOk).toBe(true);
    expect(viewedAfterRollback.content).toContain('- Promote a repeated real workflow through skill_manage.');
    expect(viewedAfterRollback.content).not.toContain(
      '- Promote a repeated Hermes lifecycle workflow through skill_manage.',
    );

    const editWithoutApproval = await manageTool!.execute({
      action: 'edit',
      content: `${viewedAfterRollback.content as string}\n## Official Hermes Edit\n\nFull rewrite alias tested.\n`,
      name: 'research-skill-manage-candidate',
    });
    expect(editWithoutApproval.success).toBe(false);
    expect(editWithoutApproval.error).toContain('approved_by is required');

    const edited = await parseToolOutput(await manageTool!.execute({
      action: 'edit',
      approved_by: 'Patrice',
      content: `${viewedAfterRollback.content as string}\n## Official Hermes Edit\n\nFull rewrite alias tested.\n`,
      name: 'research-skill-manage-candidate',
      reason: 'Exercise official Hermes edit action.',
    }));
    expect(edited.action).toBe('skill_manage_edit');
    expect(edited.snapshot).toMatchObject({
      createdBy: 'Patrice',
      reason: 'Exercise official Hermes edit action.',
    });

    const viewedAfterEdit = await parseToolOutput(await manageTool!.execute({
      action: 'view',
      name: 'research-skill-manage-candidate',
    }));
    expect(viewedAfterEdit.integrityOk).toBe(true);
    expect(viewedAfterEdit.content).toContain('Full rewrite alias tested.');

    const writeFileWithoutApproval = await manageTool!.execute({
      action: 'write_file',
      file_content: 'supporting note',
      file_path: 'references/hermes-note.md',
      name: 'research-skill-manage-candidate',
    });
    expect(writeFileWithoutApproval.success).toBe(false);
    expect(writeFileWithoutApproval.error).toContain('approved_by is required');

    const unsafeWrite = await manageTool!.execute({
      action: 'write_file',
      approved_by: 'Patrice',
      file_content: 'nope',
      file_path: '../outside.md',
      name: 'research-skill-manage-candidate',
    });
    expect(unsafeWrite.success).toBe(false);
    expect(unsafeWrite.error).toContain('Unsafe skill file path');

    const missingSupportingFilename = await manageTool!.execute({
      action: 'write_file',
      approved_by: 'Patrice',
      file_content: 'nope',
      file_path: 'references',
      name: 'research-skill-manage-candidate',
    });
    expect(missingSupportingFilename.success).toBe(false);
    expect(missingSupportingFilename.error).toContain('Use a file under references/');

    const writtenFile = await parseToolOutput(await manageTool!.execute({
      action: 'write_file',
      approved_by: 'Patrice',
      file_content: 'supporting note for Hermes skill files',
      file_path: 'references/hermes-note.md',
      name: 'research-skill-manage-candidate',
      reason: 'Exercise official Hermes write_file action.',
    }));
    expect(writtenFile.action).toBe('skill_manage_write_file');
    expect(writtenFile).toMatchObject({
      bytesWritten: 'supporting note for Hermes skill files'.length,
      filePath: 'references/hermes-note.md',
    });

    const supportFilePath = path.join(
      tempWorkspace,
      '.codebuddy',
      'skills',
      'research-skill-manage-candidate',
      'references',
      'hermes-note.md',
    );
    await expect(fs.readFile(supportFilePath, 'utf8')).resolves.toBe('supporting note for Hermes skill files');

    const patchedSupportFile = await parseToolOutput(await manageTool!.execute({
      action: 'patch',
      approved_by: 'Patrice',
      file_path: 'references/hermes-note.md',
      name: 'research-skill-manage-candidate',
      old_string: 'supporting note',
      new_string: 'supporting reference note',
      reason: 'Exercise official Hermes old_string/new_string patch aliases.',
    }));
    expect(patchedSupportFile).toMatchObject({
      action: 'skill_manage_patch',
      filePath: 'references/hermes-note.md',
      replacements: 1,
    });
    await expect(fs.readFile(supportFilePath, 'utf8')).resolves.toBe(
      'supporting reference note for Hermes skill files',
    );

    const removedFile = await parseToolOutput(await manageTool!.execute({
      action: 'remove_file',
      approved_by: 'Patrice',
      file_path: 'references/hermes-note.md',
      name: 'research-skill-manage-candidate',
      reason: 'Exercise official Hermes remove_file action.',
    }));
    expect(removedFile).toMatchObject({
      action: 'skill_manage_remove_file',
      filePath: 'references/hermes-note.md',
      removed: true,
    });
    await expect(fs.readFile(supportFilePath, 'utf8')).rejects.toThrow();

    const cachedUpdateContent = [
      '---',
      'name: research-skill-manage-candidate',
      'version: 0.2.0',
      'description: Updated real skill_manage candidate from local cache.',
      '---',
      '',
      '# Updated Skill Manage Candidate',
      '',
      'Updated cached hub workflow.',
      '',
      '## Human Approval',
      '- Approved by: Patrice',
      '',
    ].join('\n');
    await fs.writeFile(
      path.join(tempHome, 'cache', 'registry-cache.json'),
      `${JSON.stringify({
        skills: [{
          name: 'research-skill-manage-candidate',
          version: '0.2.0',
          description: 'Updated real skill_manage candidate from local cache.',
          author: 'test',
          tags: ['hermes', 'skill-manage'],
          downloads: 0,
          stars: 0,
          updatedAt: '2026-05-30T15:40:00.000Z',
          checksum: 'cached-update',
          size: Buffer.byteLength(cachedUpdateContent, 'utf8'),
        }],
      }, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(tempHome, 'cache', 'research-skill-manage-candidate@0.2.0.skill.md'),
      `${cachedUpdateContent.trimEnd()}\n`,
      'utf8',
    );

    const previewUpdate = await parseToolOutput(await manageTool!.execute({
      action: 'preview_update',
      name: 'research-skill-manage-candidate',
    }));
    expect(previewUpdate.action).toBe('skill_manage_preview_update');
    expect(previewUpdate).toMatchObject({
      fromVersion: '0.1.0',
      sameContent: false,
      toVersion: '0.2.0',
      updateAvailable: true,
    });
    expect((previewUpdate.diff as { preview: string }).preview).toContain('Updated cached hub workflow.');

    const updateWithoutApproval = await manageTool!.execute({
      action: 'update',
      name: 'research-skill-manage-candidate',
    });
    expect(updateWithoutApproval.success).toBe(false);
    expect(updateWithoutApproval.error).toContain('approved_by is required');

    const updated = await parseToolOutput(await manageTool!.execute({
      action: 'update',
      approved_by: 'Patrice',
      name: 'research-skill-manage-candidate',
      reason: 'Use reviewed cached hub update.',
    }));
    expect(updated.action).toBe('skill_manage_update');
    expect(updated).toMatchObject({
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      snapshot: {
        createdBy: 'Patrice',
        reason: 'Use reviewed cached hub update.',
      },
    });

    const viewedAfterUpdate = await parseToolOutput(await manageTool!.execute({
      action: 'view',
      name: 'research-skill-manage-candidate',
    }));
    expect((viewedAfterUpdate.installed as { version: string }).version).toBe('0.2.0');
    expect(viewedAfterUpdate.integrityOk).toBe(true);
    expect(viewedAfterUpdate.content).toContain('Updated cached hub workflow.');

    const tamperedUpdateContent = cachedUpdateContent.replace('Updated cached hub workflow.', 'Locally tampered workflow.');
    await fs.writeFile(installedSkillPath, `${tamperedUpdateContent.trimEnd()}\n`, 'utf8');
    const resetWithoutApproval = await manageTool!.execute({
      action: 'reset',
      name: 'research-skill-manage-candidate',
    });
    expect(resetWithoutApproval.success).toBe(false);
    expect(resetWithoutApproval.error).toContain('approved_by is required');

    const reset = await parseToolOutput(await manageTool!.execute({
      action: 'reset',
      approved_by: 'Patrice',
      name: 'research-skill-manage-candidate',
      reason: 'Restore cached hub content.',
    }));
    expect(reset.action).toBe('skill_manage_reset');
    expect(reset).toMatchObject({
      fromVersion: '0.2.0',
      recreated: false,
      toVersion: '0.2.0',
      snapshot: {
        createdBy: 'Patrice',
        reason: 'Restore cached hub content.',
      },
    });

    const viewedAfterReset = await parseToolOutput(await manageTool!.execute({
      action: 'view',
      name: 'research-skill-manage-candidate',
    }));
    expect(viewedAfterReset.integrityOk).toBe(true);
    expect(viewedAfterReset.content).toContain('Updated cached hub workflow.');
    expect(viewedAfterReset.content).not.toContain('Locally tampered workflow.');

    const history = await parseToolOutput(await manageTool!.execute({
      action: 'history',
      name: 'research-skill-manage-candidate',
    }));
    expect(history.action).toBe('skill_manage_history');
    expect(history.current).toMatchObject({
      enabled: true,
      exists: true,
      integrityOk: true,
      version: '0.2.0',
    });
    expect(history.rollbackableCount).toBeGreaterThanOrEqual(3);
    expect(history.missingSnapshotCount).toBe(0);
    const historySnapshots = history.snapshots as Array<{
      createdAt: number;
      id: string;
      rollbackable: boolean;
      snapshotExists: boolean;
      snapshotIntegrityOk: boolean;
      sizeBytes?: number;
    }>;
    expect(historySnapshots.map((snapshot) => snapshot.id)).toEqual(expect.arrayContaining([
      (patched.snapshot as { id: string }).id,
      (rolledBack.currentSnapshot as { id: string }).id,
      (updated.snapshot as { id: string }).id,
    ]));
    expect(historySnapshots.every((snapshot) => snapshot.rollbackable)).toBe(true);
    expect(historySnapshots.every((snapshot) => snapshot.snapshotExists)).toBe(true);
    expect(historySnapshots.every((snapshot) => snapshot.snapshotIntegrityOk)).toBe(true);
    expect(historySnapshots.every((snapshot) => typeof snapshot.sizeBytes === 'number' && snapshot.sizeBytes > 0))
      .toBe(true);
    expect(historySnapshots[0]!.createdAt).toBeGreaterThanOrEqual(
      historySnapshots[historySnapshots.length - 1]!.createdAt,
    );

    const { listLearningSkillUsage } = await import('../../src/agent/learning-agent.js');
    const learningUsage = listLearningSkillUsage(tempWorkspace).find(
      (skill) => skill.skillName === 'research-skill-manage-candidate',
    );
    expect(learningUsage).toMatchObject({
      lastMutation: {
        action: 'reset',
        approvedBy: 'Patrice',
        rollbackSnapshotId: (reset.snapshot as { id: string }).id,
        success: true,
      },
      mutationCount: 9,
      skillName: 'research-skill-manage-candidate',
    });
    expect(learningUsage?.mutationHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'patch',
        approvedBy: 'Patrice',
        rollbackSnapshotId: (patched.snapshot as { id: string }).id,
        success: true,
      }),
      expect.objectContaining({
        action: 'rollback',
        approvedBy: 'Patrice',
        currentSnapshotId: (rolledBack.currentSnapshot as { id: string }).id,
        restoredSnapshotId: (rolledBack.restoredSnapshot as { id: string }).id,
        success: true,
      }),
      expect.objectContaining({
        action: 'update',
        approvedBy: 'Patrice',
        rollbackSnapshotId: (updated.snapshot as { id: string }).id,
        success: true,
      }),
    ]));

    const deprecateWithoutApproval = await manageTool!.execute({
      action: 'deprecate',
      name: 'research-skill-manage-candidate',
    });
    expect(deprecateWithoutApproval.success).toBe(false);
    expect(deprecateWithoutApproval.error).toContain('approved_by is required');

    const deprecated = await parseToolOutput(await manageTool!.execute({
      action: 'deprecate',
      approved_by: 'Patrice',
      name: 'research-skill-manage-candidate',
      reason: 'Superseded by a broader workflow.',
    }));
    expect(deprecated.action).toBe('skill_manage_deprecate');
    expect(deprecated.installed).toMatchObject({
      name: 'research-skill-manage-candidate',
      enabled: false,
      lifecycle: {
        status: 'deprecated',
        updatedBy: 'Patrice',
        reason: 'Superseded by a broader workflow.',
      },
    });

    const hiddenAfterDeprecate = await parseToolOutput(await manageTool!.execute({ action: 'list' }));
    expect((hiddenAfterDeprecate.skills as Array<{ name: string }>).map((skill) => skill.name)).not.toContain(
      'research-skill-manage-candidate',
    );

    const enabledAgain = await parseToolOutput(await manageTool!.execute({
      action: 'enable',
      approved_by: 'Patrice',
      name: 'research-skill-manage-candidate',
      reason: 'Rollback deprecation after review.',
    }));
    expect(enabledAgain.installed).toMatchObject({
      name: 'research-skill-manage-candidate',
      enabled: true,
      lifecycle: {
        status: 'active',
        updatedBy: 'Patrice',
        reason: 'Rollback deprecation after review.',
      },
    });

    const deleted = await parseToolOutput(await manageTool!.execute({
      action: 'delete',
      approved_by: 'Patrice',
      name: 'research-skill-manage-candidate',
      reason: 'Retire test candidate.',
    }));
    expect(deleted.action).toBe('skill_manage_delete');
    expect(deleted.removed).toBe(true);

    const viewDeleted = await manageTool!.execute({
      action: 'view',
      name: 'research-skill-manage-candidate',
    });
    expect(viewDeleted.success).toBe(false);
    expect(viewDeleted.error).toContain('skill not found');

    await expect(
      fs.readFile(
        path.join(tempWorkspace, '.codebuddy', 'skills', 'research-skill-manage-candidate', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toContain('- Approved by: Patrice');
  });
});
