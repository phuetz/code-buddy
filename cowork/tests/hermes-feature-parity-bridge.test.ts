import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  buildHermesFeatureParityCommand,
  getHermesFeatureParityForReview,
} from '../src/main/tools/hermes-feature-parity-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes feature parity bridge', () => {
  it('summarizes the official Hermes feature manifest for Cowork review', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesParityManifest: () => ({
        generatedAt: '2026-05-31T18:00:00.000Z',
        officialSource: {
          auditDocument: 'docs/hermes-agent-official-parity-audit-2026-05-30.md',
          inspectedCommit: '5921d667',
          latestTagObserved: 'v2026.5.29.2',
          repository: 'https://github.com/NousResearch/hermes-agent',
        },
        summary: {
          covered: 1,
          coveredPartial: 5,
          gaps: 1,
          partial: 13,
          total: 20,
        },
        features: [
          {
            area: 'Closed learning loop',
            codeBuddyEvidence: ['src/agent/learning-agent.ts'],
            id: 'closed-learning-loop',
            nextWork: 'Keep skill mutation outcomes tied to rollback history.',
            notes: 'Learning loop is review-gated.',
            officialSurface: 'Memory nudges and autonomous skill creation',
            status: 'partial',
            verificationCommands: ['npm test -- tests/agent/learning-agent-real.test.ts --run'],
          },
          {
            area: 'OpenClaw migration',
            codeBuddyEvidence: ['docs/'],
            id: 'openclaw-migration',
            nextWork: 'Do this at the end.',
            notes: 'Deferred by product decision.',
            officialSurface: 'hermes claw migrate',
            status: 'gap',
            verificationCommands: ['rg -n "openclaw" src tests docs'],
          },
          {
            area: 'Prompt-size diagnostic',
            codeBuddyEvidence: ['src/commands/cli/hermes-commands.ts'],
            id: 'prompt-size',
            notes: 'Offline prompt-size exists.',
            officialSurface: 'hermes prompt-size',
            status: 'covered-partial',
            verificationCommands: ['npx tsx src/index.ts hermes prompt-size safe --json'],
          },
        ],
      }),
    });

    const summary = await getHermesFeatureParityForReview();

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-parity-manifest.js');
    expect(summary).toEqual({
      auditDocument: 'docs/hermes-agent-official-parity-audit-2026-05-30.md',
      command: 'buddy hermes parity --json',
      generatedAt: '2026-05-31T18:00:00.000Z',
      inspectedCommit: '5921d667',
      latestTagObserved: 'v2026.5.29.2',
      source: 'https://github.com/NousResearch/hermes-agent',
      summary: {
        covered: 1,
        coveredPartial: 5,
        gaps: 1,
        partial: 13,
        total: 20,
      },
      topWork: [
        {
          area: 'Closed learning loop',
          id: 'closed-learning-loop',
          nextWork: 'Keep skill mutation outcomes tied to rollback history.',
          officialSurface: 'Memory nudges and autonomous skill creation',
          status: 'partial',
          verificationCommands: ['npm test -- tests/agent/learning-agent-real.test.ts --run'],
        },
        {
          area: 'OpenClaw migration',
          id: 'openclaw-migration',
          nextWork: 'Do this at the end.',
          officialSurface: 'hermes claw migrate',
          status: 'gap',
          verificationCommands: ['rg -n "openclaw" src tests docs'],
        },
      ],
    });
  });

  it('degrades to null when the core feature parity module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesFeatureParityForReview()).resolves.toBeNull();
  });

  it('keeps the CLI command helper stable', () => {
    expect(buildHermesFeatureParityCommand()).toBe('buddy hermes parity --json');
  });
});
