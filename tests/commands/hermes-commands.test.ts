import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHermesCommands } from '../../src/commands/cli/hermes-commands.js';
import { resetMemoryProviderRegistry } from '../../src/memory/memory-provider.js';
import { getUserModel, resetUserModels } from '../../src/memory/user-model.js';

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
}

describe('Hermes CLI commands', () => {
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints JSON for the native Hermes profile', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'profile', '--json', 'review']);

    const output = JSON.parse(getLogOutput()) as {
      profile: {
        id: string;
        defaultDispatchProfile: string;
        dispatchProfileGuidance: Array<{ profile: string; useWhen: string }>;
        nativeSurfaces: Array<{ id: string }>;
        toolsets: Array<{ toolsetId: string }>;
      };
    };

    expect(output.profile.id).toBe('hermes');
    expect(output.profile.defaultDispatchProfile).toBe('review');
    expect(output.profile.dispatchProfileGuidance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profile: 'code', useWhen: expect.stringContaining('implementation') }),
      ]),
    );
    expect(output.profile.nativeSurfaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'toolsets' })]),
    );
    expect(output.profile.toolsets).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolsetId: 'fleet.hermes.safe' })]),
    );
  });

  it('prints the built-in Hermes Agent prompt', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'agent', 'safe']);

    const output = getLogOutput();
    expect(output).toContain('Hermes Agent system prompt:');
    expect(output).toContain('Default Fleet toolset: fleet.hermes.safe');
    expect(output).toContain('Dispatch profile selection:');
    expect(output).toContain('safe: high-risk');
    expect(output).toContain('Do not pretend to be the external Hermes Python runtime');
  });

  it('prints an offline Hermes prompt-size diagnostic', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'prompt-size', 'safe', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      dispatchProfile: string;
      toolsetId: string;
      source: string;
      totals: { bytes: number; chars: number; lines: number };
      tools: {
        totalBuiltinTools: number;
        activeToolSchemas: number;
        filteredToolSchemas: number;
        activeToolNames: string[];
        filteredToolNames: string[];
        largestSchemas: Array<{ name: string; bytes: number }>;
      };
      sections: Array<{ id: string; bytes: number; chars: number; lines: number }>;
      notes: string[];
    };

    expect(output.kind).toBe('hermes_prompt_size_diagnostic');
    expect(output.schemaVersion).toBe(1);
    expect(output.dispatchProfile).toBe('safe');
    expect(output.toolsetId).toBe('fleet.hermes.safe');
    expect(output.source).toBe('offline-built-in');
    expect(output.totals.bytes).toBeGreaterThan(0);
    expect(output.totals.chars).toBeGreaterThan(0);
    expect(output.totals.lines).toBeGreaterThan(0);
    expect(output.tools.totalBuiltinTools).toBeGreaterThan(0);
    expect(output.tools.activeToolSchemas).toBeGreaterThan(0);
    expect(output.tools.filteredToolSchemas).toBeGreaterThan(0);
    expect(output.tools.filteredToolNames).toContain('bash');
    expect(output.tools.activeToolNames).not.toContain('bash');
    expect(output.tools.largestSchemas[0]?.bytes).toBeGreaterThan(0);
    expect(output.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'systemPrompt', bytes: expect.any(Number) }),
        expect.objectContaining({ id: 'profile', bytes: expect.any(Number) }),
        expect.objectContaining({ id: 'toolSchemas', bytes: expect.any(Number) }),
        expect.objectContaining({ id: 'skillsIndex', bytes: expect.any(Number) }),
        expect.objectContaining({ id: 'memoryFootprint', bytes: expect.any(Number) }),
      ]),
    );
    expect(output.notes.join(' ')).toContain('Runs offline');
  });

  it('counts injected accepted user-model context in the prompt-size diagnostic', async () => {
    const originalCwd = process.cwd();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-prompt-size-user-model-'));
    resetUserModels();
    try {
      process.chdir(tmpDir);
      const model = getUserModel(tmpDir);
      const accepted = model.observe({
        content: 'Wants real tests before marking a task done.',
        kind: 'working-style',
      });
      model.accept(accepted.observation.id, { reviewedBy: 'Patrice' });
      model.observe({
        content: 'Pending observations must stay out of prompts.',
        kind: 'preference',
      });

      const program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync(['node', 'test', 'hermes', 'prompt-size', 'safe', '--json']);

      const output = JSON.parse(getLogOutput()) as {
        sections: Array<{ id: string; bytes: number; chars: number; lines: number }>;
        totals: { bytes: number };
        notes: string[];
      };
      const userModelSection = output.sections.find((section) => section.id === 'userModelContext');
      expect(userModelSection).toBeTruthy();
      expect(userModelSection!.bytes).toBeGreaterThan(0);
      expect(userModelSection!.chars).toBeGreaterThan(0);
      expect(userModelSection!.lines).toBeGreaterThan(0);
      expect(output.totals.bytes).toBeGreaterThanOrEqual(userModelSection!.bytes);
      expect(getLogOutput()).not.toContain('Wants real tests before marking a task done.');
      expect(getLogOutput()).not.toContain('Pending observations must stay out of prompts.');
      expect(output.notes.join(' ')).toContain('Accepted user-model context is counted');
    } finally {
      process.chdir(originalCwd);
      resetUserModels();
      await fs.remove(tmpDir);
    }
  });

  it('prints Hermes memory provider readiness without leaking credential values', async () => {
    const keys = ['CODEBUDDY_MEMORY_PROVIDER', 'MEM0_API_KEY', 'MEM0_BASE_URL'];
    const originalEnv = new Map(keys.map((key) => [key, process.env[key]]));
    const program = createProgram();
    registerHermesCommands(program);

    try {
      process.env.CODEBUDDY_MEMORY_PROVIDER = 'mem0';
      process.env.MEM0_API_KEY = 'secret-mem0-token';
      process.env.MEM0_BASE_URL = 'https://memory.example.test';
      resetMemoryProviderRegistry();

      await program.parseAsync(['node', 'test', 'hermes', 'memory', 'status', '--json']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        schemaVersion: number;
        readiness: {
          activeProviderId: string;
          configuredRemoteCount: number;
          providers: Array<{
            credentialSources: string[];
            id: string;
            status: string;
          }>;
        };
      };

      expect(output.kind).toBe('hermes_memory_providers_status');
      expect(output.schemaVersion).toBe(1);
      expect(output.readiness.activeProviderId).toBe('mem0');
      expect(output.readiness.configuredRemoteCount).toBeGreaterThanOrEqual(1);
      expect(output.readiness.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'mem0',
            credentialSources: ['MEM0_API_KEY'],
            status: 'configured',
          }),
          expect.objectContaining({
            id: 'byterover',
            status: 'missing',
          }),
        ]),
      );
      expect(raw).not.toContain('secret-mem0-token');
      expect(raw).not.toContain('memory.example.test');
    } finally {
      for (const key of keys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetMemoryProviderRegistry();
    }
  });

  it('prints Hermes provider readiness as a dedicated status command without leaking secrets', async () => {
    const keys = ['CODEBUDDY_MODEL', 'OPENAI_API_KEY', 'CODEBUDDY_NOUS_ACCESS_TOKEN'];
    const originalEnv = new Map(keys.map((key) => [key, process.env[key]]));
    const program = createProgram();
    registerHermesCommands(program);

    try {
      for (const key of keys) {
        delete process.env[key];
      }
      process.env.CODEBUDDY_MODEL = 'gpt-5.5';
      process.env.OPENAI_API_KEY = 'secret-openai-provider-key';
      process.env.CODEBUDDY_NOUS_ACCESS_TOKEN = 'secret-nous-provider-token';

      await program.parseAsync(['node', 'test', 'hermes', 'provider', 'status', '--json']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        schemaVersion: number;
        readiness: {
          activeModel: {
            model: string;
            provider: string;
            supportsToolCalls: boolean;
          };
          activeProvider: {
            configured: boolean;
            credentialSources: string[];
            provider: string;
          };
          providers: unknown[];
        };
      };

      expect(output.kind).toBe('hermes_provider_readiness_status');
      expect(output.schemaVersion).toBe(1);
      expect(output.readiness.activeModel).toMatchObject({
        model: 'gpt-5.5',
        provider: 'openai',
        supportsToolCalls: true,
      });
      expect(output.readiness.activeProvider).toMatchObject({
        provider: 'openai',
        configured: true,
        credentialSources: expect.arrayContaining(['OPENAI_API_KEY']),
      });
      expect(output.readiness.providers.length).toBeGreaterThan(0);
      expect(raw).not.toContain('secret-openai-provider-key');
      expect(raw).not.toContain('secret-nous-provider-token');
    } finally {
      for (const key of keys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('prints Hermes mobile supervision readiness as a dedicated status command', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'hermes',
      'mobile',
      'status',
      'mobile',
      'supervision',
      'gateway',
      '--json',
    ]);

    const raw = getLogOutput();
    const output = JSON.parse(raw) as {
      kind: string;
      schemaVersion: number;
      ok: boolean;
      query: string;
      routeMount: {
        basePath: string;
        module: string;
        serverCommand: string;
        status: string;
      };
      summary: {
        readOnlyEndpoints: number;
        draftOnlyEndpoints: number;
        blockedOperations: number;
        pendingLocalApproval: number;
      };
      listener: {
        bind: { networkExposure: string };
        safety: {
          remoteExecutionDisabled: boolean;
          serverStarted: boolean;
        };
      };
      endpoints: Array<{
        action: string;
        localApprovalRequired: boolean;
        path: string;
        sideEffects: string;
      }>;
      approvalQueue: {
        autoDispatch: boolean;
        localOnly: boolean;
        remoteExecutionDisabled: boolean;
      };
      pairing: {
        status: string;
        tokenIssued: boolean;
      };
      commands: {
        server: string;
        approvals: string;
      };
    };

    expect(output.kind).toBe('hermes_mobile_supervision_status');
    expect(output.schemaVersion).toBe(1);
    expect(output.ok).toBe(true);
    expect(output.query).toBe('mobile supervision gateway');
    expect(output.routeMount).toMatchObject({
      basePath: '/api/mobile',
      module: 'src/server/routes/mobile.ts',
      serverCommand: 'buddy server --port 3000',
      status: 'implemented_not_probed',
    });
    expect(output.summary.readOnlyEndpoints).toBe(3);
    expect(output.summary.draftOnlyEndpoints).toBe(1);
    expect(output.summary.blockedOperations).toBeGreaterThanOrEqual(1);
    expect(output.summary.pendingLocalApproval).toBeGreaterThanOrEqual(1);
    expect(output.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'view_run_summary',
          path: '/api/mobile/snapshot',
          sideEffects: 'none',
        }),
        expect.objectContaining({
          action: 'draft_followup_prompt',
          path: '/api/mobile/followup-draft',
          localApprovalRequired: true,
          sideEffects: 'draft_only',
        }),
      ]),
    );
    expect(output.listener.bind.networkExposure).toBe('loopback_only');
    expect(output.listener.safety.remoteExecutionDisabled).toBe(true);
    expect(output.listener.safety.serverStarted).toBe(false);
    expect(output.approvalQueue).toMatchObject({
      autoDispatch: false,
      localOnly: true,
      remoteExecutionDisabled: true,
    });
    expect(output.pairing).toMatchObject({
      status: 'preview_only',
      tokenIssued: false,
    });
    expect(output.commands.server).toBe('buddy server --port 3000');
    expect(output.commands.approvals).toContain('buddy run mobile-approval-queue');
    expect(raw).not.toContain('previewCode');
  });

  it('prints Hermes runtime backend readiness as a dedicated status command', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'runtime', 'status', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      readiness: {
        availableCount: number;
        backends: Array<{ id: string; smokeCommand: string | null }>;
        runnableCount: number;
      };
    };

    expect(output.kind).toBe('hermes_runtime_backends_status');
    expect(output.schemaVersion).toBe(1);
    expect(output.readiness.backends.map((backend) => backend.id)).toContain('local');
    expect(output.readiness.runnableCount).toBeGreaterThanOrEqual(1);
    expect(output.readiness.availableCount).toBeGreaterThanOrEqual(1);
    expect(output.readiness.backends.find((backend) => backend.id === 'local')?.smokeCommand).toContain(
      'OK-HERMES-LOCAL',
    );
  });

  it('prints Hermes messaging gateway readiness without leaking channel secrets', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-messaging-status-'));
    const configPath = path.join(tmpDir, 'channels.json');
    await fs.writeJson(configPath, {
      channels: [
        {
          type: 'telegram',
          enabled: true,
          token: 'secret-telegram-token',
          allowedUsers: ['patrice'],
          options: { parseMode: 'markdown' },
        },
        {
          type: 'discord',
          enabled: false,
          webhookUrl: 'https://example.invalid/webhook',
        },
      ],
    });

    try {
      const program = createProgram();
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'messaging',
        'status',
        '--json',
        '--config',
        configPath,
      ]);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        schemaVersion: number;
        status: {
          config: {
            configuredCount: number;
            enabledCount: number;
            path?: string;
            channels: Array<{
              hasToken: boolean;
              hasWebhookUrl: boolean;
              type: string;
            }>;
          };
          kind: string;
          recommendations: string[];
          runtime: { registeredCount: number };
        };
      };

      expect(output.kind).toBe('hermes_messaging_gateway_status');
      expect(output.schemaVersion).toBe(1);
      expect(output.status.kind).toBe('codebuddy_channel_status');
      expect(output.status.config.path).toBe(configPath);
      expect(output.status.config.configuredCount).toBe(2);
      expect(output.status.config.enabledCount).toBe(1);
      expect(output.status.config.channels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'telegram', hasToken: true }),
          expect.objectContaining({ type: 'discord', hasWebhookUrl: true }),
        ]),
      );
      expect(output.status.runtime.registeredCount).toBeGreaterThanOrEqual(0);
      expect(output.status.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining('not registered')]),
      );
      expect(raw).not.toContain('secret-telegram-token');
      expect(raw).not.toContain('example.invalid/webhook');
    } finally {
      await fs.remove(tmpDir);
    }
  });

  it('prints the machine-checkable Hermes parity manifest', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'parity', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      officialSource: {
        repository: string;
        inspectedCommit: string;
        auditDocument: string;
      };
      summary: {
        total: number;
        partial: number;
        gaps: number;
      };
      features: Array<{
        id: string;
        status: string;
        codeBuddyEvidence: string[];
        verificationCommands: string[];
      }>;
    };

    expect(output.kind).toBe('hermes_official_parity_manifest');
    expect(output.schemaVersion).toBe(1);
    expect(output.officialSource.repository).toBe('https://github.com/NousResearch/hermes-agent');
    expect(output.officialSource.inspectedCommit).toBe('5921d667');
    expect(output.officialSource.auditDocument).toBe('docs/hermes-agent-official-parity-audit-2026-05-30.md');
    expect(output.summary.total).toBe(output.features.length);
    expect(output.summary.partial).toBeGreaterThan(0);
    expect(output.summary.gaps).toBeGreaterThan(0);
    expect(output.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'built-in-tools',
          status: 'covered-partial',
          codeBuddyEvidence: expect.arrayContaining([
            'src/agent/hermes-tool-parity-manifest.ts',
            'cowork/src/main/tools/hermes-tool-catalog-bridge.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'npx tsx src/index.ts hermes tools --json',
            'npm test -- tests/agent/hermes-tool-parity-local.test.ts --run',
          ]),
          notes: expect.stringContaining('0 partial, and 0 gaps'),
          nextWork: expect.not.stringContaining('Track tool-level parity'),
        }),
        expect.objectContaining({
          id: 'cron-scheduling',
          status: 'partial',
          codeBuddyEvidence: expect.arrayContaining([
            'src/commands/cron-cli/index.ts',
            'src/tools/cronjob-tool.ts',
            'tests/tools/cronjob-tool-real.test.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'npm test -- tests/commands/cron-cli.test.ts tests/scheduler/cron-scheduler-manual-run.test.ts --run',
            'npm test -- tests/tools/cronjob-tool-real.test.ts --run',
          ]),
          notes: expect.stringContaining('exact agent-facing cronjob prompt tool'),
          nextWork: expect.not.stringContaining('Add exact agent-facing cronjob tool'),
        }),
        expect.objectContaining({
          id: 'browser-automation',
          status: 'partial',
          codeBuddyEvidence: expect.arrayContaining(['src/agent/hermes-browser-backends.ts']),
          verificationCommands: expect.arrayContaining([
            'npx tsx src/index.ts hermes browser status --json',
            'npx tsx src/index.ts hermes browser-smoke local-playwright --json',
            'npm test -- tests/agent/hermes-browser-backends-smoke-real.test.ts --run',
          ]),
          notes: expect.stringContaining('machine-readable backend readiness'),
          nextWork: expect.not.stringContaining('Create backend-specific browser smoke tests and status output'),
        }),
        expect.objectContaining({
          id: 'prompt-size',
          status: 'covered-partial',
          verificationCommands: expect.arrayContaining([
            'npx tsx src/index.ts hermes prompt-size safe --json',
          ]),
        }),
        expect.objectContaining({
          id: 'kanban',
          status: 'covered-partial',
          codeBuddyEvidence: expect.arrayContaining(['src/kanban/kanban-store.ts']),
          verificationCommands: expect.arrayContaining([
            'npm test -- tests/tools/kanban-real.test.ts --run',
          ]),
        }),
        expect.objectContaining({
          id: 'nous-portal',
          status: 'covered-partial',
          codeBuddyEvidence: expect.arrayContaining(['src/agent/hermes-portal-status.ts']),
          verificationCommands: expect.arrayContaining([
            'npx tsx src/index.ts hermes portal status --json',
          ]),
        }),
        expect.objectContaining({
          id: 'memory-providers',
          status: 'partial',
          codeBuddyEvidence: expect.arrayContaining(['src/agent/hermes-memory-providers.ts']),
          verificationCommands: expect.arrayContaining([
            'npx tsx src/index.ts hermes memory status --json',
          ]),
          notes: expect.stringContaining('secret-safe provider readiness matrix'),
        }),
      ]),
    );
  });

  it('prints real local Nous Portal readiness without leaking secrets', async () => {
    const program = createProgram();
    registerHermesCommands(program);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-portal-cli-'));
    const managedKeys = [
      'CODEBUDDY_NOUS_ACCESS_TOKEN',
      'CODEBUDDY_NOUS_API_KEY',
      'NOUS_ACCESS_TOKEN',
      'NOUS_PORTAL_ACCESS_TOKEN',
      'NOUS_API_KEY',
      'CODEBUDDY_NOUS_AUTH_FILE',
      'CODEBUDDY_NOUS_TOOL_GATEWAY_URL',
      'NOUS_TOOL_GATEWAY_URL',
      'CODEBUDDY_NOUS_TOOL_GATEWAY',
      'NOUS_TOOL_GATEWAY',
      'CODEBUDDY_NOUS_MANAGED_TOOLS',
      'NOUS_MANAGED_TOOLS',
      'FIRECRAWL_API_KEY',
      'XAI_API_KEY',
      'OPENAI_API_KEY',
      'CODEBUDDY_IMAGE_API_KEY',
      'CODEBUDDY_TTS_PROVIDER',
      'CODEBUDDY_AUDIOREADER_URL',
      'BROWSER_USE_API_KEY',
      'BROWSERBASE_API_KEY',
      'CODEBUDDY_BROWSER_CDP_URL',
      'MODAL_TOKEN_ID',
      'MODAL_TOKEN_SECRET',
      'CODEBUDDY_MODAL_TOKEN',
    ];
    const originalEnv = new Map(managedKeys.map((key) => [key, process.env[key]]));

    try {
      for (const key of managedKeys) {
        delete process.env[key];
      }
      process.env.CODEBUDDY_NOUS_ACCESS_TOKEN = 'secret-nous-token';
      process.env.CODEBUDDY_NOUS_AUTH_FILE = path.join(tmpDir, 'missing-nous-auth.json');
      process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL = 'https://gateway.example.test';
      process.env.CODEBUDDY_NOUS_MANAGED_TOOLS = 'web,tts';
      process.env.FIRECRAWL_API_KEY = 'secret-firecrawl-key';
      process.env.XAI_API_KEY = 'secret-xai-key';

      await program.parseAsync(['node', 'test', 'hermes', 'portal', 'status', '--json']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        officialSource: { inspectedCommit: string; sourceFiles: string[] };
        portal: {
          credentialPresent: boolean;
          credentialSources: string[];
          authFilePresent: boolean;
          toolGatewayConfigured: boolean;
          toolGatewayUrl: string;
        };
        toolGateway: {
          managedByNousCount: number;
          tools: Array<{
            key: string;
            managedByNous: boolean;
            currentProvider: string | null;
            credentialEnv: string[];
          }>;
        };
      };

      expect(output.kind).toBe('hermes_portal_status');
      expect(output.officialSource.inspectedCommit).toBe('5921d667');
      expect(output.officialSource.sourceFiles).toContain('hermes_cli/portal_cli.py');
      expect(output.portal.credentialPresent).toBe(true);
      expect(output.portal.credentialSources).toContain('CODEBUDDY_NOUS_ACCESS_TOKEN');
      expect(output.portal.authFilePresent).toBe(false);
      expect(output.portal.toolGatewayConfigured).toBe(true);
      expect(output.portal.toolGatewayUrl).toBe('https://gateway.example.test');
      expect(output.toolGateway.managedByNousCount).toBe(2);
      expect(output.toolGateway.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'web',
            managedByNous: true,
            currentProvider: 'Nous Portal Tool Gateway',
            credentialEnv: ['FIRECRAWL_API_KEY'],
          }),
          expect.objectContaining({
            key: 'tts',
            managedByNous: true,
            currentProvider: 'Nous Portal Tool Gateway',
          }),
          expect.objectContaining({
            key: 'image_gen',
            managedByNous: false,
            currentProvider: 'xAI image direct',
            credentialEnv: ['XAI_API_KEY'],
          }),
        ]),
      );
      expect(raw).not.toContain('secret-nous-token');
      expect(raw).not.toContain('secret-firecrawl-key');
      expect(raw).not.toContain('secret-xai-key');
    } finally {
      for (const key of managedKeys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await fs.remove(tmpDir);
    }
  });

  it('prints the Hermes Portal tool catalog and subscription URL', async () => {
    let program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'portal', 'tools']);

    const toolsOutput = getLogOutput();
    expect(toolsOutput).toContain('Hermes Nous Portal Tool Gateway tools:');
    expect(toolsOutput).toContain('Web search & extract');
    expect(toolsOutput).toContain('Browser automation');

    consoleLogSpy.mockClear();
    program = createProgram();
    registerHermesCommands(program);
    await program.parseAsync(['node', 'test', 'hermes', 'portal', 'open', '--json']);

    const openOutput = JSON.parse(getLogOutput()) as {
      kind: string;
      url: string;
      docsUrl: string;
    };
    expect(openOutput.kind).toBe('hermes_portal_open');
    expect(openOutput.url).toBe('https://portal.nousresearch.com/manage-subscription');
    expect(openOutput.docsUrl).toContain('tool-gateway');
  });

  it('prints Markdown for the Hermes parity manifest', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'parity', '--markdown']);

    const output = getLogOutput();
    expect(output).toContain('# Hermes Official Parity Manifest');
    expect(output).toContain('## Summary');
    expect(output).toContain('### Cron/scheduling');
    expect(output).toContain('- ID: `cron-scheduling`');
    expect(output).toContain('- Verification commands:');
    expect(output).toContain('`npx tsx src/index.ts hermes prompt-size safe --json`');
  });

  it('prints JSON for official Hermes tool parity', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'tools-parity', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      officialSource: {
        inspectedCommit: string;
        sourceFiles: string[];
      };
      codeBuddySource: {
        localToolCount: number;
        localToolNames: string[];
      };
      summary: {
        total: number;
        exact: number;
        nativeEquivalent: number;
        partial: number;
        gaps: number;
      };
      tools: Array<{
        name: string;
        status: string;
        detectedCodeBuddyTools: string[];
        missingExpectedCodeBuddyTools: string[];
      }>;
    };

    expect(output.kind).toBe('hermes_official_tool_parity_manifest');
    expect(output.schemaVersion).toBe(1);
    expect(output.officialSource.inspectedCommit).toBe('5921d667');
    expect(output.officialSource.sourceFiles).toContain('toolsets.py::_HERMES_CORE_TOOLS');
    expect(output.officialSource.sourceFiles).toContain('tools/skill_manager_tool.py');
    expect(output.codeBuddySource.localToolCount).toBeGreaterThan(0);
    expect(output.codeBuddySource.localToolNames).toContain('browser');
    expect(output.summary.total).toBe(output.tools.length);
    expect(output.summary.nativeEquivalent).toBeGreaterThan(0);
    expect(output.summary.partial).toBe(0);
    expect(output.summary.gaps).toBe(0);
    expect(output.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'web_search',
          status: 'exact',
          detectedCodeBuddyTools: ['web_search'],
        }),
        expect.objectContaining({
          name: 'terminal',
          status: 'exact',
          detectedCodeBuddyTools: ['terminal'],
        }),
        expect.objectContaining({
          name: 'read_file',
          status: 'exact',
          detectedCodeBuddyTools: ['read_file'],
        }),
        expect.objectContaining({
          name: 'write_file',
          status: 'exact',
          detectedCodeBuddyTools: ['write_file'],
        }),
        expect.objectContaining({
          name: 'patch',
          status: 'exact',
          detectedCodeBuddyTools: ['patch'],
        }),
        expect.objectContaining({
          name: 'search_files',
          status: 'exact',
          detectedCodeBuddyTools: ['search_files'],
        }),
        expect.objectContaining({
          name: 'web_extract',
          status: 'exact',
          detectedCodeBuddyTools: ['web_extract'],
        }),
        expect.objectContaining({
          name: 'cronjob',
          status: 'exact',
          detectedCodeBuddyTools: ['cronjob'],
        }),
        expect.objectContaining({
          name: 'skills_list',
          status: 'exact',
          detectedCodeBuddyTools: ['skills_list'],
        }),
        expect.objectContaining({
          name: 'skill_view',
          status: 'exact',
          detectedCodeBuddyTools: ['skill_view'],
        }),
        expect.objectContaining({
          name: 'skill_manage',
          status: 'exact',
          detectedCodeBuddyTools: expect.arrayContaining([
            'skill_manage',
            'skills_list',
            'skill_view',
            'create_skill',
            'skill_discover',
          ]),
        }),
        expect.objectContaining({
          name: 'browser_get_images',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_get_images'],
        }),
        expect.objectContaining({
          name: 'browser_console',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_console'],
        }),
        expect.objectContaining({
          name: 'browser_snapshot',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_snapshot'],
        }),
        expect.objectContaining({
          name: 'browser_navigate',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_navigate'],
        }),
        expect.objectContaining({
          name: 'browser_click',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_click'],
        }),
        expect.objectContaining({
          name: 'browser_type',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_type'],
        }),
        expect.objectContaining({
          name: 'browser_scroll',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_scroll'],
        }),
        expect.objectContaining({
          name: 'browser_back',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_back'],
        }),
        expect.objectContaining({
          name: 'browser_press',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_press'],
        }),
        expect.objectContaining({
          name: 'browser_vision',
          status: 'exact',
          detectedCodeBuddyTools: expect.arrayContaining(['browser_vision']),
        }),
        expect.objectContaining({
          name: 'browser_dialog',
          status: 'exact',
          detectedCodeBuddyTools: ['browser_dialog'],
        }),
        expect.objectContaining({
          name: 'execute_code',
          status: 'exact',
          detectedCodeBuddyTools: expect.arrayContaining(['execute_code']),
        }),
        expect.objectContaining({
          name: 'kanban_create',
          status: 'exact',
          detectedCodeBuddyTools: ['kanban_create'],
        }),
        expect.objectContaining({
          name: 'kanban_complete',
          status: 'exact',
          detectedCodeBuddyTools: ['kanban_complete'],
        }),
        expect.objectContaining({
          name: 'send_message',
          status: 'exact',
          detectedCodeBuddyTools: ['send_message'],
        }),
        expect.objectContaining({
          name: 'discord',
          status: 'exact',
          detectedCodeBuddyTools: ['discord'],
        }),
        expect.objectContaining({
          name: 'ha_list_entities',
          status: 'exact',
          detectedCodeBuddyTools: ['ha_list_entities'],
        }),
        expect.objectContaining({
          name: 'ha_get_state',
          status: 'exact',
          detectedCodeBuddyTools: ['ha_get_state'],
        }),
        expect.objectContaining({
          name: 'ha_list_services',
          status: 'exact',
          detectedCodeBuddyTools: ['ha_list_services'],
        }),
        expect.objectContaining({
          name: 'ha_call_service',
          status: 'exact',
          detectedCodeBuddyTools: ['ha_call_service'],
        }),
        expect.objectContaining({
          name: 'mixture_of_agents',
          status: 'exact',
          detectedCodeBuddyTools: expect.arrayContaining(['mixture_of_agents']),
        }),
        expect.objectContaining({
          name: 'spotify_playback',
          status: 'exact',
          detectedCodeBuddyTools: ['spotify_playback'],
        }),
        expect.objectContaining({
          name: 'spotify_search',
          status: 'exact',
          detectedCodeBuddyTools: ['spotify_search'],
        }),
        expect.objectContaining({
          name: 'spotify_library',
          status: 'exact',
          detectedCodeBuddyTools: ['spotify_library'],
        }),
        expect.objectContaining({
          name: 'x_search',
          status: 'exact',
          detectedCodeBuddyTools: ['x_search'],
        }),
        expect.objectContaining({
          name: 'yb_query_group_info',
          status: 'exact',
          detectedCodeBuddyTools: ['yb_query_group_info'],
        }),
        expect.objectContaining({
          name: 'yb_send_sticker',
          status: 'exact',
          detectedCodeBuddyTools: ['yb_send_sticker'],
        }),
        expect.objectContaining({
          name: 'vision_analyze',
          status: 'exact',
          detectedCodeBuddyTools: expect.arrayContaining(['vision_analyze']),
        }),
        expect.objectContaining({
          name: 'text_to_speech',
          status: 'exact',
          detectedCodeBuddyTools: expect.arrayContaining(['text_to_speech']),
        }),
      ]),
    );
  });

  it('manages a real Hermes Kanban board through the CLI surface', async () => {
    const originalCwd = process.cwd();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-kanban-cli-'));
    try {
      process.chdir(tmpDir);

      let program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'kanban',
        'create',
        'Close Hermes Kanban parity',
        '--id',
        'kb-cli',
        '--priority',
        'high',
        '--tag',
        'hermes,parity',
        '--json',
      ]);
      let output = JSON.parse(getLogOutput()) as {
        kind: string;
        boardPath: string;
        card: { id: string; priority: string; tags: string[] };
      };
      expect(output.kind).toBe('hermes_kanban_create');
      expect(output.card).toMatchObject({
        id: 'kb-cli',
        priority: 'high',
        tags: ['hermes', 'parity'],
      });
      expect(output.boardPath).toBe(path.join(tmpDir, '.codebuddy', 'kanban-board.json'));

      consoleLogSpy.mockClear();
      program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'kanban',
        'complete',
        'kb-cli',
        '--comment',
        'CLI path verified',
        '--json',
      ]);
      const completedOutput = JSON.parse(getLogOutput()) as {
        kind: string;
        card: { status: string; comments: Array<{ text: string }> };
      };
      expect(completedOutput.kind).toBe('hermes_kanban_complete');
      expect(completedOutput.card.status).toBe('done');
      expect(completedOutput.card.comments).toEqual([
        expect.objectContaining({ text: 'CLI path verified' }),
      ]);

      consoleLogSpy.mockClear();
      program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync(['node', 'test', 'hermes', 'kanban', 'list', '--json']);
      const listed = JSON.parse(getLogOutput()) as {
        kind: string;
        count: number;
        cards: Array<{ id: string; status: string }>;
      };
      expect(listed.kind).toBe('hermes_kanban_list');
      expect(listed.count).toBe(1);
      expect(listed.cards).toEqual([
        expect.objectContaining({ id: 'kb-cli', status: 'done' }),
      ]);

      await expect(fs.readJson(path.join(tmpDir, '.codebuddy', 'kanban-board.json'))).resolves.toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          cards: expect.arrayContaining([
            expect.objectContaining({ id: 'kb-cli', status: 'done' }),
          ]),
        }),
      );
    } finally {
      process.chdir(originalCwd);
      await fs.remove(tmpDir);
    }
  });

  it('accepts hermes tools as a discoverable alias for tool parity', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'tools', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      summary: {
        gaps: number;
        total: number;
      };
    };

    expect(output.kind).toBe('hermes_official_tool_parity_manifest');
    expect(output.summary.total).toBeGreaterThan(0);
    expect(output.summary.gaps).toBe(0);
  });

  it('prints a dedicated Hermes toolsets catalog', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'toolsets', 'safe', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      activeProfile: string;
      officialSource: { sourceFiles: string[] };
      previewTools: string[];
      summary: { totalToolsets: number; profiles: string[] };
      activeToolset: {
        toolsetId: string;
        defaultAction: string;
        deniedTools: string[];
      };
      toolsets: Array<{
        profile: string;
        toolsetId: string;
        allowedTools: string[];
        confirmTools: string[];
        deniedTools: string[];
      }>;
    };

    expect(output.kind).toBe('hermes_toolsets_catalog');
    expect(output.activeProfile).toBe('safe');
    expect(output.officialSource.sourceFiles).toContain('toolsets.py::TOOLSETS');
    expect(output.previewTools).toContain('bash');
    expect(output.summary.totalToolsets).toBe(5);
    expect(output.summary.profiles).toEqual(['balanced', 'research', 'code', 'review', 'safe']);
    expect(output.activeToolset).toMatchObject({
      toolsetId: 'fleet.hermes.safe',
      defaultAction: 'deny',
      deniedTools: expect.arrayContaining(['create_file', 'bash', 'git_push', 'delete_file']),
    });
    expect(output.toolsets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profile: 'code',
          toolsetId: 'fleet.hermes.code',
          allowedTools: expect.arrayContaining(['create_file', 'web_fetch']),
          confirmTools: expect.arrayContaining(['bash', 'git_push']),
        }),
        expect.objectContaining({
          profile: 'review',
          deniedTools: expect.arrayContaining(['create_file', 'bash']),
        }),
      ]),
    );
  });

  it('prints readable Hermes toolsets output', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'toolsets', 'review']);

    const output = getLogOutput();
    expect(output).toContain('Hermes toolsets catalog: 5 Fleet profiles');
    expect(output).toContain('Active toolset: fleet.hermes.review');
    expect(output).toContain('Profiles:');
    expect(output).toContain('review: read-first code review');
    expect(output).toContain('Denied preview tools: create_file, bash, git_push, delete_file');
  });

  it('prints Markdown for official Hermes tool parity', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'tools-parity', '--markdown']);

    const output = getLogOutput();
    expect(output).toContain('# Hermes Official Tool Parity Manifest');
    expect(output).toContain('## Summary');
    expect(output).toContain('### terminal');
    expect(output).toContain('### read_file');
    expect(output).toContain('### write_file');
    expect(output).toContain('### patch');
    expect(output).toContain('### search_files');
    expect(output).toContain('### web_extract');
    expect(output).toContain('### browser_navigate');
    expect(output).toContain('### browser_snapshot');
    expect(output).toContain('### browser_click');
    expect(output).toContain('### browser_type');
    expect(output).toContain('### browser_scroll');
    expect(output).toContain('### browser_back');
    expect(output).toContain('### browser_press');
    expect(output).toContain('### browser_console');
    expect(output).toContain('### browser_get_images');
    expect(output).toContain('### browser_dialog');
    expect(output).toContain('- Status: `exact`');
    expect(output).toContain('`toolsets.py::_HERMES_CORE_TOOLS`');
  });

  it('prints JSON for the Hermes integration plan', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'plan', '--json', 'safe']);

    const output = JSON.parse(getLogOutput()) as {
      plan: {
        planSchemaVersion: number;
        generatedAt: string;
        summary: string;
        dispatchProfile: string;
        toolsetId: string;
        recommendedNextCommand: string;
        surfaceIds: string[];
        items: Array<{
          id: string;
          kind: string;
          risk: string;
          command: string;
          expectedArtifacts: string[];
          acceptanceCriteria: string[];
        }>;
        interactionSurfaces: Array<{
          id: string;
          entrypoint: string;
          consumes: string[];
          produces: string[];
        }>;
      };
    };

    expect(output.plan.planSchemaVersion).toBe(1);
    expect(output.plan.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(output.plan.summary).toContain('toolset-aware');
    expect(output.plan.dispatchProfile).toBe('safe');
    expect(output.plan.toolsetId).toBe('fleet.hermes.safe');
    expect(output.plan.recommendedNextCommand).toBe('buddy hermes doctor safe --json');
    expect(output.plan.surfaceIds).toEqual(['toolsets', 'delegation', 'lessons']);
    expect(output.plan.interactionSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cli',
          entrypoint: 'buddy hermes plan safe --json',
          produces: expect.arrayContaining(['stable JSON plan']),
        }),
        expect.objectContaining({
          id: 'cowork',
          consumes: expect.arrayContaining(['toolset fleet.hermes.safe']),
        }),
      ]),
    );
    expect(output.plan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'export-lessons-vault',
          kind: 'prepare',
          risk: 'local-write',
          expectedArtifacts: expect.arrayContaining(['.codebuddy/lessons-vault/manifest.json']),
          acceptanceCriteria: expect.arrayContaining([
            expect.stringContaining('manifest.json'),
          ]),
          command: expect.stringContaining('buddy lessons graph --no-keywords --vault'),
        }),
      ]),
    );
  });

  it('prints a readable Hermes integration plan', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'plan', 'safe']);

    const output = getLogOutput();
    expect(output).toContain('Hermes integration plan (safe, fleet.hermes.safe):');
    expect(output).toContain('Plan schema version: 1');
    expect(output).toContain('Generated:');
    expect(output).toContain('Recommended next command: buddy hermes doctor safe --json');
    expect(output).toContain('Surfaces: toolsets, delegation, lessons');
    expect(output).toContain('Interaction surfaces:');
    expect(output).toContain('CLI: buddy hermes plan safe --json');
    expect(output).toContain('Cowork: Fleet Command Center Hermes plan strip');
    expect(output).toContain('Inspect the Hermes runtime mapping');
    expect(output).toContain('Export a navigable lessons vault');
    expect(output).toContain('Kind: prepare');
    expect(output).toContain('Risk: local-write');
    expect(output).toContain('Expected artifacts: .codebuddy/lessons-vault/index.md');
    expect(output).toContain('Acceptance criteria: The generated vault includes a manifest.json file.');
    expect(output).toContain('Command: buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault');
    expect(output).toContain('Done when:');
  });

  it('prints Markdown for the Hermes integration plan', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'plan', '--markdown', 'safe']);

    const output = getLogOutput();
    expect(output).toContain('# Hermes Integration Plan (safe)');
    expect(output).toContain('- Plan schema version: `1`');
    expect(output).toContain('- Toolset: `fleet.hermes.safe`');
    expect(output).toContain('## Interaction Surfaces');
    expect(output).toContain('### CLI');
    expect(output).toContain('- Entrypoint: `buddy hermes plan safe --json`');
    expect(output).toContain('### Cowork');
    expect(output).toContain('### Export a navigable lessons vault');
    expect(output).toContain('- Kind: `prepare`');
    expect(output).toContain('- Risk: `local-write`');
    expect(output).toContain('- Expected artifacts:');
    expect(output).toContain('  - `.codebuddy/lessons-vault/manifest.json`');
    expect(output).toContain('- Acceptance criteria:');
    expect(output).toContain('  - The generated vault includes a manifest.json file.');
    expect(output).toContain('- Command: `buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault`');
  });

  it('prints JSON for the Hermes hook lifecycle manifest', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'hooks', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      stages: Array<{
        stage: string;
        userHookEvent: string;
        coreTouchpoint: string;
      }>;
    };

    expect(output.kind).toBe('hermes_hook_lifecycle_manifest');
    expect(output.schemaVersion).toBe(1);
    expect(output.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'before_memory_write',
          userHookEvent: 'BeforeMemoryWrite',
          coreTouchpoint: 'src/tools/registry/memory-tools.ts',
        }),
        expect.objectContaining({
          stage: 'before_scheduled_delivery',
          userHookEvent: 'BeforeScheduledDelivery',
          coreTouchpoint: 'src/daemon/cron-agent-bridge.ts',
        }),
      ]),
    );
  });

  it('prints readable Hermes hook lifecycle output', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'hooks']);

    const output = getLogOutput();
    expect(output).toContain('Hermes hook lifecycle:');
    expect(output).toContain('Before memory write (before_memory_write)');
    expect(output).toContain('Before scheduled delivery (before_scheduled_delivery)');
    expect(output).toContain('User event: AfterRunComplete');
  });

  it('writes the Hermes integration plan to a Markdown file', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-hermes-plan-'));
    const outputPath = path.join(tempDir, 'handoff', 'hermes-plan.md');
    const program = createProgram();
    registerHermesCommands(program);

    try {
      await program.parseAsync(['node', 'test', 'hermes', 'plan', 'safe', '--plan-output', outputPath]);

      const output = await fs.readFile(outputPath, 'utf-8');
      expect(output).toContain('# Hermes Integration Plan (safe)');
      expect(output).toContain('- Recommended next command: `buddy hermes doctor safe --json`');
      expect(getLogOutput()).toContain('Hermes plan exported to');
    } finally {
      await fs.remove(tempDir);
    }
  });

  it('prints Hermes doctor output for the active profile', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'doctor', 'safe']);

    const output = getLogOutput();
    expect(output).toContain('Hermes Agent doctor:');
    expect(output).toContain('Active toolset: fleet.hermes.safe');
    expect(output).toContain('Agent default dispatch profile: balanced');
    expect(output).toContain('Provider/model readiness:');
    expect(output).toContain('Capabilities: tool-calls=');
    expect(output).toContain('Nous Tool Gateway:');
    expect(output).toContain('Dispatch profile selection:');
    expect(output).toContain('safe: high-risk');
    expect(output).toContain('Native surfaces:');
  });

  it('prints Hermes doctor JSON with provider readiness and no secret leakage', async () => {
    const managedKeys = [
      'CODEBUDDY_MODEL',
      'OPENAI_API_KEY',
      'CODEBUDDY_NOUS_ACCESS_TOKEN',
      'CODEBUDDY_NOUS_TOOL_GATEWAY_URL',
      'CODEBUDDY_NOUS_MANAGED_TOOLS',
    ];
    const originalEnv = new Map(managedKeys.map((key) => [key, process.env[key]]));
    const program = createProgram();
    registerHermesCommands(program);

    try {
      for (const key of managedKeys) {
        delete process.env[key];
      }
      process.env.CODEBUDDY_MODEL = 'gpt-5.5';
      process.env.OPENAI_API_KEY = 'secret-openai-key';
      process.env.CODEBUDDY_NOUS_ACCESS_TOKEN = 'secret-nous-token';
      process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL = 'https://gateway.example.test';
      process.env.CODEBUDDY_NOUS_MANAGED_TOOLS = 'web,browser';

      await program.parseAsync(['node', 'test', 'hermes', 'doctor', 'balanced', '--json']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        diagnostics: {
          providerReadiness: {
            ok: boolean;
            activeModel: {
              model: string;
              provider: string;
              supportsToolCalls: boolean;
              supportsReasoning: boolean;
              supportsVision: boolean;
            };
            activeProvider: {
              provider: string;
              configured: boolean;
              credentialSources: string[];
            };
            portal: {
              portal: {
                credentialSources: string[];
                toolGatewayConfigured: boolean;
              };
              toolGateway: {
                managedByNousCount: number;
              };
            };
          };
          runtimeBackends: {
            backends: Array<{
              id: string;
              runnable: boolean;
              smokeCommand: string | null;
              status: string;
            }>;
            runnableCount: number;
          };
          browserBackends: {
            backends: Array<{
              id: string;
              runnable: boolean;
              smokeCommand: string | null;
              status: string;
            }>;
            localRunnableCount: number;
          };
        };
      };

      expect(output.diagnostics.providerReadiness.ok).toBe(true);
      expect(output.diagnostics.providerReadiness.activeModel).toMatchObject({
        model: 'gpt-5.5',
        provider: 'openai',
        supportsToolCalls: true,
        supportsReasoning: true,
        supportsVision: true,
      });
      expect(output.diagnostics.providerReadiness.activeProvider).toMatchObject({
        provider: 'openai',
        configured: true,
        credentialSources: expect.arrayContaining(['OPENAI_API_KEY']),
      });
      expect(output.diagnostics.providerReadiness.portal.portal.credentialSources).toContain('CODEBUDDY_NOUS_ACCESS_TOKEN');
      expect(output.diagnostics.providerReadiness.portal.portal.toolGatewayConfigured).toBe(true);
      expect(output.diagnostics.providerReadiness.portal.toolGateway.managedByNousCount).toBe(2);
      expect(output.diagnostics.runtimeBackends.backends).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'local',
            runnable: true,
            status: 'available',
            smokeCommand: expect.stringContaining('OK-HERMES-LOCAL'),
          }),
        ]),
      );
      expect(output.diagnostics.runtimeBackends.runnableCount).toBeGreaterThanOrEqual(1);
      expect(output.diagnostics.browserBackends.backends).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'local-playwright',
            runnable: true,
            status: 'available',
            smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          }),
        ]),
      );
      expect(output.diagnostics.browserBackends.localRunnableCount).toBeGreaterThanOrEqual(1);
      expect(raw).not.toContain('secret-openai-key');
      expect(raw).not.toContain('secret-nous-token');
    } finally {
      for (const key of managedKeys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('runs a real local Hermes runtime smoke from the CLI', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'runtime-smoke', 'local', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      result: {
        backendId: string;
        command: string | null;
        ok: boolean;
        output: string;
        status: string;
        stdout: string;
      };
    };

    expect(output.kind).toBe('hermes_runtime_backend_smoke');
    expect(output.schemaVersion).toBe(1);
    expect(output.result).toMatchObject({
      backendId: 'local',
      command: process.execPath,
      ok: true,
      status: 'passed',
    });
    expect(output.result.stdout).toContain('OK-HERMES-LOCAL');
    expect(output.result.output).toContain('OK-HERMES-LOCAL');
  });

  it('prints Hermes browser backend status from real local probes', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'browser', 'status', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      readiness: {
        backends: Array<{
          id: string;
          runnable: boolean;
          smokeCommand: string | null;
          status: string;
        }>;
        localRunnableCount: number;
      };
    };

    expect(output.kind).toBe('hermes_browser_backends_status');
    expect(output.schemaVersion).toBe(1);
    expect(output.readiness.backends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-playwright',
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          status: 'available',
        }),
        expect.objectContaining({
          id: 'session-recording',
          runnable: false,
          status: 'missing',
        }),
      ]),
    );
    expect(output.readiness.localRunnableCount).toBeGreaterThanOrEqual(1);
  });

  it('runs a real local Hermes browser smoke from the CLI', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'browser-smoke', 'local-playwright', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      result: {
        backendId: string;
        command: string | null;
        ok: boolean;
        output: string;
        status: string;
        stdout: string;
      };
    };

    expect(output.kind).toBe('hermes_browser_backend_smoke');
    expect(output.schemaVersion).toBe(1);
    expect(output.result).toMatchObject({
      backendId: 'local-playwright',
      command: process.execPath,
      ok: true,
      status: 'passed',
    });
    expect(output.result.stdout).toContain('OK-HERMES-BROWSER');
    expect(output.result.output).toContain('OK-HERMES-BROWSER');
  });
});
