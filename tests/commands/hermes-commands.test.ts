import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHermesCommands } from '../../src/commands/cli/hermes-commands.js';
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
          id: 'cron-scheduling',
          status: 'partial',
          codeBuddyEvidence: expect.arrayContaining(['src/commands/cron-cli/index.ts']),
          verificationCommands: expect.arrayContaining([
            'npm test -- tests/commands/cron-cli.test.ts tests/scheduler/cron-scheduler-manual-run.test.ts --run',
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
      ]),
    );
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
    expect(output.codeBuddySource.localToolCount).toBeGreaterThan(0);
    expect(output.codeBuddySource.localToolNames).toContain('browser');
    expect(output.summary.total).toBe(output.tools.length);
    expect(output.summary.nativeEquivalent).toBeGreaterThan(0);
    expect(output.summary.partial).toBeGreaterThan(0);
    expect(output.summary.gaps).toBeGreaterThan(0);
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
          status: 'partial',
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
    expect(output.summary.gaps).toBeGreaterThan(0);
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
    expect(output).toContain('Dispatch profile selection:');
    expect(output).toContain('safe: high-risk');
    expect(output).toContain('Native surfaces:');
  });
});
