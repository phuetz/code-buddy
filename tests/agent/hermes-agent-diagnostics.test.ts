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

  it('reports local auth files as safe sources without leaking absolute paths', () => {
    const dir = makeTempDir();
    const codebuddyDir = path.join(dir, '.codebuddy');
    fs.mkdirSync(codebuddyDir, { recursive: true });
    const codexAuthPath = path.join(codebuddyDir, 'codex-auth.json');
    const nousAuthPath = path.join(codebuddyDir, 'nous_auth.json');
    fs.writeFileSync(codexAuthPath, JSON.stringify({ tokens: { access_token: 'secret-codex-token' } }));
    fs.writeFileSync(nousAuthPath, JSON.stringify({ access_token: 'secret-nous-file-token' }));

    const loader = new CustomAgentLoader(dir);
    const diagnostics = buildHermesAgentDiagnostics({
      env: {
        CODEBUDDY_MODEL: 'gpt-5.5',
      },
      homeDir: dir,
      loader,
      settingsModel: null,
    });
    const raw = JSON.stringify(diagnostics);

    expect(diagnostics.providerReadiness.activeProvider).toMatchObject({
      provider: 'openai',
      configured: true,
      credentialSources: ['~/.codebuddy/codex-auth.json'],
    });
    expect(diagnostics.providerReadiness.portal.portal).toMatchObject({
      authFilePath: '~/.codebuddy/nous_auth.json',
      authFilePresent: true,
      credentialSources: ['~/.codebuddy/nous_auth.json'],
      credentialPresent: true,
    });
    expect(raw).not.toContain(dir);
    expect(raw).not.toContain(codexAuthPath);
    expect(raw).not.toContain(nousAuthPath);
    expect(raw).not.toContain('secret-codex-token');
    expect(raw).not.toContain('secret-nous-file-token');
  });

  it('reports SSH config readiness without leaking the local home path', () => {
    const dir = makeTempDir();
    const sshDir = path.join(dir, '.ssh');
    const sshConfigPath = path.join(sshDir, 'config');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(sshConfigPath, 'Host hermes-fixture\n  HostName example.test\n');

    const loader = new CustomAgentLoader(dir);
    const diagnostics = buildHermesAgentDiagnostics({
      homeDir: dir,
      loader,
    });
    const ssh = diagnostics.runtimeBackends.backends.find((backend) => backend.id === 'ssh');
    const raw = JSON.stringify(diagnostics.runtimeBackends);

    expect(ssh).toMatchObject({
      configured: true,
      credentialSources: ['~/.ssh/config'],
    });
    expect(raw).not.toContain(dir);
    expect(raw).not.toContain(sshConfigPath);
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

  it('reports browser backend inventory from real local probes', () => {
    const loader = new CustomAgentLoader(makeTempDir());
    const diagnostics = buildHermesAgentDiagnostics({
      env: {
        CODEBUDDY_BROWSER_CDP_URL: 'ws://secret-cdp-host.example.test/devtools/browser/abc',
        BROWSERBASE_API_KEY: 'secret-browserbase-key',
        BROWSERBASE_PROJECT_ID: 'secret-browserbase-project',
        FIRECRAWL_API_KEY: 'secret-firecrawl-key',
      },
      loader,
      now: () => new Date('2026-05-31T13:40:00.000Z'),
      settingsModel: null,
    });

    expect(diagnostics.browserBackends.generatedAt).toBe('2026-05-31T13:40:00.000Z');
    expect(diagnostics.browserBackends.backends.map((backend) => backend.id)).toEqual(
      expect.arrayContaining([
        'local-playwright',
        'remote-cdp',
        'browserbase',
        'browser-use',
        'firecrawl',
        'camofox',
        'session-recording',
      ]),
    );
    expect(diagnostics.browserBackends.localRunnableCount).toBeGreaterThanOrEqual(1);

    const local = diagnostics.browserBackends.backends.find((backend) => backend.id === 'local-playwright');
    expect(local).toMatchObject({
      status: 'available',
      installed: true,
      configured: true,
      runnable: true,
      command: process.execPath,
      smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
    });

    const cdp = diagnostics.browserBackends.backends.find((backend) => backend.id === 'remote-cdp');
    expect(cdp).toMatchObject({
      status: 'configured',
      credentialSources: ['CODEBUDDY_BROWSER_CDP_URL'],
      smokeCommand: 'buddy hermes browser-smoke remote-cdp --json',
    });
    const recording = diagnostics.browserBackends.backends.find((backend) => backend.id === 'session-recording');
    expect(recording).toMatchObject({
      status: 'available',
      runnable: true,
      smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
    });
    expect(JSON.stringify(diagnostics.browserBackends)).not.toContain('secret-');
    expect(JSON.stringify(diagnostics.browserBackends)).not.toContain('ws://secret-cdp-host');
  });
});
