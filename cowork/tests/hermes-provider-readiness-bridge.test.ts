import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { getHermesProviderReadinessForReview } from '../src/main/tools/hermes-provider-readiness-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes provider readiness bridge', () => {
  it('summarizes the core Hermes doctor readiness without leaking secret values', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesAgentDiagnostics: () => ({
        providerReadiness: {
          ok: true,
          activeModel: {
            contextWindow: 200000,
            maxOutputTokens: 64000,
            model: 'gpt-5.5',
            provider: 'openai',
            source: 'environment model',
            supportsReasoning: true,
            supportsToolCalls: true,
            supportsVision: true,
          },
          activeProvider: {
            baseUrl: null,
            configured: true,
            credentialSources: ['OPENAI_API_KEY'],
            label: 'OpenAI / Codex-compatible',
            local: false,
            setupCommands: [],
          },
          providers: [{ configured: true }, { configured: false }],
          portal: {
            portal: {
              credentialPresent: true,
              credentialSources: ['CODEBUDDY_NOUS_ACCESS_TOKEN'],
              toolGatewayConfigured: true,
            },
            toolGateway: {
              directFallbackCount: 3,
              managedByNousCount: 2,
            },
          },
          issues: [],
          recommendations: ['Use buddy hermes portal status --json.'],
        },
      }),
    });

    const summary = await getHermesProviderReadinessForReview();

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-agent-diagnostics.js');
    expect(summary).toMatchObject({
      command: 'buddy hermes providers status --json',
      ok: true,
      activeModel: {
        model: 'gpt-5.5',
        provider: 'openai',
        supportsToolCalls: true,
        supportsReasoning: true,
        supportsVision: true,
      },
      activeProvider: {
        configured: true,
        credentialSources: ['OPENAI_API_KEY'],
        setupCommands: [],
      },
      portal: {
        credentialPresent: true,
        toolGatewayConfigured: true,
        managedByNousCount: 2,
      },
      providerCount: 2,
      configuredProviderCount: 1,
    });
    expect(JSON.stringify(summary)).not.toContain('secret-openai-key');
    expect(JSON.stringify(summary)).not.toContain('secret-nous-token');
  });

  it('degrades to null when the core diagnostic module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesProviderReadinessForReview()).resolves.toBeNull();
  });
});
