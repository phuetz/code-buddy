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

    const viewed = await parseToolOutput(await viewTool!.execute({ name: 'audit-helper' }));
    expect((viewed.installed as { version: string }).version).toBe('1.2.3');
    expect(viewed.integrityOk).toBe(true);
    expect(viewed.content).toContain('# Audit Helper');

    const managedList = await parseToolOutput(await manageTool!.execute({ action: 'list', include_disabled: true }));
    expect(managedList.action).toBe('skills_list');
    expect(managedList.count).toBe(2);

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

    const candidateView = await parseToolOutput(await manageTool!.execute({
      action: 'candidate_view',
      candidate_path: candidateDir,
    }));
    expect(candidateView.action).toBe('skill_manage_candidate_view');
    expect((candidateView.candidate as { skillName: string }).skillName).toBe('research-skill-manage-candidate');
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
    await expect(
      fs.readFile(
        path.join(tempWorkspace, '.codebuddy', 'skills', 'research-skill-manage-candidate', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toContain('- Approved by: Patrice');
  });
});
