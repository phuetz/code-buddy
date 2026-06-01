import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  installSkillCandidateForReview,
  listSkillCandidatesForReview,
} from '../src/main/tools/skill-candidate-review-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('skill candidate review bridge', () => {
  it('loads eligible materialized research-script skill candidates from the workspace root', async () => {
    const listMaterializedResearchScriptSkillCandidates = vi.fn(async () => [
      {
        eligible: false,
        id: 'candidate-old',
        kind: 'research-script',
        reason: '1/2 successful runs.',
        skillName: 'research-old',
        skillPath: '.codebuddy/skill-candidates/research-old/SKILL.md',
        sourceJobId: 'research-script-old',
        successfulRunCount: 1,
        title: 'Old candidate',
      },
      {
        eligible: true,
        id: 'candidate-ready',
        kind: 'learning',
        reason: '2 successful runs met the promotion threshold.',
        skillName: 'research-ready',
        skillPath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
        sourceJobId: 'research-script-ready',
        sourceRunId: 'run-learning-ready',
        successfulRunCount: 2,
        title: 'Ready candidate',
        toolSequence: ['search', 'view_file', 'bash'],
      },
    ]);
    mockedLoadCoreModule.mockResolvedValue({ listMaterializedResearchScriptSkillCandidates });

    const rootDir = path.resolve('workspace');
    const candidates = await listSkillCandidatesForReview({
      rootDir,
      eligibleOnly: true,
      skillRoot: '.codebuddy/skill-candidates',
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/research-script-skill-candidate.js');
    expect(listMaterializedResearchScriptSkillCandidates).toHaveBeenCalledWith({
      rootDir,
      skillRoot: '.codebuddy/skill-candidates',
    });
    expect(candidates).toEqual([
      {
        eligible: true,
        id: 'candidate-ready',
        kind: 'learning',
        reason: '2 successful runs met the promotion threshold.',
        skillName: 'research-ready',
        skillPath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
        sourceJobId: 'research-script-ready',
        sourceRunId: 'run-learning-ready',
        successfulRunCount: 2,
        title: 'Ready candidate',
        toolSequence: ['search', 'view_file', 'bash'],
      },
    ]);
  });

  it('prefers install-state candidate summaries when the core module exposes them', async () => {
    const listMaterializedResearchScriptSkillCandidates = vi.fn(async () => []);
    const listMaterializedResearchScriptSkillCandidatesWithInstallState = vi.fn(async () => [
      {
        candidateChecksum: 'candidate-sha',
        candidateDiffPreview: {
          addedLines: 1,
          preview: '- old\n+ new',
          removedLines: 1,
          summary: 'Candidate changes research-ready/SKILL.md with 1 addition and 1 removal',
          truncated: false,
        },
        eligible: true,
        id: 'candidate-ready',
        installState: 'installed-different',
        installedChecksum: 'installed-sha',
        installedIntegrityOk: true,
        installedPath: 'D:/workspace/.codebuddy/skills/research-ready/SKILL.md',
        installedVersion: '0.1.0',
        kind: 'learning',
        reason: '2 successful runs met the promotion threshold.',
        reviewCommands: [
          'skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/research-ready/SKILL.md',
          'skill_manage action=candidate_install candidate_path=.codebuddy/skill-candidates/research-ready/SKILL.md approved_by=<reviewer> overwrite=true',
        ],
        skillName: 'research-ready',
        skillPath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
        sourceJobId: '',
        sourceRunId: 'run-learning-ready',
        successfulRunCount: 2,
        title: 'Ready candidate',
      },
    ]);
    mockedLoadCoreModule.mockResolvedValue({
      listMaterializedResearchScriptSkillCandidates,
      listMaterializedResearchScriptSkillCandidatesWithInstallState,
    });

    const rootDir = path.resolve('workspace');
    const candidates = await listSkillCandidatesForReview({
      rootDir,
      eligibleOnly: true,
    });

    expect(listMaterializedResearchScriptSkillCandidates).not.toHaveBeenCalled();
    expect(listMaterializedResearchScriptSkillCandidatesWithInstallState).toHaveBeenCalledWith({
      rootDir,
      skillRoot: undefined,
    });
    expect(candidates[0]).toMatchObject({
      candidateChecksum: 'candidate-sha',
      candidateDiffPreview: {
        addedLines: 1,
        removedLines: 1,
      },
      installState: 'installed-different',
      installedChecksum: 'installed-sha',
      installedVersion: '0.1.0',
      reviewCommands: expect.arrayContaining([
        'skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/research-ready/SKILL.md',
        expect.stringContaining('candidate_install'),
      ]),
      skillName: 'research-ready',
    });
  });

  it('omits installed-current candidates from the eligible review queue while preserving full audit lists', async () => {
    const installedCurrent = {
      eligible: true,
      id: 'candidate-current',
      installState: 'installed-current' as const,
      kind: 'learning',
      reason: 'Already approved and installed.',
      reviewCommands: [
        'skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/research-current/SKILL.md',
        'skill_manage action=view name=research-current',
      ],
      skillName: 'research-current',
      skillPath: '.codebuddy/skill-candidates/research-current/SKILL.md',
      sourceJobId: 'learning-agent',
      sourceRunId: 'run-current',
      successfulRunCount: 2,
      title: 'Current candidate',
    };
    const installable = {
      eligible: true,
      id: 'candidate-ready',
      installState: 'not-installed' as const,
      kind: 'learning',
      reason: '2 successful runs met the promotion threshold.',
      reviewCommands: [
        'skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/research-ready/SKILL.md',
        'skill_manage action=candidate_install candidate_path=.codebuddy/skill-candidates/research-ready/SKILL.md approved_by=<reviewer>',
      ],
      skillName: 'research-ready',
      skillPath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
      sourceJobId: 'learning-agent',
      sourceRunId: 'run-ready',
      successfulRunCount: 2,
      title: 'Ready candidate',
    };
    const listMaterializedResearchScriptSkillCandidatesWithInstallState = vi.fn(async () => [
      installedCurrent,
      installable,
    ]);
    mockedLoadCoreModule.mockResolvedValue({
      listMaterializedResearchScriptSkillCandidates: vi.fn(async () => []),
      listMaterializedResearchScriptSkillCandidatesWithInstallState,
    });

    const rootDir = path.resolve('workspace');
    await expect(listSkillCandidatesForReview({
      rootDir,
      eligibleOnly: true,
    })).resolves.toEqual([
      expect.objectContaining({
        installState: 'not-installed',
        skillName: 'research-ready',
      }),
    ]);

    await expect(listSkillCandidatesForReview({
      rootDir,
      eligibleOnly: false,
    })).resolves.toEqual([
      expect.objectContaining({
        installState: 'installed-current',
        skillName: 'research-current',
      }),
      expect.objectContaining({
        installState: 'not-installed',
        skillName: 'research-ready',
      }),
    ]);
  });

  it('degrades to an empty queue when the core candidate module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(listSkillCandidatesForReview({
      rootDir: path.resolve('workspace'),
    })).resolves.toEqual([]);
  });

  it('rejects relative workspace roots before loading the core module', async () => {
    const candidates = await listSkillCandidatesForReview({
      rootDir: 'relative-workspace',
    });

    expect(candidates).toEqual([]);
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });

  it('installs an approved candidate through the core skill candidate module', async () => {
    const candidate = {
      eligible: true,
      id: 'candidate-ready',
      kind: 'learning',
      reason: '2 successful runs met the promotion threshold.',
      skillName: 'research-ready',
      skillPath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
      sourceJobId: 'research-script-ready',
      sourceRunId: 'run-learning-ready',
      successfulRunCount: 2,
      title: 'Ready candidate',
    };
    const readMaterializedResearchScriptSkillCandidate = vi.fn(async () => candidate);
    const readMaterializedResearchScriptSkillCandidateWithInstallState = vi.fn(async () => ({
      ...candidate,
      candidateChecksum: 'candidate-sha',
      installState: 'installed-current',
      installedChecksum: 'candidate-sha',
      installedIntegrityOk: true,
      installedPath: 'D:/workspace/.codebuddy/skills/research-ready/SKILL.md',
      installedVersion: '0.1.0',
      reviewCommands: ['skill_manage action=history name=research-ready'],
    }));
    const installResearchScriptSkillCandidate = vi.fn(async () => ({
      absoluteInstalledPath: 'D:/workspace/.codebuddy/skills/research-ready/SKILL.md',
      approvedAt: '2026-05-30T17:45:00.000Z',
      approvedBy: 'Patrice',
      candidateId: 'candidate-ready',
      installedPath: '.codebuddy/skills/research-ready/SKILL.md',
      skillName: 'research-ready',
      sourceCandidatePath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
    }));
    mockedLoadCoreModule.mockResolvedValue({
      installResearchScriptSkillCandidate,
      readMaterializedResearchScriptSkillCandidate,
      readMaterializedResearchScriptSkillCandidateWithInstallState,
    });

    const rootDir = path.resolve('workspace');
    const result = await installSkillCandidateForReview({
      approvedBy: 'Patrice',
      candidatePath: '.codebuddy/skill-candidates/research-ready',
      overwrite: true,
      rootDir,
    });

    expect(readMaterializedResearchScriptSkillCandidate).toHaveBeenCalledWith(
      '.codebuddy/skill-candidates/research-ready',
      { rootDir },
    );
    expect(installResearchScriptSkillCandidate).toHaveBeenCalledWith(candidate, {
      approvedBy: 'Patrice',
      overwrite: true,
      rootDir,
      workspaceSkillRoot: undefined,
    });
    expect(result).toMatchObject({
      candidate: {
        installState: 'installed-current',
        installedIntegrityOk: true,
        skillName: 'research-ready',
      },
      installed: {
        approvedBy: 'Patrice',
        skillName: 'research-ready',
      },
    });
  });

  it('requires a reviewer before installing a candidate', async () => {
    await expect(installSkillCandidateForReview({
      approvedBy: ' ',
      candidatePath: '.codebuddy/skill-candidates/research-ready',
      rootDir: path.resolve('workspace'),
    })).rejects.toThrow('approvedBy is required');

    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });
});
