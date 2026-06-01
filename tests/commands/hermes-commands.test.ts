import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHermesCommands } from '../../src/commands/cli/hermes-commands.js';
import { runLearningRetrospective } from '../../src/agent/learning-agent.js';
import { resetLessonCandidateQueues } from '../../src/agent/lesson-candidate-queue.js';
import { resetMemoryProviderRegistry } from '../../src/memory/memory-provider.js';
import { getUserModel, resetUserModels } from '../../src/memory/user-model.js';
import { RunStore } from '../../src/observability/run-store.js';
import { resetDataRedactionEngine } from '../../src/security/data-redaction.js';
import { SkillsHub } from '../../src/skills/hub.js';

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
const nodeDisplayCommand = path.basename(process.execPath);

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

function createSkillContent(name: string, description = `${name} test skill`): string {
  return [
    '---',
    `name: ${name}`,
    'version: 1.0.0',
    `description: ${description}`,
    'author: Code Buddy Test',
    'tags:',
    '  - hermes',
    '  - testing',
    '---',
    '',
    `# ${name}`,
    '',
    `Body for ${name} should stay out of Hermes status output.`,
    '',
  ].join('\n');
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
        runtimeMapping: {
          codeBuddyRuntime: string;
          implementation: string;
          upstreamLanguage: string;
          upstreamRuntime: string;
        };
        toolsets: Array<{ toolsetId: string }>;
      };
    };

    expect(output.profile.id).toBe('hermes');
    expect(output.profile.defaultDispatchProfile).toBe('review');
    expect(output.profile.runtimeMapping).toMatchObject({
      codeBuddyRuntime: 'typescript-fleet',
      implementation: 'code-buddy-native',
      upstreamLanguage: 'python',
      upstreamRuntime: 'not-vendored',
    });
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

  it('prints Hermes Agent identity status without dumping the full prompt', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'identity', 'status', 'safe', '--json']);

    const raw = getLogOutput();
    const output = JSON.parse(raw) as {
      commands: {
        doctor: string;
        prompt: string;
        run: string;
      };
      identity: {
        activeToolset: string;
        dispatchProfile: string;
        effectiveAllow: string[];
        effectiveDeny: string[];
        nativeSurfaces: string[];
        promptChecks: {
          mentionsCodeBuddyRuntime: boolean;
          mentionsDefaultToolset: boolean;
          mentionsExternalRuntimeBoundary: boolean;
        };
        requireExplicitDispatchProfile: boolean;
        runtimeMapping: {
          codeBuddyRuntime: string;
          implementation: string;
          upstreamRuntime: string;
        };
        source: string;
        userOverride: boolean;
      };
      kind: string;
      ok: boolean;
      requestedProfile: string;
      schemaVersion: number;
    };

    expect(output).toMatchObject({
      kind: 'hermes_agent_identity_status',
      ok: true,
      requestedProfile: 'safe',
      schemaVersion: 1,
      identity: {
        activeToolset: 'fleet.hermes.safe',
        dispatchProfile: 'safe',
        requireExplicitDispatchProfile: true,
        runtimeMapping: {
          codeBuddyRuntime: 'typescript-fleet',
          implementation: 'code-buddy-native',
          upstreamRuntime: 'not-vendored',
        },
        source: 'built-in',
        userOverride: false,
      },
      commands: {
        doctor: 'buddy hermes doctor safe --json',
        prompt: 'buddy hermes agent safe',
        run: 'buddy --agent hermes',
      },
    });
    expect(output.identity.effectiveAllow).toEqual(['view_file', 'web_search', 'web_fetch']);
    expect(output.identity.effectiveDeny).toEqual(['create_file', 'bash', 'git_push', 'delete_file']);
    expect(output.identity.nativeSurfaces).toEqual(expect.arrayContaining(['toolsets', 'skills', 'memory']));
    expect(Object.values(output.identity.promptChecks).every(Boolean)).toBe(true);
    expect(raw).not.toContain('Do not pretend to be the external Hermes Python runtime');

    consoleLogSpy.mockClear();
    const textProgram = createProgram();
    registerHermesCommands(textProgram);
    await textProgram.parseAsync(['node', 'test', 'hermes', 'id', 'status', 'safe']);
    const textOutput = getLogOutput();
    expect(textOutput).toContain('Hermes Agent identity: ok');
    expect(textOutput).toContain('Runtime mapping: code-buddy-native');
    expect(textOutput).toContain('Active toolset: fleet.hermes.safe');
    expect(textOutput).toContain('Run: buddy --agent hermes');
    expect(textOutput).toContain('Doctor: buddy hermes doctor safe --json');
    expect(textOutput).not.toContain('Do not pretend to be the external Hermes Python runtime');
  });

  it('prints a compact Hermes overview without leaking configured secret values', async () => {
    const keys = ['CODEBUDDY_MODEL', 'OPENAI_API_KEY', 'CODEBUDDY_NOUS_ACCESS_TOKEN', 'MEM0_API_KEY', 'MEM0_BASE_URL'];
    const originalEnv = new Map(keys.map((key) => [key, process.env[key]]));
    const program = createProgram();
    registerHermesCommands(program);

    try {
      for (const key of keys) {
        delete process.env[key];
      }
      process.env.CODEBUDDY_MODEL = 'gpt-5.5';
      process.env.OPENAI_API_KEY = 'secret-overview-openai-key';
      process.env.CODEBUDDY_NOUS_ACCESS_TOKEN = 'secret-overview-nous-token';
      process.env.MEM0_API_KEY = 'secret-overview-mem0-key';
      process.env.MEM0_BASE_URL = 'https://private-memory.example.test';
      resetMemoryProviderRegistry();

      await program.parseAsync(['node', 'test', 'hermes', 'status', 'safe', '--json']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        ok: boolean;
        requestedProfile: string;
        dispatchProfile: string;
        schemaVersion: number;
        summary: {
          featureParity: {
            activeTodoCount: number;
            deferredCount: number;
          };
          toolParity: {
            gaps: number;
            total: number;
          };
        };
        readiness: {
          browser: {
            autoEligibleBackendIds: string[];
            gatedBackendCount: number;
            gatedBackendIds: string[];
            primaryBackendId: string | null;
            smokeCommand: string | null;
          };
          protocols: {
            availableCapabilityIds: string[];
            missingCapabilityIds: string[];
            partialCapabilityIds: string[];
            smokeCommand: string;
          };
          trajectories: {
            availableCapabilityIds: string[];
            goldenFixtureCount: number;
            missingCapabilityIds: string[];
            partialCapabilityIds: string[];
            policyEvalCount: number;
            runProbeCommand: string;
            statusCommand: string;
          };
          messaging: {
            configuredPlatformNames: string[];
            nextConfigPlatformNames: string[];
            promptToolPlatformNames: string[];
            runtimePlatformNames: string[];
            statusCommand: string;
          };
          mobile: {
            blockedOperations: number;
            draftOnlyEndpoints: number;
            gatewayCheckCommand: string;
            pendingLocalApproval: number;
            readOnlyEndpoints: number;
            remoteExecutionDisabled: boolean;
            routeBasePath: string;
            routeStatus: string;
            statusCommand: string;
          };
          provider: {
            configured: boolean;
            configuredProviderIds: string[];
            credentialSources: string[];
            localProviderIds: string[];
            missingProviderIds: string[];
            model: string;
            portalLoggedIn: boolean;
            portalToolGatewayConfigured: boolean;
            portalToolGatewayConfiguredToolKeys: string[];
            portalToolGatewayManagedToolKeys: string[];
            portalToolGatewayMissingToolKeys: string[];
          };
          runtime: {
            autoEligibleBackendIds: string[];
            gatedBackendCount: number;
            gatedBackendIds: string[];
            primaryBackendId: string | null;
            smokeCommand: string | null;
          };
          skills: {
            candidateListCommand: string;
            eligibleCandidateCount: number;
            ineligibleCandidateCount: number;
            nextCommand: string;
            nextInspectCommand: string | null;
            totalCandidateCount: number;
          };
        };
        nextActions: Array<{ area: string; verificationCommand: string }>;
        commands: {
          browser: string;
          doctor: string;
          messaging: string;
          mobile: string;
          runtime: string;
          smoke: string;
          todo: string;
          trajectories: string;
        };
      };

      expect(output.kind).toBe('hermes_overview_status');
      expect(output.schemaVersion).toBe(1);
      expect(output.requestedProfile).toBe('safe');
      expect(output.dispatchProfile).toBe('safe');
      expect(output.summary.featureParity.activeTodoCount).toBeGreaterThan(0);
      expect(output.summary.featureParity.deferredCount).toBe(1);
      expect(output.summary.toolParity.total).toBeGreaterThan(0);
      expect(output.summary.toolParity.gaps).toBe(0);
      expect(output.readiness.provider).toMatchObject({
        configured: true,
        model: 'gpt-5.5',
        credentialSources: expect.arrayContaining(['OPENAI_API_KEY']),
      });
      expect(output.readiness.provider.configuredProviderIds).toContain('openai');
      expect(output.readiness.provider.localProviderIds).toEqual(expect.arrayContaining(['ollama', 'lmstudio']));
      expect(output.readiness.provider.missingProviderIds).toEqual(expect.arrayContaining(['anthropic', 'google']));
      expect(output.readiness.provider.portalLoggedIn).toBe(true);
      expect(output.readiness.provider.portalToolGatewayConfigured).toBe(false);
      expect(output.readiness.provider.portalToolGatewayConfiguredToolKeys).toEqual(
        expect.arrayContaining(['web', 'image_gen', 'tts', 'browser']),
      );
      expect(output.readiness.provider.portalToolGatewayManagedToolKeys).toEqual([]);
      expect(output.readiness.provider.portalToolGatewayMissingToolKeys).toEqual(['modal']);
      expect(output.readiness.runtime.smokeCommand).toBe('buddy hermes runtime-smoke auto --json');
      expect(output.readiness.runtime.autoEligibleBackendIds).toContain('local');
      expect(output.readiness.runtime.gatedBackendCount).toBe(output.readiness.runtime.gatedBackendIds.length);
      expect(output.readiness.browser.smokeCommand).toBe('buddy hermes browser-smoke auto --json');
      expect(output.readiness.browser.autoEligibleBackendIds).toContain('local-playwright');
      expect(output.readiness.browser.gatedBackendCount).toBe(output.readiness.browser.gatedBackendIds.length);
      expect(output.readiness.protocols.smokeCommand).toBe('buddy hermes protocols-smoke local --json');
      expect(output.readiness.protocols.availableCapabilityIds).toEqual(expect.arrayContaining(['mcp-client', 'a2a-http']));
      expect(output.readiness.protocols.partialCapabilityIds).toEqual(['acp-editor-integration']);
      expect(output.readiness.protocols.missingCapabilityIds).toEqual([]);
      expect(output.readiness.trajectories.statusCommand).toBe('buddy hermes trajectories status --json');
      expect(output.readiness.trajectories.runProbeCommand).toBe(
        'buddy hermes trajectories status --run-id <run-id> --json',
      );
      expect(output.readiness.trajectories.availableCapabilityIds).toEqual(
        expect.arrayContaining(['trajectory-export', 'recall-pack', 'batch-trajectory-generation']),
      );
      expect(output.readiness.trajectories.partialCapabilityIds).toEqual([]);
      expect(output.readiness.trajectories.missingCapabilityIds).toEqual([]);
      expect(output.readiness.trajectories.goldenFixtureCount).toBeGreaterThan(0);
      expect(output.readiness.trajectories.policyEvalCount).toBeGreaterThan(0);
      expect(output.readiness.messaging.statusCommand).toBe('buddy hermes messaging status --json');
      expect(output.readiness.messaging.configuredPlatformNames).toEqual([]);
      expect(output.readiness.messaging.runtimePlatformNames).toEqual([]);
      expect(output.readiness.messaging.promptToolPlatformNames).toEqual(expect.arrayContaining(['Email', 'Yuanbao']));
      expect(output.readiness.messaging.nextConfigPlatformNames).toEqual(expect.arrayContaining(['Telegram', 'Discord', 'Slack']));
      expect(output.readiness.mobile).toMatchObject({
        blockedOperations: 6,
        draftOnlyEndpoints: 1,
        pendingLocalApproval: 1,
        readOnlyEndpoints: 3,
        remoteExecutionDisabled: true,
        routeBasePath: '/api/mobile',
        routeStatus: 'implemented_not_probed',
        statusCommand: 'buddy hermes mobile status --json',
      });
      expect(output.readiness.mobile.gatewayCheckCommand).toContain('buddy run mobile-gateway-check');
      expect(output.readiness.skills.totalCandidateCount).toBe(
        output.readiness.skills.eligibleCandidateCount + output.readiness.skills.ineligibleCandidateCount,
      );
      expect(output.readiness.skills.candidateListCommand).toContain('buddy tools skill-candidate list');
      expect(output.readiness.skills.nextCommand.length).toBeGreaterThan(0);
      expect(output.nextActions[0]?.area).toBe('Closed learning loop');
      expect(output.nextActions.every((item) => item.verificationCommand.length > 0)).toBe(true);
      expect(output.commands).toMatchObject({
        browser: 'buddy hermes browser status --json',
        doctor: 'buddy hermes doctor safe --json',
        messaging: 'buddy hermes messaging status --json',
        mobile: 'buddy hermes mobile status --json',
        portal: 'buddy hermes portal status --json',
        runtime: 'buddy hermes runtime status --json',
        smoke: 'buddy hermes smoke --json',
        todo: 'buddy hermes todo --json',
        trajectories: 'buddy hermes trajectories status --json',
      });
      expect(raw).not.toContain('secret-overview-openai-key');
      expect(raw).not.toContain('secret-overview-nous-token');
      expect(raw).not.toContain('secret-overview-mem0-key');
      expect(raw).not.toContain('private-memory.example.test');
      expect(raw).not.toContain(os.homedir());

      consoleLogSpy.mockClear();
      const textProgram = createProgram();
      registerHermesCommands(textProgram);
      await textProgram.parseAsync(['node', 'test', 'hermes', 'status', 'safe']);
      const textOutput = getLogOutput();
      expect(textOutput).toContain('Hermes status:');
      expect(textOutput).toContain('Feature parity:');
      expect(textOutput).toContain('Tool parity:');
      expect(textOutput).toContain('Showing top 5/');
      expect(textOutput).toContain('run buddy hermes todo --limit');
      expect(textOutput).toContain('Readiness:');
      expect(textOutput).toContain('Providers: configured');
      expect(textOutput).toContain('Tool Gateway: configured');
      expect(textOutput).toContain('via Nous: none');
      expect(textOutput).toContain('missing: modal');
      expect(textOutput).toContain('missing:');
      expect(textOutput).toContain('(auto:');
      expect(textOutput).toContain('gated:');
      expect(textOutput).toContain('Messaging gateway: ok');
      expect(textOutput).toContain('Messaging: configured none');
      expect(textOutput).toContain('prompt-tools: Email, Home Assistant, Yuanbao');
      expect(textOutput).toContain('next: Telegram, Discord, Slack');
      expect(textOutput).toContain('Mobile supervision: ok');
      expect(textOutput).toContain('Mobile: /api/mobile implemented_not_probed');
      expect(textOutput).toContain('remoteExecDisabled=yes');
      expect(textOutput).toContain('Protocols: available');
      expect(textOutput).toContain('partial: acp-editor-integration');
      expect(textOutput).toContain('missing: none');
      expect(textOutput).toContain('Trajectory recall: ok');
      expect(textOutput).toContain('Trajectories: available');
      expect(textOutput).toContain('trajectory-export');
      expect(textOutput).toContain('golden=');
      expect(textOutput).toContain('policy=');
      expect(textOutput).toContain('Skills:');
      expect(textOutput).toContain('candidates');
      expect(textOutput).toContain('Aggregate local smoke: buddy hermes smoke --json');
      expect(textOutput).toContain('Portal: buddy hermes portal status --json');
      expect(textOutput).toContain('Messaging: buddy hermes messaging status --json');
      expect(textOutput).toContain('Mobile: buddy hermes mobile status --json');
      expect(textOutput).toContain('Trajectories: buddy hermes trajectories status --json');
      expect(textOutput).toContain('Real runtime smoke: buddy hermes runtime-smoke auto --json');
      expect(textOutput).toContain('Real browser smoke: buddy hermes browser-smoke auto --json');
      expect(textOutput).not.toContain('secret-overview-openai-key');
      expect(textOutput).not.toContain('secret-overview-nous-token');
      expect(textOutput).not.toContain('secret-overview-mem0-key');
      expect(textOutput).not.toContain('private-memory.example.test');
      expect(textOutput).not.toContain(os.homedir());
    } finally {
      for (const key of keys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetMemoryProviderRegistry();
    }
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
          configuredRemoteProviderIds: string[];
          fallbackProviderIds: string[];
          missingOfficialProviderIds: string[];
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
      expect(output.readiness.configuredRemoteProviderIds).toContain('mem0');
      expect(output.readiness.fallbackProviderIds).toEqual(expect.arrayContaining(['honcho', 'supermemory']));
      expect(output.readiness.missingOfficialProviderIds).toContain('byterover');
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

      consoleLogSpy.mockClear();
      const textProgram = createProgram();
      registerHermesCommands(textProgram);
      await textProgram.parseAsync(['node', 'test', 'hermes', 'memory', 'status']);
      const textOutput = getLogOutput();
      expect(textOutput).toContain('Configured remote: 1 (mem0)');
      expect(textOutput).toContain('Local-fallback adapters: 2 (honcho, supermemory)');
      expect(textOutput).toContain('Remediation: Set HONCHO_API_KEY before relying on the Honcho remote adapter.');
      expect(textOutput).toContain('Remediation: Add a ByteRover adapter before claiming full Hermes memory-provider parity.');
      expect(textOutput).not.toContain('secret-mem0-token');
      expect(textOutput).not.toContain('memory.example.test');
    } finally {
      for (const key of keys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetMemoryProviderRegistry();
    }
  });

  it('prints Hermes learning loop status from real local state without private observation content', async () => {
    const oldCwd = process.cwd();
    const oldRunsDir = process.env.CODEBUDDY_RUNS_DIR;
    const oldLearningAgent = process.env.CODEBUDDY_LEARNING_AGENT;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-learning-status-'));
    const runsDir = path.join(tmpDir, 'runs');
    let store: RunStore | null = null;

    try {
      process.chdir(tmpDir);
      process.env.CODEBUDDY_RUNS_DIR = runsDir;
      process.env.CODEBUDDY_LEARNING_AGENT = 'false';
      resetLessonCandidateQueues();
      resetUserModels();

      store = new RunStore(runsDir);
      const runId = store.startRun('Hermes learning status proof', {
        channel: 'cli',
        tags: ['hermes', 'learning-status'],
      });
      store.emit(runId, {
        type: 'skill_selected',
        data: {
          confidence: 0.9,
          reason: 'real status proof',
          skillName: 'web-audit',
        },
      });
      for (const [toolCallId, toolName] of [
        ['call_search', 'search'],
        ['call_read', 'view_file'],
        ['call_test', 'bash'],
      ] as const) {
        store.emit(runId, {
          type: 'tool_call',
          data: { toolCallId, toolName, args: { query: 'learning status' } },
        });
        store.emit(runId, {
          type: 'tool_result',
          data: { durationMs: 20, output: `${toolName} ok`, success: true, toolName },
        });
      }
      store.saveArtifact(runId, 'summary.md', 'Real learning status proof passed.');
      store.endRun(runId, 'completed');
      await new Promise((resolve) => setTimeout(resolve, 120));
      await runLearningRetrospective(store, runId, {
        force: true,
        workDir: tmpDir,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const pendingRetrospectiveRunId = store.startRun('Hermes learning candidate proof', {
        channel: 'cowork',
        tags: ['hermes', 'needs-retrospective'],
      });
      store.emit(pendingRetrospectiveRunId, {
        type: 'tool_call',
        data: { toolCallId: 'call_real_cowork', toolName: 'bash', args: { command: 'npm test -- --run' } },
      });
      store.emit(pendingRetrospectiveRunId, {
        type: 'tool_result',
        data: { durationMs: 42, output: 'real cowork smoke ok', success: true, toolName: 'bash' },
      });
      store.saveArtifact(pendingRetrospectiveRunId, 'summary.md', 'Real candidate run needs a Learning Agent retrospective.');
      store.endRun(pendingRetrospectiveRunId, 'completed');

      await new Promise((resolve) => setTimeout(resolve, 10));
      const lowSignalRunId = store.startRun('Hermes low-signal memory update', {
        channel: 'terminal',
        tags: ['hermes', 'low-signal'],
      });
      for (let index = 0; index < 20; index++) {
        store.emit(lowSignalRunId, {
          type: 'decision',
          data: { note: `memory-only event ${index}` },
        });
      }
      store.endRun(lowSignalRunId, 'completed');

      const privatePreference = 'Prefers real tests before marking work done.';
      const userModel = getUserModel(tmpDir);
      const observation = userModel.observe({
        content: privatePreference,
        kind: 'working-style',
      });
      userModel.accept(observation.observation.id, { reviewedBy: 'Patrice' });

      const program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync(['node', 'test', 'hermes', 'learning', 'status', '--json', '--limit', '5']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        recommendations: string[];
        schemaVersion: number;
        runsDir: string;
        workDir: string;
        summary: {
          acceptedUserObservationCount: number;
          pendingLessonCandidateCount: number;
          pendingReviewCount: number;
          recentRunCount: number;
          retrospectiveCoveragePercent: number;
          retrospectiveEligibleRunCount: number;
          retrospectiveArtifactCount: number;
          skillUsageCount: number;
        };
        autoRetrospective: { enabled: boolean; mode: string };
        nextAction: {
          command: string;
          description: string;
          kind: string;
          requiresHumanReview: boolean;
        };
        nextRetrospectiveRun?: {
          command: string;
          evidenceArtifactCount: number;
          eventCount: number;
          runId: string;
          status: string;
          toolCallCount: number;
        };
        reviewGates: Record<string, boolean>;
        reviewQueue: {
          items: Array<{
            command: string;
            kind: string;
            nextReviewCommand?: string;
            pendingCount: number;
            sampleIds?: string[];
          }>;
          totalPending: number;
        };
        state: {
          recentRuns: Array<{
            evidenceArtifactCount: number;
            eventCount: number;
            hasLearningRetrospective: boolean;
            runId: string;
            toolCallCount: number;
          }>;
          skillCandidates: {
            learningCandidateCount: number;
            root: string;
            samples: Array<{
              candidateId: string;
              eligible: boolean;
              inspectCommand: string;
              promotion: {
                reason: string;
                status: string;
                successfulRunCount: number;
                threshold: number;
              };
              skillName: string;
            }>;
          };
          skillUsage: { top: Array<{ recommendation: string; skillName: string }> };
        };
        commands: { retrospective: string };
      };

      expect(output.kind).toBe('hermes_learning_loop_status');
      expect(output.schemaVersion).toBe(1);
      expect(output.workDir).toBe('[workspace]');
      expect(output.runsDir).toBe('[codebuddy-runs]');
      expect(output.summary.recentRunCount).toBe(3);
      expect(output.summary.retrospectiveEligibleRunCount).toBe(2);
      expect(output.summary.retrospectiveArtifactCount).toBe(1);
      expect(output.summary.retrospectiveCoveragePercent).toBe(50);
      expect(output.summary.pendingLessonCandidateCount).toBeGreaterThan(0);
      expect(output.summary.pendingReviewCount).toBeGreaterThan(0);
      expect(output.summary.acceptedUserObservationCount).toBe(1);
      expect(output.summary.skillUsageCount).toBe(1);
      expect(output.autoRetrospective).toMatchObject({ enabled: false, mode: 'disabled' });
      expect(Object.values(output.reviewGates).every(Boolean)).toBe(true);
      expect(output.reviewQueue.totalPending).toBe(output.summary.pendingReviewCount);
      expect(output.nextAction).toMatchObject({
        command: expect.stringContaining('buddy lessons candidate show lc-'),
        kind: 'review_queue',
        requiresHumanReview: true,
      });
      expect(output.nextAction.description).toContain('lessonWritesRequireApproval');
      expect(output.reviewQueue.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          command: 'buddy lessons candidate list --status pending --json',
          kind: 'lesson_candidate',
          nextReviewCommand: expect.stringContaining('buddy lessons candidate show lc-'),
          pendingCount: expect.any(Number),
          sampleIds: expect.arrayContaining([expect.stringMatching(/^lc-/)]),
        }),
        expect.objectContaining({
          command: 'buddy tools skill-candidate list --json',
          kind: 'skill_candidate',
          nextReviewCommand: expect.stringContaining('buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/'),
          pendingCount: 1,
          sampleIds: expect.arrayContaining([expect.stringMatching(/^(learning-skill|skill-candidate)-/)]),
        }),
      ]));
      expect(output.state.recentRuns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            evidenceArtifactCount: expect.any(Number),
            eventCount: expect.any(Number),
            hasLearningRetrospective: true,
            runId,
            toolCallCount: expect.any(Number),
          }),
          expect.objectContaining({
            evidenceArtifactCount: expect.any(Number),
            eventCount: expect.any(Number),
            hasLearningRetrospective: false,
            runId: pendingRetrospectiveRunId,
            toolCallCount: expect.any(Number),
          }),
          expect.objectContaining({
            evidenceArtifactCount: 0,
            eventCount: expect.any(Number),
            hasLearningRetrospective: false,
            runId: lowSignalRunId,
            toolCallCount: 0,
          }),
        ]),
      );
      expect(output.nextRetrospectiveRun).toMatchObject({
        command: `buddy run retrospective ${pendingRetrospectiveRunId} --force --json`,
        evidenceArtifactCount: 1,
        eventCount: expect.any(Number),
        runId: pendingRetrospectiveRunId,
        status: 'completed',
        toolCallCount: 1,
      });
      expect(output.nextRetrospectiveRun?.eventCount).toBeGreaterThan(0);
      expect(output.nextRetrospectiveRun?.runId).not.toBe(lowSignalRunId);
      expect(output.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining(`buddy run retrospective ${pendingRetrospectiveRunId}`)]),
      );
      expect(output.state.skillCandidates.learningCandidateCount).toBe(1);
      expect(output.state.skillCandidates.root).toBe('.codebuddy/skill-candidates/learning');
      expect(output.state.skillCandidates.samples).toEqual([
        expect.objectContaining({
          candidateId: expect.stringMatching(/^(learning-skill|skill-candidate)-/),
          eligible: false,
          inspectCommand: expect.stringContaining('buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/'),
          promotion: expect.objectContaining({
            reason: expect.stringContaining('1/2 successful observations'),
            status: 'not_eligible',
            successfulRunCount: 1,
            threshold: 2,
          }),
          skillName: expect.any(String),
        }),
      ]);
      expect(output.state.skillUsage.top).toEqual([
        expect.objectContaining({ recommendation: 'observe', skillName: 'web-audit' }),
      ]);
      expect(output.commands.retrospective).toBe('buddy run retrospective <run-id> --force --json');
      expect(raw).not.toContain(privatePreference);
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmpDir);
      expect(serialized).not.toContain(tmpDir.replace(/\\/g, '\\\\'));
      expect(serialized).not.toContain(runsDir);
      expect(serialized).not.toContain(runsDir.replace(/\\/g, '\\\\'));
    } finally {
      store?.dispose();
      process.chdir(oldCwd);
      if (oldRunsDir === undefined) delete process.env.CODEBUDDY_RUNS_DIR;
      else process.env.CODEBUDDY_RUNS_DIR = oldRunsDir;
      if (oldLearningAgent === undefined) delete process.env.CODEBUDDY_LEARNING_AGENT;
      else process.env.CODEBUDDY_LEARNING_AGENT = oldLearningAgent;
      resetLessonCandidateQueues();
      resetUserModels();
      await fs.remove(tmpDir);
    }
  });

  it('points Learning Agent review at all candidates when none are install-eligible yet', async () => {
    const oldCwd = process.cwd();
    const oldRunsDir = process.env.CODEBUDDY_RUNS_DIR;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-learning-ineligible-skill-'));
    const candidateDir = path.join(tmpDir, '.codebuddy', 'skill-candidates', 'learning', 'learned-not-ready');

    try {
      process.chdir(tmpDir);
      process.env.CODEBUDDY_RUNS_DIR = path.join(tmpDir, 'runs');
      resetLessonCandidateQueues();
      resetUserModels();
      fs.ensureDirSync(candidateDir);
      fs.writeFileSync(path.join(candidateDir, 'SKILL.md'), [
        '---',
        'name: learned-not-ready',
        'description: Candidate waiting for more evidence.',
        '---',
        '',
        '# Learned Not Ready',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(candidateDir, 'candidate-review.json'), JSON.stringify({
        approvalRequired: true,
        candidateId: 'learning-skill-notready',
        eligible: false,
        generatedAt: '2026-06-01T01:40:00.000Z',
        kind: 'learning',
        schemaVersion: 1,
        skillName: 'learned-not-ready',
        sourceJobId: 'learning-agent',
        sourceRunId: 'run-not-ready',
        status: 'not_eligible',
        successfulRunCount: 1,
      }, null, 2));

      const program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync(['node', 'test', 'hermes', 'learning', 'status', '--json']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        reviewQueue: {
          items: Array<{
            command: string;
            kind: string;
            nextReviewCommand?: string;
            sampleIds?: string[];
          }>;
        };
      };
      const skillItem = output.reviewQueue.items.find((item) => item.kind === 'skill_candidate');
      expect(skillItem).toEqual(expect.objectContaining({
        command: 'buddy tools skill-candidate list --json',
        nextReviewCommand: 'buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/learned-not-ready --json',
        sampleIds: ['learning-skill-notready'],
      }));
      expect(raw).not.toContain('Candidate waiting for more evidence.');
    } finally {
      process.chdir(oldCwd);
      if (oldRunsDir === undefined) delete process.env.CODEBUDDY_RUNS_DIR;
      else process.env.CODEBUDDY_RUNS_DIR = oldRunsDir;
      resetLessonCandidateQueues();
      resetUserModels();
      await fs.remove(tmpDir);
    }
  });

  it('prioritizes eligible Learning Agent skill candidates even when ineligible candidates sort first on disk', async () => {
    const oldCwd = process.cwd();
    const oldRunsDir = process.env.CODEBUDDY_RUNS_DIR;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-learning-mixed-skills-'));
    const rootDir = path.join(tmpDir, '.codebuddy', 'skill-candidates', 'learning');

    function writeLearningCandidate(directoryName: string, skillName: string, status: string): void {
      const candidateDir = path.join(rootDir, directoryName);
      fs.ensureDirSync(candidateDir);
      fs.writeFileSync(path.join(candidateDir, 'SKILL.md'), createSkillContent(skillName));
      fs.writeFileSync(path.join(candidateDir, 'candidate-review.json'), JSON.stringify({
        approvalRequired: true,
        candidateId: `learning-skill-${directoryName}`,
        generatedAt: '2026-06-01T02:30:00.000Z',
        kind: 'learning',
        schemaVersion: 1,
        skillName,
        sourceJobId: 'learning-agent',
        sourceRunId: 'run-mixed-candidates',
        eligible: status === 'awaiting_human_approval',
        status,
        successfulRunCount: status === 'awaiting_human_approval' ? 2 : 0,
      }, null, 2));
    }

    try {
      process.chdir(tmpDir);
      process.env.CODEBUDDY_RUNS_DIR = path.join(tmpDir, 'runs');
      resetLessonCandidateQueues();
      resetUserModels();
      writeLearningCandidate('aaa-not-ready', 'learned-not-ready', 'not_eligible');
      writeLearningCandidate('bbb-also-not-ready', 'learned-also-not-ready', 'not_eligible');
      writeLearningCandidate('zzz-ready', 'learned-ready', 'awaiting_human_approval');

      const program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync(['node', 'test', 'hermes', 'learning', 'status', '--json']);

      const output = JSON.parse(getLogOutput()) as {
        reviewQueue: {
          items: Array<{
            command: string;
            kind: string;
            nextReviewCommand?: string;
          }>;
        };
        state: {
          skillCandidates: {
            eligibleCandidateCount: number;
            ineligibleCandidateCount: number;
            learningCandidateCount: number;
            samples: Array<{ eligible: boolean; skillName: string }>;
          };
        };
      };
      const skillItem = output.reviewQueue.items.find((item) => item.kind === 'skill_candidate');
      expect(output.state.skillCandidates).toMatchObject({
        eligibleCandidateCount: 1,
        ineligibleCandidateCount: 2,
        learningCandidateCount: 3,
      });
      expect(output.state.skillCandidates.samples[0]).toMatchObject({
        eligible: true,
        skillName: 'learned-ready',
      });
      expect(skillItem).toEqual(expect.objectContaining({
        command: 'buddy tools skill-candidate list --eligible-only --json',
        nextReviewCommand: 'buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/zzz-ready --json',
      }));
    } finally {
      process.chdir(oldCwd);
      if (oldRunsDir === undefined) delete process.env.CODEBUDDY_RUNS_DIR;
      else process.env.CODEBUDDY_RUNS_DIR = oldRunsDir;
      resetLessonCandidateQueues();
      resetUserModels();
      await fs.remove(tmpDir);
    }
  });

  it('prints Learning Agent skill candidate eligibility split in human-readable status', async () => {
    const oldCwd = process.cwd();
    const oldRunsDir = process.env.CODEBUDDY_RUNS_DIR;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-learning-text-skills-'));
    const rootDir = path.join(tmpDir, '.codebuddy', 'skill-candidates', 'learning');

    function writeLearningCandidate(directoryName: string, skillName: string, status: string): void {
      const candidateDir = path.join(rootDir, directoryName);
      fs.ensureDirSync(candidateDir);
      fs.writeFileSync(path.join(candidateDir, 'SKILL.md'), createSkillContent(skillName));
      fs.writeFileSync(path.join(candidateDir, 'candidate-review.json'), JSON.stringify({
        approvalRequired: true,
        candidateId: `learning-skill-${directoryName}`,
        generatedAt: '2026-06-01T02:45:00.000Z',
        kind: 'learning',
        schemaVersion: 1,
        skillName,
        sourceJobId: 'learning-agent',
        sourceRunId: 'run-text-candidates',
        eligible: status === 'awaiting_human_approval',
        status,
        successfulRunCount: status === 'awaiting_human_approval' ? 2 : 0,
      }, null, 2));
    }

    try {
      process.chdir(tmpDir);
      process.env.CODEBUDDY_RUNS_DIR = path.join(tmpDir, 'runs');
      resetLessonCandidateQueues();
      resetUserModels();
      writeLearningCandidate('not-ready', 'learned-not-ready', 'not_eligible');
      writeLearningCandidate('ready', 'learned-ready', 'awaiting_human_approval');

      const program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync(['node', 'test', 'hermes', 'learning', 'status']);

      const output = getLogOutput();
      expect(output).toContain('Learning skill candidates: 2 (1 eligible, 1 not eligible)');
      expect(output).toContain('skill_candidate: 2 -> buddy tools skill-candidate list --eligible-only --json');
      expect(output).toContain('gate: skillCandidatesRequireReview');
      expect(output).toContain('why: Pending Learning Agent SKILL.md candidates; inspect diffs before install or overwrite.');
      expect(output).toContain('samples: learning-skill-ready');
      expect(output).toContain(
        'next: buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/ready --json',
      );
      expect(output).toContain('Candidate review: buddy tools skill-candidate list --eligible-only --json');
    } finally {
      process.chdir(oldCwd);
      if (oldRunsDir === undefined) delete process.env.CODEBUDDY_RUNS_DIR;
      else process.env.CODEBUDDY_RUNS_DIR = oldRunsDir;
      resetLessonCandidateQueues();
      resetUserModels();
      await fs.remove(tmpDir);
    }
  });

  it('prints Hermes skills status from the real workspace SkillsHub lockfile', async () => {
    const oldCwd = process.cwd();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-skills-status-'));
    const hub = new SkillsHub({
      cacheDir: path.join(tmpDir, '.codebuddy', 'skills-cache'),
      lockfilePath: path.join(tmpDir, '.codebuddy', 'skills-lock.json'),
      skillsDir: path.join(tmpDir, '.codebuddy', 'skills'),
      tapsPath: path.join(tmpDir, '.codebuddy', 'skills-taps.json'),
    });

    try {
      process.chdir(tmpDir);
      await hub.installFromContent('healthy-helper', createSkillContent('healthy-helper'));
      const missing = await hub.installFromContent('missing-helper', createSkillContent('missing-helper'));
      await fs.remove(missing.path);
      const candidateDir = path.join(tmpDir, '.codebuddy', 'skill-candidates', 'learning', 'review-ready');
      fs.ensureDirSync(candidateDir);
      fs.writeFileSync(path.join(candidateDir, 'SKILL.md'), createSkillContent('review-ready', 'Ready candidate body must stay private.'));
      fs.writeFileSync(path.join(candidateDir, 'candidate-review.json'), JSON.stringify({
        approvalRequired: true,
        candidateId: 'learning-skill-review-ready',
        eligible: true,
        generatedAt: '2026-06-01T04:30:00.000Z',
        schemaVersion: 1,
        skillName: 'review-ready',
        sourceJobId: 'learning-agent',
        sourceRunId: 'run-skills-status',
        status: 'awaiting_human_approval',
        successfulRunCount: 2,
      }, null, 2));

      const program = createProgram();
      registerHermesCommands(program);
      await program.parseAsync(['node', 'test', 'hermes', 'skills', 'status', '--json', '--limit', '2']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        schemaVersion: number;
        summary: {
          cacheDir: string;
          installedCount: number;
          lockfilePath: string;
          health: {
            missingFileCount: number;
            nextCommand: string;
            ok: boolean;
          };
          packages: Array<{
            contentPreview?: string;
            exists: boolean;
            integrityOk: boolean;
            name: string;
            path: string;
          }>;
          candidateReview: {
            eligibleCount: number;
            ineligibleCount: number;
            listCommand: string;
            nextInspectCommand: string;
            root: string;
            samples: Array<{
              candidateId: string;
              eligible: boolean;
              kind: string;
              promotion?: {
                reason: string;
                status: string;
                successfulRunCount: number;
                threshold: number;
              };
              skillName: string;
            }>;
            totalCount: number;
          };
          reviewCommands: string[];
          skillRoot: string;
        };
      };

      expect(output.kind).toBe('hermes_skills_status');
      expect(output.schemaVersion).toBe(1);
      expect(output.summary.cacheDir).toBe('.codebuddy/skills-cache');
      expect(output.summary.lockfilePath).toBe('.codebuddy/skills-lock.json');
      expect(output.summary.skillRoot).toBe('.codebuddy/skills');
      expect(output.summary.installedCount).toBe(2);
      expect(output.summary.health.ok).toBe(false);
      expect(output.summary.health.missingFileCount).toBe(1);
      expect(output.summary.health.nextCommand).toBe('buddy skills doctor --json');
      expect(output.summary.packages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            exists: true,
            integrityOk: true,
            name: 'healthy-helper',
          }),
          expect.objectContaining({
            exists: false,
            integrityOk: false,
            name: 'missing-helper',
          }),
        ]),
      );
      expect(output.summary.packages.every((skill) => skill.contentPreview === undefined)).toBe(true);
      expect(output.summary.packages.every((skill) => !path.isAbsolute(skill.path))).toBe(true);
      expect(output.summary.candidateReview).toMatchObject({
        eligibleCount: 1,
        ineligibleCount: 0,
        listCommand: 'buddy tools skill-candidate list --eligible-only --json',
        nextInspectCommand: 'buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/review-ready --json',
        root: '.codebuddy/skill-candidates',
        totalCount: 1,
      });
      expect(output.summary.candidateReview.samples).toEqual([
        expect.objectContaining({
          candidateId: 'learning-skill-review-ready',
          eligible: true,
          kind: 'learning',
          promotion: {
            reason: '2 successful observations meet the promotion threshold.',
            status: 'awaiting_human_approval',
            successfulRunCount: 2,
            threshold: 2,
          },
          skillName: 'review-ready',
        }),
      ]);
      expect(output.summary.reviewCommands).toContain('buddy skills list --all --json');
      expect(output.summary.reviewCommands).toContain('buddy skills doctor --json');
      expect(output.summary.reviewCommands).toContain('buddy skills enable <name> --approved-by <reviewer>');
      expect(output.summary.reviewCommands).toContain('buddy skills disable <name> --approved-by <reviewer>');
      expect(output.summary.reviewCommands).toContain('buddy skills deprecate <name> --approved-by <reviewer>');
      expect(output.summary.reviewCommands).toContain('buddy skills delete <name> --approved-by <reviewer> --json');
      expect(output.summary.reviewCommands).toContain('buddy skills rollback <name> --approved-by <reviewer> --json');
      expect(output.summary.reviewCommands).toContain('buddy skills update <name> --approved-by <reviewer> --json');
      expect(output.summary.reviewCommands).toContain(
        'buddy skills patch <name> --approved-by <reviewer> --old-text <text> --new-text <text> --json',
      );
      expect(output.summary.reviewCommands).toContain('buddy skills reset <name> --approved-by <reviewer> --json');
      expect(raw).not.toContain('Body for healthy-helper');
      expect(raw).not.toContain('Body for missing-helper');
      expect(raw).not.toContain('Ready candidate body must stay private.');
      expect(JSON.stringify(output)).not.toContain(tmpDir);
      expect(JSON.stringify(output)).not.toContain(tmpDir.replace(/\\/g, '\\\\'));

      consoleLogSpy.mockClear();
      const textProgram = createProgram();
      registerHermesCommands(textProgram);
      await textProgram.parseAsync(['node', 'test', 'hermes', 'skills', 'status', '--limit', '2']);
      const textOutput = getLogOutput();
      expect(textOutput).toContain('Skill candidates: 1 (1 eligible, 0 not eligible)');
      expect(textOutput).toContain('Candidate review: buddy tools skill-candidate list --eligible-only --json');
      expect(textOutput).toContain('Candidate samples:');
      expect(textOutput).toContain('review-ready: awaiting_human_approval (2/2)');
      expect(textOutput).toContain('Reason: 2 successful observations meet the promotion threshold.');
      expect(textOutput).toContain('Next candidate: buddy tools skill-candidate inspect .codebuddy/skill-candidates/learning/review-ready --json');
      expect(textOutput).not.toContain('Ready candidate body must stay private.');
    } finally {
      hub.shutdown();
      process.chdir(oldCwd);
      await fs.remove(tmpDir);
    }
  });

  it('prints Hermes provider readiness as a dedicated status command without leaking secrets', async () => {
    const keys = ['CODEBUDDY_MODEL', 'OPENAI_API_KEY', 'CODEBUDDY_NOUS_ACCESS_TOKEN', 'OLLAMA_HOST'];
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
      process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';

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

      consoleLogSpy.mockClear();
      const textProgram = createProgram();
      registerHermesCommands(textProgram);
      await textProgram.parseAsync(['node', 'test', 'hermes', 'provider', 'status']);

      const textOutput = getLogOutput();
      expect(textOutput).toContain('OpenAI / Codex-compatible: configured | configured=yes, local=no');
      expect(textOutput).toContain('Ollama local: configured | configured=yes, local=yes');
      expect(textOutput).toContain('note: Local provider; readiness means the endpoint is configured, not that a model pull was tested.');
      expect(textOutput).toContain('Anthropic / Claude: missing | configured=no, local=no');
      expect(textOutput).not.toContain('secret-openai-provider-key');
      expect(textOutput).not.toContain('secret-nous-provider-token');
    } finally {
      for (const key of keys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('prints compact Hermes model setup status without leaking secrets', async () => {
    const keys = ['CODEBUDDY_MODEL', 'OPENAI_API_KEY', 'CODEBUDDY_NOUS_ACCESS_TOKEN', 'OLLAMA_HOST'];
    const originalEnv = new Map(keys.map((key) => [key, process.env[key]]));
    const program = createProgram();
    registerHermesCommands(program);

    try {
      for (const key of keys) {
        delete process.env[key];
      }
      process.env.CODEBUDDY_MODEL = 'gpt-5.5';
      process.env.OPENAI_API_KEY = 'secret-openai-model-key';
      process.env.CODEBUDDY_NOUS_ACCESS_TOKEN = 'secret-nous-model-token';
      process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';

      await program.parseAsync(['node', 'test', 'hermes', 'model', 'status', '--json']);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        schemaVersion: number;
        ok: boolean;
        active: {
          model: string;
          provider: string;
          providerLabel: string;
          configured: boolean;
          credentialSources: string[];
          capabilities: {
            toolCalls: boolean;
            reasoning: boolean;
            vision: boolean;
          };
        };
        setup: {
          accountCommand: string;
          providerMatrixCommand: string;
          doctorCommand: string;
          nextSteps: string[];
        };
        alternatives: Array<{
          label: string;
          configured: boolean;
        }>;
      };

      expect(output.kind).toBe('hermes_model_status');
      expect(output.schemaVersion).toBe(1);
      expect(output.ok).toBe(true);
      expect(output.active).toMatchObject({
        model: 'gpt-5.5',
        provider: 'openai',
        providerLabel: 'OpenAI / Codex-compatible',
        configured: true,
        credentialSources: expect.arrayContaining(['OPENAI_API_KEY']),
        capabilities: {
          toolCalls: true,
          reasoning: true,
          vision: true,
        },
      });
      expect(output.setup).toMatchObject({
        accountCommand: 'buddy whoami',
        providerMatrixCommand: 'buddy hermes providers status --json',
        doctorCommand: 'buddy hermes doctor safe --json',
      });
      expect(output.alternatives).toEqual(expect.arrayContaining([
        expect.objectContaining({
          label: 'Ollama local',
          configured: true,
        }),
      ]));
      expect(raw).not.toContain('secret-openai-model-key');
      expect(raw).not.toContain('secret-nous-model-token');

      consoleLogSpy.mockClear();
      const textProgram = createProgram();
      registerHermesCommands(textProgram);
      await textProgram.parseAsync(['node', 'test', 'hermes', 'model', 'status']);

      const textOutput = getLogOutput();
      expect(textOutput).toContain('Hermes model: ok');
      expect(textOutput).toContain('Active: gpt-5.5 via OpenAI / Codex-compatible');
      expect(textOutput).toContain('Credentials/endpoint: OPENAI_API_KEY');
      expect(textOutput).toContain('Full provider matrix: buddy hermes providers status --json');
      expect(textOutput).toContain('Account check: buddy whoami');
      expect(textOutput).not.toContain('secret-openai-model-key');
      expect(textOutput).not.toContain('secret-nous-model-token');
    } finally {
      for (const key of keys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('prints Hermes protocol gateway readiness as a dedicated status command', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'protocols', 'status', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      ok: boolean;
      smokeCommand: string;
      capabilities: Array<{
        endpoints: string[];
        id: string;
        status: string;
      }>;
      summary: {
        availableCount: number;
        missingCount: number;
        partialCount: number;
      };
    };

    expect(output.kind).toBe('hermes_protocol_gateway_readiness');
    expect(output.ok).toBe(true);
    expect(output.summary.availableCount).toBeGreaterThanOrEqual(5);
    expect(output.summary.partialCount).toBeGreaterThanOrEqual(1);
    expect(output.summary.missingCount).toBe(0);
    expect(output.smokeCommand).toBe('buddy hermes protocols-smoke local --json');
    expect(output.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mcp-client',
          status: 'available',
        }),
        expect.objectContaining({
          id: 'a2a-http',
          endpoints: expect.arrayContaining(['GET /api/a2a/.well-known/agent.json']),
          status: 'available',
        }),
        expect.objectContaining({
          id: 'acp-editor-integration',
          status: 'partial',
        }),
      ]),
    );

    consoleLogSpy.mockClear();
    const textProgram = createProgram();
    registerHermesCommands(textProgram);
    await textProgram.parseAsync(['node', 'test', 'hermes', 'protocols', 'status']);
    const textOutput = getLogOutput();
    expect(textOutput).toContain('    - POST /api/a2a/tasks/:id/cancel');
    expect(textOutput).toContain('    - POST /api/acp/tasks/:id/resume');
    expect(textOutput).toContain('Evidence: 5 file/test reference(s)');
    expect(textOutput).toContain('Notes: The stdio ACP transport supports initialize, session/new, in-process session/list, session/load replay, session/prompt, session/cancel, and capability-gated agent-to-client JSON-RPC request/response correlation.');
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
        gatewayCheck: string;
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
    expect(output.commands.gatewayCheck).toBe(
      'buddy run mobile-gateway-check "mobile supervision gateway" --action view_run_summary --method GET --path /api/mobile/snapshot --json',
    );
    expect(output.commands.approvals).toContain('buddy run mobile-approval-queue');
    expect(output.recommendations).toContain(
      'Use buddy run mobile-gateway-check "mobile supervision gateway" --action view_run_summary --method GET --path /api/mobile/snapshot --json as a safe GET policy smoke before implementing any new route.',
    );
    expect(raw).not.toContain('previewCode');
  });

  it('prints actionable Hermes mobile status and gateway-check commands in text output', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'mobile', 'status', 'mobile', 'supervision']);

    const output = getLogOutput();
    expect(output).toContain('Commands:');
    expect(output).toContain('buddy hermes mobile status --json');
    expect(output).toContain(
      'buddy run mobile-gateway-check "mobile supervision" --action view_run_summary --method GET --path /api/mobile/snapshot --json',
    );
    expect(output).toContain('safe GET policy smoke');
  });

  it('prints Hermes trajectory compatibility against a real RunStore probe', async () => {
    resetDataRedactionEngine();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-trajectory-command-'));
    const store = new RunStore(tempDir);
    const secret = 'sk-abcdefghijklmnopqrstuvwx';
    const previousInstance = (RunStore as unknown as { _instance: RunStore | null })._instance;
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;

    try {
      const runId = store.startRun('Hermes trajectory command proof', {
        channel: 'cowork',
        tags: ['hermes', 'research'],
      });
      store.emit(runId, {
        type: 'tool_call',
        data: {
          toolCallId: 'call_command_probe',
          toolName: 'web_search',
          args: {
            apiKey: secret,
            query: 'Hermes trajectory command proof',
          },
        },
      });
      store.emit(runId, {
        type: 'tool_result',
        data: {
          output: `Command probe succeeded with ${secret}`,
          success: true,
          toolName: 'web_search',
        },
      });
      store.saveArtifact(runId, 'summary.md', `Hermes trajectory command proof ${secret}`);
      store.endRun(runId, 'completed');
      await new Promise((resolve) => setTimeout(resolve, 60));

      const program = createProgram();
      registerHermesCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'hermes',
        'trajectories',
        'status',
        '--json',
        '--run-id',
        runId,
        'trajectory',
        'command',
        'proof',
      ]);

      const raw = getLogOutput();
      const output = JSON.parse(raw) as {
        kind: string;
        ok: boolean;
        capabilities: Array<{ id: string; status: string }>;
        probe: {
          recallPack: { runCount: number };
          trajectoryBatch: { runCount: number; sourceRunIds: string[] };
          trajectoryExport: {
            found: boolean;
            redactionCount: number;
            runId: string;
            toolCallCount: number;
            toolResultCount: number;
          };
        };
      };

      expect(output.kind).toBe('hermes_trajectory_compatibility_report');
      expect(output.ok).toBe(true);
      expect(output.capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'trajectory-export', status: 'available' }),
          expect.objectContaining({ id: 'batch-trajectory-generation', status: 'available' }),
        ]),
      );
      expect(output.probe.trajectoryExport).toMatchObject({
        found: true,
        runId,
        toolCallCount: 1,
        toolResultCount: 1,
      });
      expect(output.probe.trajectoryExport.redactionCount).toBeGreaterThan(0);
      expect(output.probe.recallPack.runCount).toBe(1);
      expect(output.probe.trajectoryBatch).toMatchObject({
        runCount: 1,
        sourceRunIds: [runId],
      });
      expect(raw).not.toContain(secret);
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 60));
      store.dispose();
      (RunStore as unknown as { _instance: RunStore | null })._instance = previousInstance;
      resetDataRedactionEngine();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prints Hermes trajectory proof commands in text output', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'trajectories', 'status']);

    const output = getLogOutput();
    expect(output).toContain('Commands:');
    expect(output).toContain('buddy run trajectory-export <run-id> --json');
    expect(output).toContain('buddy hermes trajectories status --run-id <run-id> --json');
    expect(output).toContain('Evidence: 3 file/test reference(s)');
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
        backends: Array<{ command: string | null; id: string; smokeCommand: string | null }>;
        routePlan: {
          mode: string;
          primaryBackendId: string | null;
          smokeCommand: string | null;
        };
        runnableCount: number;
      };
    };

    expect(output.kind).toBe('hermes_runtime_backends_status');
    expect(output.schemaVersion).toBe(1);
    expect(output.readiness.backends.map((backend) => backend.id)).toContain('local');
    expect(output.readiness.runnableCount).toBeGreaterThanOrEqual(1);
    expect(output.readiness.availableCount).toBeGreaterThanOrEqual(1);
    expect(output.readiness.backends.find((backend) => backend.id === 'local')?.command).toBe(nodeDisplayCommand);
    expect(output.readiness.backends.find((backend) => backend.id === 'local')?.smokeCommand).toContain(
      'OK-HERMES-LOCAL',
    );
    expect(output.readiness.routePlan).toMatchObject({
      mode: 'hybrid',
      primaryBackendId: 'local',
      smokeCommand: 'buddy hermes runtime-smoke auto --json',
    });
    expect(JSON.stringify(output)).not.toContain(process.execPath);
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
          hermes: {
            configuredPlatformNames: string[];
            nextConfigPlatformNames: string[];
            officialPlatformCount: number;
            promptToolPlatformNames: string[];
            runtimePlatformNames: string[];
            platforms: Array<{ platform: string; status: string }>;
          };
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
      expect(output.status.hermes.officialPlatformCount).toBeGreaterThan(0);
      expect(output.status.hermes.configuredPlatformNames).toEqual(expect.arrayContaining(['Telegram', 'Discord']));
      expect(output.status.hermes.runtimePlatformNames).toEqual([]);
      expect(output.status.hermes.promptToolPlatformNames).toEqual(expect.arrayContaining(['Email', 'Yuanbao']));
      expect(output.status.hermes.nextConfigPlatformNames).toEqual(expect.arrayContaining(['Slack', 'DingTalk']));
      expect(output.status.hermes.platforms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ platform: 'Telegram', status: 'configured' }),
          expect.objectContaining({ platform: 'Discord', status: 'configured' }),
        ]),
      );
      expect(output.status.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining('not registered')]),
      );
      expect(raw).not.toContain('secret-telegram-token');
      expect(raw).not.toContain('example.invalid/webhook');
    } finally {
      await fs.remove(tmpDir);
    }
  });

  it('prints Hermes messaging platform configured/runtime flags in text status', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-messaging-text-status-'));
    const configPath = path.join(tmpDir, 'channels.json');
    await fs.writeJson(configPath, {
      channels: [
        {
          type: 'telegram',
          enabled: true,
          token: 'secret-telegram-token',
          allowedUsers: ['patrice'],
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
        '--config',
        configPath,
      ]);

      const output = getLogOutput();
      expect(output).toContain('Configured platforms: Telegram, Discord');
      expect(output).toContain('Runtime platforms: none');
      expect(output).toContain('Prompt-tool platforms: Email, Home Assistant, Yuanbao');
      expect(output).toContain('Next config targets: Slack, WhatsApp, Signal');
      expect(output).toContain('Telegram: configured/channel (telegram) | configured=yes, runtime=no');
      expect(output).toContain('Discord: configured/channel (discord) | configured=yes, runtime=no');
      expect(output).toContain('Slack: available/channel (slack) | configured=no, runtime=no');
      expect(output).not.toContain('secret-telegram-token');
      expect(output).not.toContain('example.invalid/webhook');
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
    // OpenClaw migration was the lone gap; `buddy hermes claw migrate` now closes it
    // (status partial), so feature-level gaps are zero.
    expect(output.summary.gaps).toBe(0);
    expect(output.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'agent-identity',
          status: 'covered-partial',
          codeBuddyEvidence: expect.arrayContaining([
            'src/agent/hermes-agent-profile.ts',
            'src/agent/hermes-agent-diagnostics.ts',
            'src/commands/cli/hermes-commands.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'npx tsx src/index.ts hermes profile review --json',
            'npx tsx src/index.ts hermes identity status safe --json',
          ]),
          notes: expect.stringContaining('native TypeScript/Fleet runtime mapping'),
          nextWork: expect.not.stringContaining('Keep native mapping explicit'),
        }),
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
          codeBuddyEvidence: expect.arrayContaining([
            'src/agent/hermes-browser-backends.ts',
            'cowork/src/main/tools/hermes-browser-backends-bridge.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'npx tsx src/index.ts hermes browser status --json',
            'npx tsx src/index.ts hermes browser-smoke local-playwright --json',
            'npm test -- tests/agent/hermes-browser-backends-smoke-real.test.ts --run',
            'cd cowork && npm test -- --run tests/hermes-browser-backends-bridge.test.ts tests/hermes-browser-backends-strip.test.ts',
          ]),
          notes: expect.stringContaining('machine-readable backend readiness'),
          nextWork: expect.not.stringContaining('Create backend-specific browser smoke tests and status output'),
        }),
        expect.objectContaining({
          id: 'providers-models',
          status: 'covered-partial',
          codeBuddyEvidence: expect.arrayContaining([
            'cowork/src/main/tools/hermes-provider-readiness-bridge.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'cd cowork && npm test -- --run tests/hermes-provider-readiness-bridge.test.ts tests/hermes-provider-readiness-bridge-real.test.ts tests/hermes-provider-readiness-strip.test.ts',
          ]),
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
            '(cd cowork && npm test -- tests/hermes-memory-providers-bridge.test.ts tests/hermes-memory-providers-bridge-real.test.ts tests/hermes-memory-providers-strip.test.ts --run)',
          ]),
          notes: expect.stringContaining('secret-safe provider readiness matrix'),
        }),
        expect.objectContaining({
          id: 'runtime-backends',
          status: 'partial',
          codeBuddyEvidence: expect.arrayContaining([
            'cowork/src/main/tools/hermes-runtime-backends-bridge.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'cd cowork && npm test -- --run tests/hermes-runtime-backends-bridge.test.ts tests/hermes-runtime-backends-bridge-real.test.ts tests/hermes-runtime-backends-strip.test.ts',
          ]),
        }),
        expect.objectContaining({
          id: 'mobile-supervision',
          status: 'partial',
          codeBuddyEvidence: expect.arrayContaining([
            'cowork/src/main/tools/hermes-mobile-supervision-bridge.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'cd cowork && npm test -- --run tests/hermes-mobile-supervision-bridge.test.ts tests/hermes-mobile-supervision-bridge-real.test.ts tests/hermes-mobile-supervision-strip.test.ts',
          ]),
        }),
        expect.objectContaining({
          id: 'research-trajectories',
          status: 'covered-partial',
          codeBuddyEvidence: expect.arrayContaining([
            'src/observability/hermes-trajectory-compatibility.ts',
            'src/observability/run-trajectory-export.ts',
            'src/observability/run-trajectory-batch.ts',
            'src/observability/run-recall-pack.ts',
            'src/agent/learning-agent.ts',
            'tests/observability/run-trajectory-batch.test.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'npm test -- tests/observability/run-trajectory-batch.test.ts tests/observability/hermes-trajectory-compatibility.test.ts tests/observability/golden-workflow-evals.test.ts tests/observability/policy-evals.test.ts --run',
            'npx tsx src/index.ts run trajectory-batch <query> --json',
            'npx tsx src/index.ts hermes trajectories status --json',
          ]),
          notes: expect.stringContaining('batch redacted trajectory collection'),
          nextWork: expect.not.stringContaining('Implement an upstream-style batch trajectory generator/compressor'),
        }),
        expect.objectContaining({
          id: 'mcp-acp',
          status: 'partial',
          codeBuddyEvidence: expect.arrayContaining([
            'src/agent/hermes-protocol-gateways.ts',
            'src/server/routes/a2a-protocol.ts',
            'src/server/routes/acp.ts',
            'src/server/channel-a2a-bridge.ts',
          ]),
          verificationCommands: expect.arrayContaining([
            'npm test -- tests/agent/hermes-protocol-gateways.test.ts tests/mcp/mcp-stdio-real-fixture.test.ts tests/server/a2a-protocol.test.ts tests/server/acp-routes.test.ts --run',
            'npx tsx src/index.ts hermes protocols-smoke local --json',
          ]),
          notes: expect.stringContaining('session.list / session.load'),
          nextWork: expect.stringContaining('full agentic (tool-using) ACP turns'),
        }),
      ]),
    );
  });

  it('prints a compact prioritized Hermes TODO derived from the parity manifest', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'todo', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      command: string;
      summary: {
        activeTodoCount: number;
        deferredCount: number;
        hiddenTodoCount: number;
        includedDeferred: boolean;
        selectedTodoCount: number;
        shownTodoCount: number;
        todoLimit: number;
      };
      todos: Array<{
        id: string;
        nextWork: string;
        priority: number;
        status: string;
        verificationCommand: string;
      }>;
      deferred: Array<{ id: string; status: string }>;
      notes: string[];
    };

    expect(output.kind).toBe('hermes_parity_todo');
    expect(output.schemaVersion).toBe(1);
    expect(output.command).toBe('buddy hermes todo --json');
    expect(output.summary.activeTodoCount).toBeGreaterThan(0);
    expect(output.summary.deferredCount).toBe(1);
    expect(output.summary.selectedTodoCount).toBe(output.summary.activeTodoCount);
    expect(output.summary.shownTodoCount).toBe(output.todos.length);
    expect(output.summary.hiddenTodoCount).toBe(
      output.summary.selectedTodoCount - output.summary.shownTodoCount,
    );
    expect(output.summary.todoLimit).toBe(7);
    expect(output.summary.includedDeferred).toBe(false);
    expect(output.todos[0]).toMatchObject({
      id: 'closed-learning-loop',
      priority: 1,
      status: 'partial',
    });
    expect(output.todos.map((item) => item.id)).not.toContain('agent-identity');
    expect(output.todos.map((item) => item.id)).toContain('runtime-backends');
    expect(output.todos.map((item) => item.id)).not.toContain('openclaw-migration');
    expect(output.deferred).toEqual([
      expect.objectContaining({ id: 'openclaw-migration', status: 'partial' }),
    ]);
    expect(output.todos.every((item) => item.nextWork.length > 0)).toBe(true);
    expect(output.todos.every((item) => item.verificationCommand.length > 0)).toBe(true);
    expect(output.notes.join(' ')).toContain('OpenClaw migration is deferred');
  });

  it('appends deliberately deferred Hermes work after active priorities when requested', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'todo', '--json', '--include-deferred', '--limit', '20']);

    const output = JSON.parse(getLogOutput()) as {
      summary: { activeTodoCount: number; includedDeferred: boolean };
      todos: Array<{ id: string; priority: number }>;
    };

    expect(output.summary.includedDeferred).toBe(true);
    expect(output.todos.at(-1)).toMatchObject({
      id: 'openclaw-migration',
      priority: output.todos.length,
    });
    expect(output.summary.activeTodoCount).toBe(output.todos.length - 1);
  });

  it('prints readable Hermes TODO output', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'todo', '--limit', '3']);

    const output = getLogOutput();
    expect(output).toContain('Hermes TODO:');
    expect(output).toMatch(/Showing: 3\/\d+ active item\(s\)/);
    expect(output).toMatch(/Hidden by --limit 3: \d+/);
    expect(output).toContain('Next active work:');
    expect(output).toContain('1. Closed learning loop [partial]');
    expect(output).toContain('Verify: npm test -- tests/agent/lesson-candidate-queue.test.ts');
    expect(output).toContain('Deferred by decision:');
    expect(output).toContain('OpenClaw migration [partial]');
  });

  it('labels Hermes TODO output as selected work when deferred items are included', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'todo', '--include-deferred', '--limit', '20']);

    const output = getLogOutput();
    expect(output).toMatch(/Showing: \d+\/\d+ active\/deferred item\(s\)/);
    expect(output).toContain('Next selected work:');
    expect(output).not.toContain('Next active work:');
    expect(output).toContain('OpenClaw migration [partial]');
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
      process.env.CODEBUDDY_NOUS_AUTH_FILE = path.join(tmpDir, 'nous-auth.json');
      await fs.outputJson(process.env.CODEBUDDY_NOUS_AUTH_FILE, { access_token: 'secret-nous-file-token' });
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
          authFilePath: string;
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
      expect(output.portal.credentialSources).toContain('nous-auth.json');
      expect(output.portal.authFilePath).toBe('nous-auth.json');
      expect(output.portal.authFilePresent).toBe(true);
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
      expect(raw).not.toContain('secret-nous-file-token');
      expect(raw).not.toContain('secret-firecrawl-key');
      expect(raw).not.toContain('secret-xai-key');
      expect(raw).not.toContain(tmpDir);

      consoleLogSpy.mockClear();
      const textProgram = createProgram();
      registerHermesCommands(textProgram);
      await textProgram.parseAsync(['node', 'test', 'hermes', 'portal', 'status']);

      const textOutput = getLogOutput();
      expect(textOutput).toContain('Tool Gateway: https://gateway.example.test');
      expect(textOutput).toContain('Web search & extract');
      expect(textOutput).toContain('via Nous Portal | configured=yes, viaNous=yes');
      expect(textOutput).toContain('Image generation');
      expect(textOutput).toContain('xAI image direct | configured=yes, viaNous=no');
      expect(textOutput).toContain('Cloud terminal');
      expect(textOutput).toContain('not configured | configured=no, viaNous=no');
      expect(textOutput).not.toContain('secret-nous-token');
      expect(textOutput).not.toContain('secret-nous-file-token');
      expect(textOutput).not.toContain('secret-firecrawl-key');
      expect(textOutput).not.toContain('secret-xai-key');
      expect(textOutput).not.toContain(tmpDir);
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
    expect(toolsOutput).toContain('configured=');
    expect(toolsOutput).toContain('viaNous=');

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
    expect(output).toContain('Active stages: 0/5');
    expect(output).toContain('Blocking stages: 3/5');
    expect(output).toContain('Before memory write (before_memory_write)');
    expect(output).toContain('Active: no');
    expect(output).toContain('Default behavior: allow');
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
              command: string | null;
              id: string;
              runnable: boolean;
              smokeCommand: string | null;
              status: string;
            }>;
            runnableCount: number;
          };
          browserBackends: {
            backends: Array<{
              command: string | null;
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
            command: nodeDisplayCommand,
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
            command: nodeDisplayCommand,
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
      expect(raw).not.toContain(process.execPath);
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

  it('runs a real auto Hermes runtime smoke from the CLI', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'runtime-smoke', 'auto', '--json']);

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
          command: string | null;
          id: string;
          runnable: boolean;
          smokeCommand: string | null;
          status: string;
        }>;
        localRunnableCount: number;
        routePlan: {
          mode: string;
          primaryBackendId: string | null;
          smokeCommand: string | null;
        };
      };
    };

    expect(output.kind).toBe('hermes_browser_backends_status');
    expect(output.schemaVersion).toBe(1);
    expect(output.readiness.backends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-playwright',
          command: nodeDisplayCommand,
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          status: 'available',
        }),
        expect.objectContaining({
          id: 'session-recording',
          command: nodeDisplayCommand,
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          status: 'available',
        }),
      ]),
    );
    expect(output.readiness.localRunnableCount).toBeGreaterThanOrEqual(1);
    expect(output.readiness.routePlan).toMatchObject({
      mode: 'hybrid',
      primaryBackendId: 'local-playwright',
      smokeCommand: 'buddy hermes browser-smoke auto --json',
    });
    expect(JSON.stringify(output)).not.toContain(process.execPath);
  });

  it('runs a real local Hermes browser smoke from the CLI', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'browser-smoke', 'local-playwright', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      result: {
        artifacts?: Array<{
          exists: boolean;
          kind: string;
          path: string;
          sizeBytes: number;
        }>;
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
    expect(output.result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exists: true,
          kind: 'playwright-trace',
          sizeBytes: expect.any(Number),
        }),
      ]),
    );
    expect(output.result.artifacts?.[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it('runs the real auto Hermes browser smoke through hybrid routing', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'browser-smoke', 'auto', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      schemaVersion: number;
      result: {
        backendId: string;
        ok: boolean;
        output: string;
        status: string;
      };
    };

    expect(output.kind).toBe('hermes_browser_backend_smoke');
    expect(output.schemaVersion).toBe(1);
    expect(output.result).toMatchObject({
      backendId: 'local-playwright',
      ok: true,
      status: 'passed',
    });
    expect(output.result.output).toContain('OK-HERMES-BROWSER');
  });

  it('runs the safe aggregate Hermes local smoke suite from the CLI', async () => {
    const program = createProgram();
    registerHermesCommands(program);

    await program.parseAsync(['node', 'test', 'hermes', 'smoke', '--json']);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      ok: boolean;
      schemaVersion: number;
      commands: {
        browser: string;
        protocols: string;
        runtime: string;
      };
      notes: string[];
      results: {
        browser: {
          artifacts?: Array<{ path: string }>;
          backendId: string;
          command: string | null;
          ok: boolean;
          output: string;
          status: string;
        };
        protocols: {
          ok: boolean;
          httpRoutes: { ok: boolean };
          mcpStdio: { ok: boolean; toolCount: number };
        };
        runtime: {
          backendId: string;
          command: string | null;
          ok: boolean;
          output: string;
          status: string;
        };
      };
    };

    expect(output.kind).toBe('hermes_local_smoke_suite');
    expect(output.schemaVersion).toBe(1);
    expect(output.ok).toBe(true);
    expect(output.results.runtime).toMatchObject({
      backendId: 'local',
      command: expect.stringMatching(/^(node|node\.exe)$/),
      ok: true,
      status: 'passed',
    });
    expect(output.results.runtime.output).toContain('OK-HERMES-LOCAL');
    expect(output.results.browser).toMatchObject({
      backendId: 'local-playwright',
      ok: true,
      status: 'passed',
    });
    expect(output.results.browser.output).toContain('OK-HERMES-BROWSER');
    expect(output.results.browser.output).toContain('trace=[redacted-local-path]');
    expect(output.results.browser.command).toMatch(/^(node|node\.exe)$/);
    expect(output.results.browser.artifacts?.[0]?.path).toBe('local-playwright-trace.zip');
    expect(JSON.stringify(output)).not.toMatch(/[A-Za-z]:\\\\/);
    expect(JSON.stringify(output)).not.toContain(process.execPath);
    expect(output.results.protocols.ok).toBe(true);
    expect(output.results.protocols.mcpStdio.ok).toBe(true);
    expect(output.results.protocols.mcpStdio.toolCount).toBeGreaterThan(0);
    expect(output.results.protocols.httpRoutes.ok).toBe(true);
    expect(output.commands).toEqual({
      browser: 'buddy hermes browser-smoke auto --json',
      protocols: 'buddy hermes protocols-smoke local --json',
      runtime: 'buddy hermes runtime-smoke auto --json',
    });
    expect(output.notes.join(' ')).toContain('Remote providers');

    consoleLogSpy.mockClear();
    const textProgram = createProgram();
    registerHermesCommands(textProgram);
    await textProgram.parseAsync(['node', 'test', 'hermes', 'smoke']);
    const textOutput = getLogOutput();
    expect(textOutput).toContain('Hermes local smoke: ok');
    expect(textOutput).toContain('Runtime: passed (local');
    expect(textOutput).toContain('Browser: passed (local-playwright');
    expect(textOutput).toContain('Protocols: passed');
    expect(textOutput).toContain('Remote providers, Docker image pulls, and managed browser backends are intentionally not invoked');
  });
});
