import { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerRunCommands } from '../../src/commands/run-cli/index.js';
import { RunStore } from '../../src/observability/run-store.js';

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let tempDir: string;
let store: RunStore;
let activeRunIds: string[];

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

describe('Run CLI commands', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-cli-command-'));
    store = new RunStore(tempDir);
    activeRunIds = [];
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // Ignore cleanup races from already-ended runs.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    consoleLogSpy.mockRestore();
    store.dispose();
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function startRun(objective: string, metadata?: Parameters<RunStore['startRun']>[1]): string {
    const runId = store.startRun(objective, metadata);
    activeRunIds.push(runId);
    return runId;
  }

  it('prints JSON run search results for UI consumers', async () => {
    const runId = startRun('Hermes skill candidate review', {
      channel: 'cowork',
      tags: ['fleet'],
    });
    store.saveArtifact(runId, 'summary.md', 'Hermes skill candidate queue artifact for Cowork review.');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'search',
      '--json',
      '--source',
      'cowork',
      'candidate',
      'queue',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      count: number;
      filters: {
        limit: number;
        sources: string[];
      };
      generatedAt: string;
      query: string;
      results: Array<{
        artifact?: string;
        matched: string;
        runId: string;
        source?: string;
      }>;
      schemaVersion: number;
    };

    expect(output).toMatchObject({
      count: 1,
      filters: {
        limit: 20,
        sources: ['cowork'],
      },
      query: 'candidate queue',
      schemaVersion: 1,
    });
    expect(new Date(output.generatedAt).toString()).not.toBe('Invalid Date');
    expect(output.results).toEqual([
      expect.objectContaining({
        artifact: 'summary.md',
        matched: 'artifact',
        runId,
        source: 'cowork',
      }),
    ]);
  });

  it('prints JSON artifact index backfill stats for historical runs', async () => {
    const runId = startRun('Historical Cowork handoff', {
      channel: 'cowork',
      tags: ['fleet'],
    });
    fs.writeFileSync(
      path.join(tempDir, runId, 'artifacts', 'legacy-summary.md'),
      'Legacy Cowork operator handoff with durable proof snippets.',
      'utf-8',
    );
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'index-artifacts',
      '--json',
      '--source',
      'cowork',
      '--limit',
      '5',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      artifactCount: number;
      failedCount: number;
      filters: {
        limit: number;
        sources: string[];
      };
      generatedAt: string;
      indexedCount: number;
      runCount: number;
      schemaVersion: number;
      unavailable: boolean;
    };

    expect(output).toMatchObject({
      artifactCount: 1,
      failedCount: 0,
      filters: {
        limit: 5,
        sources: ['cowork', 'desktop'],
      },
      indexedCount: 1,
      runCount: 1,
      schemaVersion: 1,
      unavailable: false,
    });
    expect(new Date(output.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('prints JSON recall packs for agent handoffs', async () => {
    const runId = startRun('Hermes architect lead discovery', {
      channel: 'cowork',
      tags: ['fleet', 'research'],
    });
    store.saveArtifact(runId, 'summary.md', 'architect lead discovery produced a review-only public-data script.');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'recall-pack',
      '--json',
      '--source',
      'cowork',
      'architect',
      'lead',
      'discovery',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      filters: {
        limit: number;
        sources: string[];
      };
      promptContext: string;
      query: string;
      runCount: number;
      runs: Array<{
        matches: Array<{ artifact?: string; matched: string }>;
        runId: string;
        source?: string;
      }>;
      schemaVersion: number;
    };

    expect(output).toMatchObject({
      filters: {
        limit: 20,
        sources: ['cowork'],
      },
      query: 'architect lead discovery',
      runCount: 1,
      schemaVersion: 1,
    });
    expect(output.runs[0]).toEqual(expect.objectContaining({
      runId,
      source: 'cowork',
    }));
    expect(output.runs[0]?.matches[0]).toEqual(expect.objectContaining({
      artifact: 'summary.md',
      matched: 'artifact',
    }));
    expect(output.promptContext).toContain(`# Run recall pack`);
    expect(output.promptContext).toContain(`## ${runId}`);
  });

  it('prints JSON redacted trajectory exports for a run', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwx';
    const runId = startRun('Trajectory export lead discovery', {
      channel: 'cowork',
      sessionId: 'session_trajectory',
      tags: ['eval'],
    });
    store.emit(runId, {
      type: 'decision',
      data: { selectedContext: 'Use public source URLs for every contact.' },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolCallId: 'call_search',
        toolName: 'web_search',
        args: {
          apiKey: secret,
          query: 'architects near Lyon',
        },
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        output: `Search completed with token=${secret}`,
        success: true,
        toolName: 'web_search',
      },
    });
    store.saveArtifact(runId, 'summary.md', `Manual review summary ${secret}`);
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'trajectory-export',
      '--json',
      '--include-artifact-content',
      runId,
    ]);

    const output = JSON.parse(getLogOutput()) as {
      artifacts: Array<{
        contentPreview?: string;
        name: string;
      }>;
      kind: string;
      mode: string;
      privacy: {
        artifactContentIncluded: boolean;
        redactionCount: number;
      };
      run: {
        runId: string;
        sessionId?: string;
      };
      selectedContext: Array<{ source: string }>;
      toolCalls: Array<{ toolName: string }>;
      toolResults: Array<{ toolName: string }>;
    };

    expect(output).toMatchObject({
      kind: 'run_trajectory_export',
      mode: 'redacted_review_export',
      privacy: {
        artifactContentIncluded: true,
      },
      run: {
        runId,
        sessionId: 'session_trajectory',
      },
    });
    expect(output.selectedContext).toEqual([
      expect.objectContaining({ source: 'decision.selectedContext' }),
    ]);
    expect(output.toolCalls).toEqual([
      expect.objectContaining({ toolName: 'web_search' }),
    ]);
    expect(output.toolResults).toEqual([
      expect.objectContaining({ toolName: 'web_search' }),
    ]);
    expect(output.artifacts).toEqual([
      expect.objectContaining({
        contentPreview: expect.stringContaining('[REDACTED'),
        name: 'summary.md',
      }),
    ]);
    expect(output.privacy.redactionCount).toBeGreaterThan(0);
    expect(JSON.stringify(output)).not.toContain(secret);
  });

  it('prints JSON proof ledger cards for UI consumers', async () => {
    const runId = startRun('Proof Ledger CLI card', {
      channel: 'cowork',
      tags: ['fleet'],
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolCallId: 'call_test',
        toolName: 'bash',
        args: { command: 'npm test -- tests/observability/proof-ledger.test.ts' },
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        success: true,
        toolCallId: 'call_test',
        toolName: 'bash',
      },
    });
    store.saveArtifact(runId, 'summary.md', 'Proof Ledger CLI evidence.');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'proof',
      '--json',
      runId,
    ]);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      run: {
        runId: string;
        source?: string;
      };
      status: string;
      tests: {
        passed: number;
        total: number;
      };
    };

    expect(output).toMatchObject({
      kind: 'proof_ledger_entry',
      run: {
        runId,
        source: 'fleet',
      },
      status: 'proven',
      tests: {
        passed: 1,
        total: 1,
      },
    });
  });

  it('prints JSON golden workflow eval manifests for repeatable workflow checks', async () => {
    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'golden-evals',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      fixtures: Array<{
        id: string;
      }>;
      kind: string;
      schemaVersion: number;
    };

    expect(output).toMatchObject({
      kind: 'golden_workflow_eval_manifest',
      schemaVersion: 1,
    });
    expect(output.fixtures.map((fixture) => fixture.id)).toEqual([
      'lead-discovery',
      'code-fix',
      'doc-workshop',
      'fleet-review',
      'recall-handoff',
      'scheduled-run',
    ]);
  });

  it('prints JSON golden workflow eval results for a run trajectory', async () => {
    const runId = startRun('Lead discovery eval with public source evidence', {
      channel: 'cowork',
      tags: ['fleet', 'research'],
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolName: 'web_search',
        args: { query: 'architects public directory' },
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        output: 'Public source URL https://example.com/architects kept for review.',
        success: true,
        toolName: 'web_search',
      },
    });
    store.saveArtifact(runId, 'architect-leads.csv', 'name,source_url\nAgence A,https://example.com/architects');
    store.saveArtifact(runId, 'source-evidence.md', 'Evidence: https://example.com/architects');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'golden-evals',
      '--json',
      'lead-discovery',
      runId,
    ]);

    const output = JSON.parse(getLogOutput()) as {
      fixture: {
        id: string;
      };
      kind: string;
      passed: boolean;
      results: Array<{
        assertionId: string;
        passed: boolean;
      }>;
      runId: string;
    };

    expect(output).toMatchObject({
      fixture: {
        id: 'lead-discovery',
      },
      kind: 'golden_workflow_eval_result',
      passed: true,
      runId,
    });
    expect(output.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertionId: 'no-outreach-tools', passed: true }),
        expect.objectContaining({ assertionId: 'public-source-evidence', passed: true }),
        expect.objectContaining({ assertionId: 'lead-export-artifact', passed: true }),
      ]),
    );
  });

  it('prints JSON policy eval manifests for trajectory safety checks', async () => {
    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'policy-evals',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      policies: Array<{
        id: string;
      }>;
      schemaVersion: number;
    };

    expect(output).toMatchObject({
      kind: 'policy_eval_manifest',
      schemaVersion: 1,
    });
    expect(output.policies.map((policy) => policy.id)).toEqual([
      'safe-profile-no-mutation',
      'review-profile-no-mutation',
      'public-data-source-urls',
    ]);
  });

  it('prints JSON policy eval results for a run trajectory', async () => {
    const runId = startRun('Public data source URL collection', {
      channel: 'cowork',
      tags: ['public-data', 'research'],
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        output: 'Evidence public source URL https://example.com/architects kept for review.',
        success: true,
        toolName: 'web_search',
      },
    });
    store.saveArtifact(runId, 'architect-leads.csv', 'name,source_url\nAgence A,https://example.com/architects');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'policy-evals',
      '--json',
      'public-data-source-urls',
      runId,
    ]);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      passed: boolean;
      policy: {
        id: string;
      };
      results: Array<{
        assertionId: string;
        passed: boolean;
      }>;
      runId: string;
    };

    expect(output).toMatchObject({
      kind: 'policy_eval_result',
      passed: true,
      policy: {
        id: 'public-data-source-urls',
      },
      runId,
    });
    expect(output.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertionId: 'public-source-url', passed: true }),
        expect.objectContaining({ assertionId: 'source-url-field', passed: true }),
        expect.objectContaining({ assertionId: 'no-outreach-tools', passed: true }),
      ]),
    );
  });

  it('can include matching lessons in JSON recall packs', async () => {
    const originalCwd = process.cwd();
    fs.mkdirSync(path.join(tempDir, '.codebuddy'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.codebuddy', 'lessons.md'),
      [
        '# Lessons Learned',
        '',
        '## PATTERN',
        '- [lesson_architect_contacts] Keep public evidence beside architect contacts. <!-- 2026-05-18 self_observed:Lead Scout -->',
        '',
      ].join('\n'),
      'utf-8',
    );

    try {
      process.chdir(tempDir);
      const program = createProgram();
      registerRunCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'run',
        'recall-pack',
        '--json',
        '--lessons',
        '--max-lessons',
        '1',
        'architect',
        'contacts',
      ]);
    } finally {
      process.chdir(originalCwd);
    }

    const output = JSON.parse(getLogOutput()) as {
      filters: {
        maxLessons: number;
      };
      lessonCount: number;
      lessons: Array<{
        context?: string;
        id: string;
      }>;
      promptContext: string;
      runCount: number;
    };

    expect(output).toMatchObject({
      filters: {
        maxLessons: 1,
      },
      lessonCount: 1,
      runCount: 0,
    });
    expect(output.lessons[0]).toEqual(expect.objectContaining({
      context: 'Lead Scout',
      id: 'lesson_architect_contacts',
    }));
    expect(output.promptContext).toContain('## Lessons');
    expect(output.promptContext).toContain('Keep public evidence beside architect contacts');
  });

  it('can include matching persistent memories in JSON recall packs', async () => {
    const originalCwd = process.cwd();
    const memoryFile = path.join(tempDir, '.codebuddy', 'CODEBUDDY_MEMORY.md');
    fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    fs.writeFileSync(
      memoryFile,
      [
        '# Code Buddy Memory',
        '',
        '## Decisions',
        '- **architect-evidence**: Architect lead discovery keeps public source URLs next to extracted contacts.',
        '',
      ].join('\n'),
      'utf-8',
    );

    try {
      process.chdir(tempDir);
      const program = createProgram();
      registerRunCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'run',
        'recall-pack',
        '--json',
        '--memories',
        '--max-memories',
        '1',
        'architect',
        'source',
        'urls',
      ]);
    } finally {
      process.chdir(originalCwd);
    }

    const output = JSON.parse(getLogOutput()) as {
      filters: {
        maxMemories: number;
      };
      memories: Array<{
        key?: string;
      }>;
      memoryCount: number;
      promptContext: string;
      runCount: number;
    };

    expect(output).toMatchObject({
      filters: {
        maxMemories: 1,
      },
      memoryCount: 1,
      runCount: 0,
    });
    expect(output.memories[0]).toEqual(expect.objectContaining({
      key: 'architect-evidence',
    }));
    expect(output.promptContext).toContain('## Memories');
    expect(output.promptContext).toContain('Architect lead discovery keeps public source URLs');
  });

  it('can include all durable context inputs with one recall-pack flag', async () => {
    const originalCwd = process.cwd();
    fs.mkdirSync(path.join(tempDir, '.codebuddy'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.codebuddy', 'lessons.md'),
      [
        '# Lessons Learned',
        '',
        '## PATTERN',
        '- [lesson_architect_public_context] Architect public context should stay beside contacts. <!-- 2026-05-18 self_observed:Lead Scout -->',
        '',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tempDir, '.codebuddy', 'CODEBUDDY_MEMORY.md'),
      [
        '# Code Buddy Memory',
        '',
        '## Project Context',
        '- **architect-public-context**: Architect public context needs source URLs beside contacts.',
        '',
      ].join('\n'),
      'utf-8',
    );

    try {
      process.chdir(tempDir);
      const program = createProgram();
      registerRunCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'run',
        'recall-pack',
        '--json',
        '--all-context',
        '--max-lessons',
        '1',
        '--max-memories',
        '1',
        '--max-sessions',
        '0',
        'architect',
        'public',
        'context',
      ]);
    } finally {
      process.chdir(originalCwd);
    }

    const output = JSON.parse(getLogOutput()) as {
      lessonCount: number;
      memoryCount: number;
      promptContext: string;
      sessionCount: number;
    };

    expect(output).toMatchObject({
      lessonCount: 1,
      memoryCount: 1,
      sessionCount: 0,
    });
    expect(output.promptContext).toContain('## Lessons');
    expect(output.promptContext).toContain('## Memories');
  });

  it('prints JSON mobile supervision snapshots without enabling remote actions', async () => {
    const leakedSecret = 'api_key="abcdefghijklmnopqrstuvwx"';
    const runId = startRun('Mobile-safe architect handoff', {
      channel: 'cowork',
      tags: ['mobile'],
    });
    store.saveArtifact(
      runId,
      'summary.md',
      `Mobile handoff summary includes architect context and ${leakedSecret}.`,
    );
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'mobile-snapshot',
      '--json',
      '--source',
      'cowork',
      'architect',
      'handoff',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      allowedActions: string[];
      blockedActions: string[];
      mode: string;
      recallPack: {
        runCount: number;
      };
      redactionCount: number;
      safety: {
        autoDispatch: boolean;
        remoteExecutionDisabled: boolean;
      };
      schemaVersion: number;
    };

    expect(output).toMatchObject({
      mode: 'review_only',
      recallPack: {
        runCount: 1,
      },
      safety: {
        autoDispatch: false,
        remoteExecutionDisabled: true,
      },
      schemaVersion: 1,
    });
    expect(output.allowedActions).toContain('draft_followup_prompt');
    expect(output.blockedActions).toContain('execute_tool');
    expect(output.redactionCount).toBeGreaterThan(0);
    expect(JSON.stringify(output)).not.toContain(leakedSecret);
  });

  it('prints JSON mobile gateway contracts without embedding a remote executor', async () => {
    const runId = startRun('Mobile gateway contract handoff', {
      channel: 'cowork',
      tags: ['mobile'],
    });
    store.saveArtifact(runId, 'summary.md', 'Mobile gateway contract exposes review-only routes.');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'mobile-gateway-contract',
      '--json',
      '--no-snapshot',
      '--source',
      'cowork',
      'mobile',
      'gateway',
      'contract',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      blockedOperations: Array<{
        action: string;
        policy: {
          allowed: boolean;
          requiresLocalOperator: boolean;
        };
      }>;
      endpoints: Array<{
        action: string;
        path: string;
        policy: {
          allowed: boolean;
        };
      }>;
      mode: string;
      snapshot?: unknown;
      transport: {
        remoteExecution: string;
      };
    };

    expect(output).toMatchObject({
      mode: 'contract_only',
      transport: {
        remoteExecution: 'disabled',
      },
    });
    expect(output.snapshot).toBeUndefined();
    expect(output.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'view_run_summary',
          path: '/api/mobile/snapshot',
          policy: expect.objectContaining({
            allowed: true,
          }),
        }),
      ]),
    );
    expect(output.blockedOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'execute_tool',
          policy: expect.objectContaining({
            allowed: false,
            requiresLocalOperator: true,
          }),
        }),
      ]),
    );
  });

  it('prints JSON mobile gateway request policy decisions', async () => {
    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'mobile-gateway-check',
      '--json',
      '--action',
      'draft_followup_prompt',
      '--method',
      'POST',
      '--path',
      '/api/mobile/followup-draft',
      'mobile',
      'gateway',
      'policy',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      action: string;
      allowed: boolean;
      endpointId?: string;
      requiresLocalOperator: boolean;
      sideEffects: string;
    };

    expect(output).toMatchObject({
      action: 'draft_followup_prompt',
      allowed: false,
      endpointId: 'mobile.followup.draft',
      requiresLocalOperator: true,
      sideEffects: 'draft_only',
    });
  });

  it('prints JSON mobile gateway local operator review drafts', async () => {
    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'mobile-gateway-review-draft',
      '--json',
      '--action',
      'execute_tool',
      '--method',
      'POST',
      '--path',
      '/api/mobile/followup-draft',
      'mobile',
      'gateway',
      'review',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      decision: {
        allowed: boolean;
      };
      kind: string;
      operatorActions: string[];
      safety: {
        autoDispatch: boolean;
        remoteExecutionDisabled: boolean;
      };
      status: string;
    };

    expect(output).toMatchObject({
      decision: {
        allowed: false,
      },
      kind: 'mobile_gateway_review_draft',
      operatorActions: ['reject'],
      safety: {
        autoDispatch: false,
        remoteExecutionDisabled: true,
      },
      status: 'blocked',
    });
  });

  it('prints JSON mobile gateway disabled listener shells', async () => {
    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'mobile-gateway-listener-shell',
      '--json',
      'mobile',
      'gateway',
      'listener',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      bind: {
        host: string;
        status: string;
      };
      kind: string;
      mode: string;
      routes: Array<{
        action: string;
        handler: string;
      }>;
      safety: {
        remoteExecutionDisabled: boolean;
        serverStarted: boolean;
      };
    };

    expect(output).toMatchObject({
      bind: {
        host: '127.0.0.1',
        status: 'not_started',
      },
      kind: 'mobile_gateway_listener_shell',
      mode: 'disabled_shell',
      safety: {
        remoteExecutionDisabled: true,
        serverStarted: false,
      },
    });
    expect(output.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'draft_followup_prompt',
          handler: 'local_operator_review_stub',
        }),
      ]),
    );
  });

  it('prints JSON preview-only mobile pairing state', async () => {
    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'mobile-pairing-state',
      '--json',
      '--device-label',
      'Patrice phone',
      '--ttl',
      '120',
      'mobile',
      'pairing',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      kind: string;
      listener: {
        listenerStatus: string;
        serverStarted: boolean;
      };
      pairing: {
        deviceLabel: string;
        previewCode: string;
        status: string;
        tokenIssued: boolean;
        ttlSeconds: number;
      };
      safety: {
        notAcceptedByAnyServer: boolean;
        secretMaterialPersisted: boolean;
      };
    };

    expect(output).toMatchObject({
      kind: 'mobile_supervision_pairing_state',
      listener: {
        listenerStatus: 'not_started',
        serverStarted: false,
      },
      pairing: {
        deviceLabel: 'Patrice phone',
        status: 'preview_only',
        tokenIssued: false,
        ttlSeconds: 120,
      },
      safety: {
        notAcceptedByAnyServer: true,
        secretMaterialPersisted: false,
      },
    });
    expect(output.pairing.previewCode).toMatch(/^\d{6}$/);
  });

  it('prints JSON no-network mobile pairing acceptance plans', async () => {
    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'mobile-pairing-acceptance-plan',
      '--json',
      '--device-label',
      'Patrice phone',
      '--ttl',
      '120',
      '--operator-label',
      'Patrice',
      'mobile',
      'pairing',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      acceptance: {
        canAcceptNow: boolean;
        endpoint: {
          enabled: boolean;
          path: string;
        };
      };
      kind: string;
      mode: string;
      plannedMutations: Array<{
        enabled: boolean;
        id: string;
      }>;
      safety: {
        approvalMutationEndpointEnabled: boolean;
        serverStarted: boolean;
        tokenIssued: boolean;
      };
    };

    expect(output).toMatchObject({
      acceptance: {
        canAcceptNow: false,
        endpoint: {
          enabled: false,
          path: '/api/mobile/pairing/accept',
        },
      },
      kind: 'mobile_supervision_pairing_acceptance_plan',
      mode: 'acceptance_plan_only',
      safety: {
        approvalMutationEndpointEnabled: false,
        serverStarted: false,
        tokenIssued: false,
      },
    });
    expect(output.plannedMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        enabled: false,
        id: 'mint_short_lived_mobile_token',
      }),
    ]));
  });

  it('prints JSON local-only mobile approval queues', async () => {
    const program = createProgram();
    registerRunCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'run',
      'mobile-approval-queue',
      '--json',
      '--device-label',
      'Patrice phone',
      'mobile',
      'approval',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      counts: {
        blocked: number;
        pending: number;
        ready: number;
      };
      items: Array<{
        action: string;
        canDispatch: boolean;
        status: string;
      }>;
      kind: string;
      pairing: {
        tokenIssued: boolean;
      };
      safety: {
        approvalMutationEndpointEnabled: boolean;
        autoDispatch: boolean;
      };
    };

    expect(output).toMatchObject({
      counts: {
        blocked: 6,
        pending: 1,
        ready: 3,
      },
      kind: 'mobile_supervision_approval_queue',
      pairing: {
        tokenIssued: false,
      },
      safety: {
        approvalMutationEndpointEnabled: false,
        autoDispatch: false,
      },
    });
    expect(output.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'draft_followup_prompt',
          canDispatch: false,
          status: 'pending_local_operator',
        }),
        expect.objectContaining({
          action: 'execute_tool',
          canDispatch: false,
          status: 'blocked_by_policy',
        }),
      ]),
    );
  });
});
