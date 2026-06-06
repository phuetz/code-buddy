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
        evidenceRunIds: ['run-learning-first', 'run-learning-ready'],
        id: 'candidate-ready',
        kind: 'learning',
        promotionThreshold: 2,
        proofBackedSuccessCount: 2,
        proofCommands: [
          {
            command: 'npm test -- tests/agent/learning-agent-real.test.ts --run',
            durationMs: 100,
            isTest: true,
            runId: 'run-learning-ready',
            sequence: 5,
            success: true,
            toolName: 'bash',
          },
        ],
        proofStatus: 'proven',
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
    const scanSkillFirewall = vi.fn(() => ({
      capabilities: [],
      findingCounts: { critical: 0, high: 0, info: 0, low: 0, medium: 0 },
      quarantineRequired: false,
      score: 100,
      summary: 'Skill Firewall allow: score 100/100',
      verdict: 'allow',
    }));
    mockedLoadCoreModule.mockImplementation(async (moduleName: string) => {
      if (moduleName === 'security/skill-scanner.js') return { scanSkillFirewall };
      return { listMaterializedResearchScriptSkillCandidates };
    });

    const rootDir = path.resolve('workspace');
    const candidates = await listSkillCandidatesForReview({
      rootDir,
      eligibleOnly: true,
      skillRoot: '.codebuddy/skill-candidates',
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/research-script-skill-candidate.js');
    expect(mockedLoadCoreModule).toHaveBeenCalledWith('security/skill-scanner.js');
    expect(listMaterializedResearchScriptSkillCandidates).toHaveBeenCalledWith({
      rootDir,
      skillRoot: '.codebuddy/skill-candidates',
    });
    expect(scanSkillFirewall).toHaveBeenCalledWith(
      path.resolve(rootDir, '.codebuddy/skill-candidates/research-ready/SKILL.md'),
    );
    expect(candidates).toEqual([
      {
        eligible: true,
        evidenceRunIds: ['run-learning-first', 'run-learning-ready'],
        firewall: {
          capabilities: [],
          findingCounts: { critical: 0, high: 0, info: 0, low: 0, medium: 0 },
          quarantineRequired: false,
          score: 100,
          summary: 'Skill Firewall allow: score 100/100',
          verdict: 'allow',
        },
        id: 'candidate-ready',
        kind: 'learning',
        promotionThreshold: 2,
        proofBackedSuccessCount: 2,
        proofCommands: [
          {
            command: 'npm test -- tests/agent/learning-agent-real.test.ts --run',
            durationMs: 100,
            isTest: true,
            runId: 'run-learning-ready',
            sequence: 5,
            success: true,
            toolName: 'bash',
          },
        ],
        proofStatus: 'proven',
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
        reviewCommands: ['skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/research-ready/SKILL.md'],
        skillName: 'research-ready',
        skillPath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
        sourceJobId: '',
        sourceRunId: 'run-learning-ready',
        successfulRunCount: 2,
        title: 'Ready candidate',
      },
    ]);
    mockedLoadCoreModule.mockImplementation(async (moduleName: string) => {
      if (moduleName === 'security/skill-scanner.js') return null;
      return {
        listMaterializedResearchScriptSkillCandidates,
        listMaterializedResearchScriptSkillCandidatesWithInstallState,
      };
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
      reviewCommands: ['skill_manage action=candidate_view candidate_path=.codebuddy/skill-candidates/research-ready/SKILL.md'],
      skillName: 'research-ready',
    });
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
    const scanSkillFirewall = vi.fn(() => ({
      capabilities: ['network'],
      findingCounts: { critical: 0, high: 0, info: 0, low: 0, medium: 1 },
      quarantineRequired: false,
      score: 90,
      summary: 'Skill Firewall review: score 90/100; 1 medium; capabilities: network.',
      verdict: 'review',
    }));
    mockedLoadCoreModule.mockImplementation(async (moduleName: string) => {
      if (moduleName === 'security/skill-scanner.js') return { scanSkillFirewall };
      return {
        installResearchScriptSkillCandidate,
        readMaterializedResearchScriptSkillCandidate,
        readMaterializedResearchScriptSkillCandidateWithInstallState,
      };
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
        firewall: {
          capabilities: ['network'],
          quarantineRequired: false,
          score: 90,
          verdict: 'review',
        },
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

  it('blocks installation when Skill Firewall requires quarantine', async () => {
    const candidate = {
      eligible: true,
      id: 'candidate-danger',
      kind: 'learning',
      reason: '2 successful runs met the promotion threshold.',
      skillName: 'danger-skill',
      skillPath: '.codebuddy/skill-candidates/danger-skill/SKILL.md',
      sourceJobId: 'research-script-danger',
      successfulRunCount: 2,
      title: 'Danger skill',
    };
    const readMaterializedResearchScriptSkillCandidate = vi.fn(async () => candidate);
    const installResearchScriptSkillCandidate = vi.fn();
    mockedLoadCoreModule.mockImplementation(async (moduleName: string) => {
      if (moduleName === 'security/skill-scanner.js') {
        return {
          scanSkillFirewall: vi.fn(() => ({
            capabilities: ['shell', 'filesystem'],
            findingCounts: { critical: 1, high: 1, info: 0, low: 0, medium: 0 },
            quarantineRequired: true,
            score: 31,
            summary: 'Skill Firewall quarantine: score 31/100; 1 critical, 1 high; capabilities: filesystem, shell.',
            verdict: 'quarantine',
          })),
        };
      }
      return {
        installResearchScriptSkillCandidate,
        readMaterializedResearchScriptSkillCandidate,
      };
    });

    await expect(installSkillCandidateForReview({
      approvedBy: 'Patrice',
      candidatePath: '.codebuddy/skill-candidates/danger-skill',
      rootDir: path.resolve('workspace'),
    })).rejects.toThrow('Skill Firewall quarantine required for danger-skill');

    expect(installResearchScriptSkillCandidate).not.toHaveBeenCalled();
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
