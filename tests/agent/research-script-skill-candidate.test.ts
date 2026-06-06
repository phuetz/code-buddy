import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildResearchScriptJobArtifact } from '../../src/agent/research-script-job-artifact.js';
import {
  buildResearchScriptSkillCandidate,
  installResearchScriptSkillCandidate,
  listMaterializedResearchScriptSkillCandidates,
  listMaterializedResearchScriptSkillCandidatesWithInstallState,
  materializeResearchScriptSkillCandidate,
} from '../../src/agent/research-script-skill-candidate.js';
import type { ResearchScriptJobRunResult } from '../../src/agent/research-script-job-runner.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { getSkillsHub, resetSkillsHub, SkillsHub } from '../../src/skills/hub.js';

let tempHubDir: string;

function runResult(overrides: Partial<ResearchScriptJobRunResult> = {}): ResearchScriptJobRunResult {
  return {
    commandPreview: 'node script.js',
    durationMs: 25,
    exitCode: 0,
    jobId: 'research-script-demo',
    outputPath: 'research-scripts/demo/output.json',
    outputStatus: 'written',
    outputVerified: true,
    signal: null,
    status: 'completed',
    stderrPath: 'research-scripts/demo/stderr.log',
    stdoutPath: 'research-scripts/demo/stdout.log',
    summaryPath: 'research-scripts/demo/summary.md',
    timedOut: false,
    ...overrides,
  };
}

