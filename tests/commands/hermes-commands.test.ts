import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHermesCommands } from '../../src/commands/cli/hermes-commands.js';

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
    expect(output).toContain('Dispatch profile selection:');
    expect(output).toContain('safe: high-risk');
    expect(output).toContain('Native surfaces:');
  });
});
