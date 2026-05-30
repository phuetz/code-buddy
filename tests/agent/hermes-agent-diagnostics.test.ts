import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { CustomAgentLoader } from '../../src/agent/custom/custom-agent-loader.js';
import { buildHermesAgentDiagnostics } from '../../src/agent/hermes-agent-diagnostics.js';

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hermes-doctor-'));
  return tempDir;
}

describe('Hermes Agent diagnostics', () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('reports the built-in Hermes Agent and its defensive tool filter', () => {
    const loader = new CustomAgentLoader(makeTempDir());
    const diagnostics = buildHermesAgentDiagnostics({
      dispatchProfile: 'safe',
      loader,
    });

    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.source).toBe('built-in');
    expect(diagnostics.activeToolset.toolsetId).toBe('fleet.hermes.safe');
    expect(diagnostics.fleetDispatchProfile).toBe('balanced');
    expect(diagnostics.requireExplicitDispatchProfile).toBe(true);
    expect(diagnostics.effectiveToolFilter.enabledPatterns).toEqual(['view_file', 'web_search', 'web_fetch']);
    expect(diagnostics.effectiveToolFilter.disabledPatterns).toEqual([
      'create_file',
      'bash',
      'git_push',
      'delete_file',
    ]);
    expect(diagnostics.dispatchProfileGuidance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profile: 'safe', useWhen: expect.stringContaining('high-risk') }),
        expect.objectContaining({ profile: 'review', useWhen: expect.stringContaining('read-first') }),
      ]),
    );
    expect(diagnostics.nativeSurfaceIds).toEqual(
      expect.arrayContaining(['toolsets', 'skills', 'memory', 'delegation']),
    );
  });

  it('detects a user override while keeping the diagnostic non-fatal', () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, 'hermes.toml'),
      [
        'name = "Local Hermes"',
        'description = "Project override"',
        'systemPrompt = """',
        'Code Buddy Hermes local prompt.',
        '"""',
        '',
      ].join('\n'),
    );
    const loader = new CustomAgentLoader(dir);
    const diagnostics = buildHermesAgentDiagnostics({ loader });

    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.source).toBe('user');
    expect(diagnostics.userOverride).toBe(true);
    expect(diagnostics.agentName).toBe('Local Hermes');
    expect(diagnostics.recommendations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('external Python runtime'),
        expect.stringContaining('disabledTools'),
      ]),
    );
  });

  it('reports provider, model, and Nous Portal readiness without leaking secrets', () => {
    const dir = makeTempDir();
    const loader = new CustomAgentLoader(dir);
    const diagnostics = buildHermesAgentDiagnostics({
      dispatchProfile: 'code',
      env: {
        CODEBUDDY_MODEL: 'gpt-5.5',
        OPENAI_API_KEY: 'secret-openai-key',
        CODEBUDDY_NOUS_ACCESS_TOKEN: 'secret-nous-token',
        CODEBUDDY_NOUS_TOOL_GATEWAY_URL: 'https://gateway.example.test',
        CODEBUDDY_NOUS_MANAGED_TOOLS: 'web,image_gen',
      },
      homeDir: dir,
      loader,
      now: () => new Date('2026-05-30T12:00:00.000Z'),
      settingsModel: null,
    });

    expect(diagnostics.providerReadiness.ok).toBe(true);
    expect(diagnostics.providerReadiness.activeModel).toMatchObject({
      model: 'gpt-5.5',
      provider: 'openai',
      source: 'environment model',
      supportsToolCalls: true,
      supportsReasoning: true,
      supportsVision: true,
      contextWindow: 200000,
      maxOutputTokens: 64000,
    });
    expect(diagnostics.providerReadiness.activeProvider).toMatchObject({
      provider: 'openai',
      configured: true,
      credentialSources: ['OPENAI_API_KEY'],
    });
    expect(diagnostics.providerReadiness.portal.portal.credentialSources).toContain('CODEBUDDY_NOUS_ACCESS_TOKEN');
    expect(diagnostics.providerReadiness.portal.portal.toolGatewayConfigured).toBe(true);
    expect(diagnostics.providerReadiness.portal.toolGateway.managedByNousCount).toBe(2);
    expect(JSON.stringify(diagnostics)).not.toContain('secret-openai-key');
    expect(JSON.stringify(diagnostics)).not.toContain('secret-nous-token');
  });

  it('reports runtime backend inventory from real local probes', () => {
    const loader = new CustomAgentLoader(makeTempDir());
    const diagnostics = buildHermesAgentDiagnostics({
      loader,
      now: () => new Date('2026-05-30T13:00:00.000Z'),
    });

    expect(diagnostics.runtimeBackends.generatedAt).toBe('2026-05-30T13:00:00.000Z');
    expect(diagnostics.runtimeBackends.backends.map((backend) => backend.id)).toEqual(
      expect.arrayContaining([
        'local',
        'os-sandbox',
        'docker',
        'wsl',
        'ssh',
        'singularity',
        'modal',
        'daytona',
        'vercel-sandbox',
      ]),
    );

    const local = diagnostics.runtimeBackends.backends.find((backend) => backend.id === 'local');
    expect(local).toMatchObject({
      status: 'available',
      installed: true,
      configured: true,
      runnable: true,
      command: process.execPath,
    });
    expect(local?.version).toMatch(/^v\d+\./);
    expect(local?.smokeCommand).toContain('OK-HERMES-LOCAL');

    const docker = diagnostics.runtimeBackends.backends.find((backend) => backend.id === 'docker');
    expect(docker?.smokeCommand).toContain('OK-HERMES-DOCKER');
    expect(JSON.stringify(diagnostics.runtimeBackends)).not.toContain(process.env.OPENAI_API_KEY ?? '__no_openai_key__');
  });
});
