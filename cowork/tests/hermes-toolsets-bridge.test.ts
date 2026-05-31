import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  buildHermesToolsetsCommand,
  getHermesToolsetsForReview,
} from '../src/main/tools/hermes-toolsets-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes toolsets bridge', () => {
  it('builds the Fleet/Hermes toolsets catalog from the core dispatch profile module', async () => {
    const buildHermesToolsetDescriptor = vi.fn((profile: string, tools: readonly string[]) => ({
      allowGroups: ['group:fs:read'],
      allowedTools: tools.filter((tool) => tool === 'view_file'),
      confirmGroups: ['group:web'],
      confirmTools: tools.filter((tool) => tool === 'web_fetch'),
      decisions: tools.map((tool) => ({
        action: tool === 'view_file' ? 'allow' : 'confirm',
        groups: [tool === 'view_file' ? 'group:fs:read' : 'group:web'],
        reason: `${profile} handles ${tool}`,
        source: 'global',
        tool,
      })),
      defaultAction: 'confirm',
      deniedTools: [],
      denyGroups: [],
      intent: `${profile} intent`,
      label: `${profile} label`,
      policyProfile: 'coding',
      profile,
      summary: `${profile} summary`,
      systemPrompt: `${profile} prompt`,
      toolsetId: `fleet.hermes.${profile}`,
    }));
    mockedLoadCoreModule.mockResolvedValue({
      DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS: ['view_file', 'web_fetch'],
      FLEET_DISPATCH_PROFILES: ['balanced', 'safe'],
      FLEET_DISPATCH_PROFILE_GUIDANCE: {
        balanced: {
          label: 'Balanced',
          policySummary: 'Balanced policy',
          profile: 'balanced',
          useWhen: 'mixed tasks',
        },
        safe: {
          label: 'Safe',
          policySummary: 'Safe policy',
          profile: 'safe',
          useWhen: 'read-only work',
        },
      },
      buildHermesToolsetDescriptor,
      normalizeDispatchProfile: (value: unknown) => (value === 'safe' ? 'safe' : 'balanced'),
    });

    const catalog = await getHermesToolsetsForReview('safe');

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('fleet/dispatch-profile.js');
    expect(buildHermesToolsetDescriptor).toHaveBeenCalledWith('safe', ['view_file', 'web_fetch']);
    expect(catalog).toMatchObject({
      activeProfile: 'safe',
      activeToolset: {
        toolsetId: 'fleet.hermes.safe',
      },
      command: 'buddy hermes toolsets safe --json',
      kind: 'hermes_toolsets_catalog',
      previewTools: ['view_file', 'web_fetch'],
      requestedProfile: 'safe',
      schemaVersion: 1,
      summary: {
        profiles: ['balanced', 'safe'],
        totalToolsets: 2,
      },
    });
    expect(catalog?.toolsets.map((toolset) => toolset.toolsetId)).toEqual([
      'fleet.hermes.balanced',
      'fleet.hermes.safe',
    ]);
    expect(catalog?.guidance).toHaveLength(2);
  });

  it('normalizes unknown profiles before exposing the cockpit command', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS: ['view_file'],
      FLEET_DISPATCH_PROFILES: ['balanced'],
      buildHermesToolsetDescriptor: (profile: string) => ({
        allowGroups: [],
        allowedTools: ['view_file'],
        confirmGroups: [],
        confirmTools: [],
        decisions: [],
        defaultAction: 'confirm',
        deniedTools: [],
        denyGroups: [],
        intent: 'balanced intent',
        label: 'balanced label',
        policyProfile: 'coding',
        profile,
        summary: 'balanced summary',
        systemPrompt: 'balanced prompt',
        toolsetId: `fleet.hermes.${profile}`,
      }),
      normalizeDispatchProfile: () => 'balanced',
    });

    const catalog = await getHermesToolsetsForReview('dangerous');

    expect(catalog?.requestedProfile).toBe('dangerous');
    expect(catalog?.activeProfile).toBe('balanced');
    expect(catalog?.command).toBe('buddy hermes toolsets balanced --json');
  });

  it('degrades to null when the core dispatch profile module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesToolsetsForReview('safe')).resolves.toBeNull();
  });

  it('keeps the CLI command helper stable', () => {
    expect(buildHermesToolsetsCommand('review')).toBe('buddy hermes toolsets review --json');
  });
});