describe('research script skill candidate', () => {
  beforeEach(async () => {
    resetSkillsHub();
    tempHubDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-skill-hub-'));
    getSkillsHub({
      cacheDir: path.join(tempHubDir, 'cache'),
      skillsDir: path.join(tempHubDir, 'skills'),
      lockfilePath: path.join(tempHubDir, 'lock.json'),
    });
  });

  afterEach(async () => {
    resetSkillsHub();
    await fs.rm(tempHubDir, { recursive: true, force: true });
  });

  it('builds an eligible SKILL.md candidate after repeated successful runs', () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-demo',
      goal: 'Find public architect contact details with evidence.',
      title: 'Architect public enrichment',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input leads.' },
      outputContract: { OUTPUT_JSON: 'Enriched leads.' },
      sandboxPolicy: {
        network: 'disabled',
      },
    });

    const candidate = buildResearchScriptSkillCandidate(job, [
      runResult(),
      runResult({ durationMs: 40 }),
    ]);

    expect(candidate).toMatchObject({
      eligible: true,
      gradedTasks: expect.arrayContaining([
        expect.objectContaining({
          command: 'node script.js',
          expected: 'pass',
          sourceJobId: job.id,
          toolName: 'research_script',
        }),
      ]),
      skillName: 'research-architect-public-enrichment',
      skillPath: '.codebuddy/skill-candidates/research-architect-public-enrichment/SKILL.md',
      sourceJobId: job.id,
      successfulRunCount: 2,
    });
    expect(candidate.markdown).toContain('name: research-architect-public-enrichment');
    expect(candidate.markdown).toContain('version: 0.1.0');
    expect(candidate.markdown).toContain('tags: [research-script, generated-candidate, public-data]');
    expect(candidate.markdown).toContain('Status: eligible for human review');
    expect(candidate.markdown).toContain('Find public architect contact details with evidence.');
    expect(candidate.markdown).toContain('The workflow would send emails');
    expect(candidate.markdown).toContain('Preserve the no-contact-action assertion');
  });

  it('keeps a script as not eligible until it proves repeatable', () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-single',
      goal: 'Single run only.',
      title: 'Single run',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: {
        network: 'disabled',
      },
    });

    const candidate = buildResearchScriptSkillCandidate(job, [
      runResult({ jobId: job.id }),
      runResult({ jobId: job.id, status: 'failed', exitCode: 1 }),
    ]);

    expect(candidate.eligible).toBe(false);
    expect(candidate.reason).toContain('1/2 successful runs');
    expect(candidate.markdown).toContain('Status: not eligible yet');
  });

  it('does not promote completed runs whose output artifact was not verified', () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-placeholder-output',
      goal: 'Avoid promoting placeholder output.',
      title: 'Placeholder output',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
      sandboxPolicy: {
        network: 'disabled',
      },
    });

    const candidate = buildResearchScriptSkillCandidate(job, [
      runResult({ jobId: job.id, outputStatus: 'placeholder', outputVerified: false }),
      runResult({ jobId: job.id, outputStatus: 'missing', outputVerified: false }),
    ]);

    expect(candidate.eligible).toBe(false);
    expect(candidate.successfulRunCount).toBe(0);
    expect(candidate.reason).toContain('0/2 successful runs');
  });

  it('materializes a review manifest beside the SKILL.md candidate', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-skill-candidate-'));
    try {
      const job = buildResearchScriptJobArtifact({
        id: 'research-script-materialize',
        goal: 'Materialize a public workflow candidate.',
        title: 'Materialized workflow',
        language: 'javascript',
        inputContract: { INPUT_JSON: 'Input.' },
        outputContract: { OUTPUT_JSON: 'Output.' },
        sandboxPolicy: {
          network: 'disabled',
        },
      });
      const candidate = buildResearchScriptSkillCandidate(job, [
        runResult({ jobId: job.id }),
        runResult({ jobId: job.id }),
      ]);

      const materialized = await materializeResearchScriptSkillCandidate(candidate, {
        generatedAt: '2026-05-18T17:40:00.000Z',
        rootDir,
      });

      expect(materialized).toMatchObject({
        candidateId: candidate.id,
        eligible: true,
        reviewManifestPath: '.codebuddy/skill-candidates/research-materialized-workflow/candidate-review.json',
        skillName: 'research-materialized-workflow',
        skillPath: '.codebuddy/skill-candidates/research-materialized-workflow/SKILL.md',
      });
      await expect(fs.readFile(materialized.absoluteSkillPath, 'utf8')).resolves.toContain(
        'Status: eligible for human review',
      );
      const reviewManifest = JSON.parse(
        await fs.readFile(materialized.absoluteReviewManifestPath, 'utf8'),
      ) as { approvalRequired: boolean; gradedTasks?: Array<{ command: string }>; status: string; generatedAt: string };
      expect(reviewManifest).toMatchObject({
        approvalRequired: true,
        generatedAt: '2026-05-18T17:40:00.000Z',
        gradedTasks: expect.arrayContaining([
          expect.objectContaining({
            command: 'node script.js',
          }),
        ]),
        status: 'awaiting_human_approval',
      });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('preserves Learning Agent proof commands when listing materialized candidates', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-skill-proof-commands-'));
    try {
      const candidateDir = path.join(
        rootDir,
        '.codebuddy',
        'skill-candidates',
        'learning',
        'learned-search-view-file-bash',
      );
      await fs.mkdir(candidateDir, { recursive: true });
      await fs.writeFile(
        path.join(candidateDir, 'SKILL.md'),
        [
          '---',
          'name: learned-search-view-file-bash',
          'description: Learning Agent candidate.',
          '---',
          '',
          '# Learned Search View File Bash',
          '',
          'Reason: 2/2 proof-backed successful run(s) met the Learning Agent promotion threshold.',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        path.join(candidateDir, 'candidate-review.json'),
        `${JSON.stringify({
          approvalRequired: true,
          candidateId: 'learning-skill-proof',
          eligible: true,
          evidenceRunIds: ['run-one', 'run-two'],
          generatedAt: '2026-06-06T12:00:00.000Z',
          gradedTasks: [
            {
              command: 'npm test -- tests/agent/learning-agent-real.test.ts --run',
              expected: 'pass',
              id: 'graded-learning-proof',
              isTest: true,
              sourceRunId: 'run-two',
              timeoutMs: 30000,
              toolName: 'bash',
            },
          ],
          promotionThreshold: 2,
          proofBackedSuccessCount: 2,
          proofCommands: [
            {
              command: 'npm test -- tests/agent/learning-agent-real.test.ts --run',
              durationMs: 100,
              isTest: true,
              runId: 'run-two',
              sequence: 5,
              success: true,
              toolName: 'bash',
            },
          ],
          proofStatus: 'proven',
          schemaVersion: 1,
          skillName: 'learned-search-view-file-bash',
          sourceRunId: 'run-two',
          status: 'awaiting_human_approval',
          successfulRunCount: 2,
          toolSequence: ['search', 'view_file', 'bash'],
        }, null, 2)}\n`,
        'utf8',
      );

      const candidates = await listMaterializedResearchScriptSkillCandidates({ rootDir });

      expect(candidates).toEqual([
        expect.objectContaining({
          eligible: true,
          kind: 'learning',
          gradedTasks: [
            expect.objectContaining({
              command: 'npm test -- tests/agent/learning-agent-real.test.ts --run',
              expected: 'pass',
              sourceRunId: 'run-two',
              toolName: 'bash',
            }),
          ],
          proofBackedSuccessCount: 2,
          proofCommands: [
            expect.objectContaining({
              command: 'npm test -- tests/agent/learning-agent-real.test.ts --run',
              durationMs: 100,
              runId: 'run-two',
              success: true,
              toolName: 'bash',
            }),
          ],
          proofStatus: 'proven',
          skillName: 'learned-search-view-file-bash',
        }),
      ]);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('requires explicit approval before installing an eligible candidate as a workspace skill', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-skill-install-'));
    try {
      const job = buildResearchScriptJobArtifact({
        id: 'research-script-install',
        goal: 'Install a reviewed public workflow.',
        title: 'Reviewed workflow',
        language: 'javascript',
        inputContract: { INPUT_JSON: 'Input.' },
        outputContract: { OUTPUT_JSON: 'Output.' },
        sandboxPolicy: {
          network: 'disabled',
        },
      });
      const candidate = buildResearchScriptSkillCandidate(job, [
        runResult({ jobId: job.id }),
        runResult({ jobId: job.id }),
      ]);
      const materialized = await materializeResearchScriptSkillCandidate(candidate, { rootDir });
      await fs.writeFile(
        materialized.absoluteSkillPath,
        `${candidate.markdown.trimEnd()}\n\n## Reviewer Edit\n- Preserve this edit in the installed skill.\n`,
        'utf8',
      );

      await expect(
        installResearchScriptSkillCandidate(candidate, { rootDir }),
      ).rejects.toThrow('Human approval is required');

      const installed = await installResearchScriptSkillCandidate(candidate, {
        approvedAt: '2026-05-18T17:45:00.000Z',
        approvedBy: 'Patrice',
        rootDir,
      });

      expect(installed).toMatchObject({
        approvedAt: '2026-05-18T17:45:00.000Z',
        approvedBy: 'Patrice',
        installedPath: '.codebuddy/skills/research-reviewed-workflow/SKILL.md',
        skillName: 'research-reviewed-workflow',
        sourceCandidatePath: candidate.skillPath,
      });
      const installedMarkdown = await fs.readFile(installed.absoluteInstalledPath, 'utf8');
      expect(installedMarkdown).toContain('## Reviewer Edit');
      expect(installedMarkdown).toContain('## Human Approval');
      expect(installedMarkdown).toContain('- Approved by: Patrice');
      expect(getSkillsHub().info(candidate.skillName)).toMatchObject({
        integrityOk: true,
        installed: {
          name: candidate.skillName,
          path: installed.absoluteInstalledPath,
        },
      });

      const registry = new SkillRegistry({
        bundledPath: '',
        cacheEnabled: false,
        managedPath: '',
        watchEnabled: false,
        workspacePath: path.join(rootDir, '.codebuddy', 'skills'),
      });
      await registry.load();
      expect(registry.get(candidate.skillName)?.sourcePath).toBe(installed.absoluteInstalledPath);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('lists materialized candidates in a stable review order', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-skill-list-'));
    try {
      const alphaJob = buildResearchScriptJobArtifact({
        id: 'research-script-alpha',
        goal: 'Review alpha workflow.',
        title: 'Alpha workflow',
        language: 'javascript',
        inputContract: { INPUT_JSON: 'Input.' },
        outputContract: { OUTPUT_JSON: 'Output.' },
        sandboxPolicy: {
          network: 'disabled',
        },
      });
      const zuluJob = buildResearchScriptJobArtifact({
        id: 'research-script-zulu',
        goal: 'Review zulu workflow.',
        title: 'Zulu workflow',
        language: 'javascript',
        inputContract: { INPUT_JSON: 'Input.' },
        outputContract: { OUTPUT_JSON: 'Output.' },
        sandboxPolicy: {
          network: 'disabled',
        },
      });

      await materializeResearchScriptSkillCandidate(
        buildResearchScriptSkillCandidate(zuluJob, [
          runResult({ jobId: zuluJob.id }),
          runResult({ jobId: zuluJob.id }),
        ]),
        { rootDir },
      );
      await materializeResearchScriptSkillCandidate(
        buildResearchScriptSkillCandidate(alphaJob, [
          runResult({ jobId: alphaJob.id }),
        ]),
        { rootDir },
      );

      const candidates = await listMaterializedResearchScriptSkillCandidates({ rootDir });

      expect(candidates.map((candidate) => candidate.skillName)).toEqual([
        'research-alpha-workflow',
        'research-zulu-workflow',
      ]);
      expect(candidates.map((candidate) => candidate.eligible)).toEqual([false, true]);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('compares materialized candidates with real installed workspace skills', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-skill-install-state-'));
    try {
      const currentJob = buildResearchScriptJobArtifact({
        id: 'research-script-current',
        goal: 'Keep current workflow installed.',
        title: 'Current workflow',
        language: 'javascript',
        inputContract: { INPUT_JSON: 'Input.' },
        outputContract: { OUTPUT_JSON: 'Output.' },
        sandboxPolicy: {
          network: 'disabled',
        },
      });
      const changedJob = buildResearchScriptJobArtifact({
        id: 'research-script-changed',
        goal: 'Review changed workflow.',
        title: 'Changed workflow',
        language: 'javascript',
        inputContract: { INPUT_JSON: 'Input.' },
        outputContract: { OUTPUT_JSON: 'Output.' },
        sandboxPolicy: {
          network: 'disabled',
        },
      });
      const newJob = buildResearchScriptJobArtifact({
        id: 'research-script-new',
        goal: 'Review new workflow.',
        title: 'New workflow',
        language: 'javascript',
        inputContract: { INPUT_JSON: 'Input.' },
        outputContract: { OUTPUT_JSON: 'Output.' },
        sandboxPolicy: {
          network: 'disabled',
        },
      });
      const currentCandidate = buildResearchScriptSkillCandidate(currentJob, [
        runResult({ jobId: currentJob.id }),
        runResult({ jobId: currentJob.id }),
      ]);
      const changedCandidate = buildResearchScriptSkillCandidate(changedJob, [
        runResult({ jobId: changedJob.id }),
        runResult({ jobId: changedJob.id }),
      ]);
      const newCandidate = buildResearchScriptSkillCandidate(newJob, [
        runResult({ jobId: newJob.id }),
        runResult({ jobId: newJob.id }),
      ]);
      await Promise.all([
        materializeResearchScriptSkillCandidate(currentCandidate, { rootDir }),
        materializeResearchScriptSkillCandidate(changedCandidate, { rootDir }),
        materializeResearchScriptSkillCandidate(newCandidate, { rootDir }),
      ]);

      const workspaceHub = new SkillsHub({
        cacheDir: path.join(rootDir, '.codebuddy', 'skills-cache'),
        lockfilePath: path.join(rootDir, '.codebuddy', 'skills-lock.json'),
        skillsDir: path.join(rootDir, '.codebuddy', 'skills'),
      });
      await workspaceHub.installFromContent(currentCandidate.skillName, currentCandidate.markdown);
      await workspaceHub.installFromContent(
        changedCandidate.skillName,
        changedCandidate.markdown.replace('Review changed workflow.', 'Old installed workflow.'),
      );

      const candidates = await listMaterializedResearchScriptSkillCandidatesWithInstallState({ rootDir });
      const byName = new Map(candidates.map((candidate) => [candidate.skillName, candidate]));

      expect(byName.get(currentCandidate.skillName)).toMatchObject({
        installState: 'installed-current',
        installedIntegrityOk: true,
        installedVersion: '0.1.0',
      });
      expect(byName.get(changedCandidate.skillName)).toMatchObject({
        installState: 'installed-different',
        installedIntegrityOk: true,
      });
      expect(byName.get(changedCandidate.skillName)?.candidateDiffPreview).toMatchObject({
        addedLines: 1,
        removedLines: 1,
        truncated: false,
      });
      expect(byName.get(changedCandidate.skillName)?.candidateDiffPreview?.preview).toContain(
        '- Old installed workflow.',
      );
      expect(byName.get(changedCandidate.skillName)?.candidateDiffPreview?.preview).toContain(
        '+- Review changed workflow.',
      );
      expect(byName.get(changedCandidate.skillName)?.reviewCommands).toEqual(expect.arrayContaining([
        `skill_manage action=candidate_install candidate_path=${changedCandidate.skillPath} approved_by=<reviewer> overwrite=true`,
        `skill_manage action=history name=${changedCandidate.skillName}`,
      ]));
      expect(byName.get(newCandidate.skillName)).toMatchObject({
        installState: 'not-installed',
      });
      expect(byName.get(newCandidate.skillName)?.reviewCommands).toContain(
        `skill_manage action=candidate_install candidate_path=${newCandidate.skillPath} approved_by=<reviewer>`,
      );
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('refuses to install candidates that are not yet eligible', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-skill-ineligible-'));
    try {
      const job = buildResearchScriptJobArtifact({
        id: 'research-script-ineligible',
        goal: 'One run is not enough.',
        title: 'Ineligible workflow',
        language: 'javascript',
        inputContract: { INPUT_JSON: 'Input.' },
        outputContract: { OUTPUT_JSON: 'Output.' },
        sandboxPolicy: {
          network: 'disabled',
        },
      });
      const candidate = buildResearchScriptSkillCandidate(job, [
        runResult({ jobId: job.id }),
      ]);
      await materializeResearchScriptSkillCandidate(candidate, { rootDir });

      await expect(
        installResearchScriptSkillCandidate(candidate, {
          approvedBy: 'Patrice',
          rootDir,
        }),
      ).rejects.toThrow('not eligible for install');
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
