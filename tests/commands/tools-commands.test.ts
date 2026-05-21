import { Command } from 'commander';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildResearchScriptJobArtifact } from '../../src/agent/research-script-job-artifact.js';
import type { ResearchScriptJobRunResult } from '../../src/agent/research-script-job-runner.js';
import {
  buildResearchScriptSkillCandidate,
  materializeResearchScriptSkillCandidate,
} from '../../src/agent/research-script-skill-candidate.js';
import { registerToolsCommands } from '../../src/commands/cli/tools-commands.js';

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

function runResult(overrides: Partial<ResearchScriptJobRunResult> = {}): ResearchScriptJobRunResult {
  return {
    commandPreview: 'node script.js',
    durationMs: 25,
    exitCode: 0,
    jobId: 'research-script-cli',
    outputPath: 'research-scripts/cli/output.json',
    signal: null,
    status: 'completed',
    stderrPath: 'research-scripts/cli/stderr.log',
    stdoutPath: 'research-scripts/cli/stdout.log',
    summaryPath: 'research-scripts/cli/summary.md',
    timedOut: false,
    ...overrides,
  };
}

async function materializeCliSkillCandidate(rootDir: string): Promise<string> {
  const job = buildResearchScriptJobArtifact({
    id: 'research-script-cli',
    goal: 'Inspect public lead discovery workflow candidates.',
    title: 'CLI reviewed workflow',
    language: 'javascript',
    inputContract: { INPUT_JSON: 'Input.' },
    outputContract: { OUTPUT_JSON: 'Output.' },
    sandboxPolicy: {
      network: 'disabled',
    },
  });
  const candidate = buildResearchScriptSkillCandidate(job, [
    runResult({ jobId: job.id }),
    runResult({ jobId: job.id, durationMs: 40 }),
  ]);
  const materialized = await materializeResearchScriptSkillCandidate(candidate, {
    generatedAt: '2026-05-18T18:00:00.000Z',
    rootDir,
  });

  return materialized.skillPath.replace(/\/SKILL\.md$/i, '');
}

describe('Tools CLI commands', () => {
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints JSON for a Hermes-safe profile against selected tools', async () => {
    const program = createProgram();
    registerToolsCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'tools',
      'profile',
      '--json',
      'hermes-safe',
      'view_file',
      'create_file',
      'bash',
      'web_fetch',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      profile: string;
      profileId: string;
      filter: { enabledPatterns: string[]; disabledPatterns: string[] };
      decisions: Array<{ tool: string; action: string }>;
    };

    expect(output.profile).toBe('safe');
    expect(output.profileId).toBe('fleet.hermes.safe');
    expect(output.filter.enabledPatterns).toEqual(['view_file', 'web_fetch']);
    expect(output.filter.disabledPatterns).toEqual(['create_file', 'bash']);
    expect(output.decisions).toEqual([
      expect.objectContaining({ tool: 'view_file', action: 'allow' }),
      expect.objectContaining({ tool: 'create_file', action: 'deny' }),
      expect.objectContaining({ tool: 'bash', action: 'deny' }),
      expect.objectContaining({ tool: 'web_fetch', action: 'confirm' }),
    ]);
  });

  it('prints a human-readable profile inspector', async () => {
    const program = createProgram();
    registerToolsCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'tools',
      'profile',
      'fleet.hermes.review',
      'view_file',
      'create_file',
    ]);

    const output = getLogOutput();
    expect(output).toContain('Tool profile: fleet.hermes.review');
    expect(output).toContain('Policy: minimal / confirm');
    expect(output).toContain('Effective allow: view_file');
    expect(output).toContain('Effective deny: create_file');
    expect(output).toContain('create_file: deny');
  });

  it('prints JSON for a Browser Operator draft without starting a browser', async () => {
    const program = createProgram();
    registerToolsCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'tools',
      'browser-operator',
      'draft',
      'tester un formulaire public',
      '--source-url',
      'https://example.com/form',
      '--requires-interaction',
      '--expected-text',
      'Merci',
      '--mode',
      'local',
      '--consent-granted',
      '--granted-by',
      'Patrice',
      '--generated-at',
      '2026-05-18T21:10:00.000Z',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      draft: {
        consent: {
          granted: boolean;
          grantedBy?: string;
          required: boolean;
          scopes: string[];
        };
        mode: string;
        proofExport: { artifactName: string };
        actionLog: Array<{ id: string; requiresConsent: boolean }>;
      };
      plan: {
        sourceUrl?: string;
        steps: Array<{ id: string }>;
      };
    };

    expect(output.plan.sourceUrl).toBe('https://example.com/form');
    expect(output.plan.steps.map((step) => step.id)).toEqual([
      'static-read',
      'observe',
      'interaction-plan',
      'extract',
      'assert',
    ]);
    expect(output.draft.mode).toBe('local');
    expect(output.draft.consent).toMatchObject({
      required: true,
      granted: true,
      grantedBy: 'Patrice',
    });
    expect(output.draft.consent.scopes).toContain('browser_interaction');
    expect(output.draft.actionLog.every((entry) => entry.requiresConsent)).toBe(true);
    expect(output.draft.proofExport.artifactName).toBe(
      'browser-operator-tester-un-formulaire-public-20260518211000.browser-operator.json',
    );
  });

  it('prints a human-readable Browser Operator handoff', async () => {
    const program = createProgram();
    registerToolsCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'tools',
      'browser-operator',
      'draft',
      'verifier PostCommander',
      '--expected-text',
      'PostCommander',
    ]);

    const output = getLogOutput();

    expect(output).toContain('# Browser Operator Session: verifier PostCommander');
    expect(output).toContain('browser.assert_text');
    expect(output).toContain('## Source Plan');
    expect(output).toContain('# Internet Scout Plan: verifier PostCommander');
  });

  it('prints JSON for a materialized research script skill candidate', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tools-skill-candidate-inspect-'));
    const previousCwd = process.cwd();
    try {
      const candidateDir = await materializeCliSkillCandidate(rootDir);
      process.chdir(rootDir);
      const program = createProgram();
      registerToolsCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'tools',
        'skill-candidate',
        'inspect',
        candidateDir,
        '--json',
      ]);

      const output = JSON.parse(getLogOutput()) as {
        candidate: {
          eligible: boolean;
          skillName: string;
          sourceJobId: string;
          successfulRunCount: number;
        };
        reviewManifestPath: string;
      };

      expect(output.candidate).toMatchObject({
        eligible: true,
        skillName: 'research-cli-reviewed-workflow',
        sourceJobId: 'research-script-cli',
        successfulRunCount: 2,
      });
      expect(output.reviewManifestPath).toBe(
        '.codebuddy/skill-candidates/research-cli-reviewed-workflow/candidate-review.json',
      );
    } finally {
      process.chdir(previousCwd);
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('lists materialized research script skill candidates', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tools-skill-candidate-list-'));
    const previousCwd = process.cwd();
    try {
      await materializeCliSkillCandidate(rootDir);
      process.chdir(rootDir);
      const program = createProgram();
      registerToolsCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'tools',
        'skill-candidate',
        'list',
        '--eligible-only',
        '--json',
      ]);

      const output = JSON.parse(getLogOutput()) as {
        candidates: Array<{
          eligible: boolean;
          skillName: string;
        }>;
        count: number;
      };

      expect(output.count).toBe(1);
      expect(output.candidates).toEqual([
        expect.objectContaining({
          eligible: true,
          skillName: 'research-cli-reviewed-workflow',
        }),
      ]);
    } finally {
      process.chdir(previousCwd);
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('installs an approved materialized research script skill candidate', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tools-skill-candidate-install-'));
    const previousCwd = process.cwd();
    try {
      const candidateDir = await materializeCliSkillCandidate(rootDir);
      process.chdir(rootDir);
      const program = createProgram();
      registerToolsCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'tools',
        'skill-candidate',
        'install',
        candidateDir,
        '--approved-by',
        'Patrice',
        '--json',
      ]);

      const output = JSON.parse(getLogOutput()) as {
        installed: {
          approvedBy: string;
          installedPath: string;
          skillName: string;
        };
      };

      expect(output.installed).toMatchObject({
        approvedBy: 'Patrice',
        installedPath: '.codebuddy/skills/research-cli-reviewed-workflow/SKILL.md',
        skillName: 'research-cli-reviewed-workflow',
      });
      await expect(
        fs.readFile(path.join(rootDir, '.codebuddy', 'skills', 'research-cli-reviewed-workflow', 'SKILL.md'), 'utf8'),
      ).resolves.toContain('- Approved by: Patrice');
    } finally {
      process.chdir(previousCwd);
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
