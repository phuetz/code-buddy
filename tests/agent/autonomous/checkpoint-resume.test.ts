import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgenticCodingCell } from '../../../src/agent/autonomous/agentic-coding-runner.js';
import { saveCheckpoint } from '../../../src/agent/autonomous/checkpoint-manager.js';
import type { AgenticCodingTaskContract } from '../../../src/agent/autonomous/agentic-coding-contract.js';

const execFileAsync = promisify(execFile);

describe('runner checkpoint resume', () => {
  let tempRoot: string;
  let oldHome: string | undefined;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-checkpoint-resume-'));
    oldHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = tempRoot;
  });

  afterEach(async () => {
    process.env.CODEBUDDY_HOME = oldHome;
    await fs.rm(tempRoot, { force: true, recursive: true });
  });

  async function createTempGitRepo(): Promise<string> {
    const repo = await fs.mkdtemp(path.join(tempRoot, 'repo-'));
    await execFileAsync('git', ['init'], { cwd: repo });
    return repo;
  }

  const getContract = (repo: string): AgenticCodingTaskContract => ({
    repo,
    task: 'Resuming task test',
    allowedPaths: ['docs/...'],
    verification: ['node -e "console.log(\'verifying\')"'],
    riskLevel: 'low',
    edits: [{
      type: 'replace_text',
      path: 'docs/note.md',
      find: 'original text',
      replace: 'new text',
      expectedOccurrences: 1,
    }],
    maxFilesChanged: 5,
    maxToolRounds: 5,
    memoryPolicy: 'none',
    fleetPolicy: 'none',
  });

  it('returns final report immediately when resuming from verified state', async () => {
    const repo = await createTempGitRepo();
    const contract = getContract(repo);

    await saveCheckpoint({
      runId: 'resume-verified-run',
      step: 'verified',
      timestamp: new Date().toISOString(),
      options: { taskFile: 'task.json' },
      contract,
    });

    const report = await runAgenticCodingCell({
      resume: 'resume-verified-run',
    });

    expect(report.status).toBe('verified');
  });

  it('returns blocked report immediately when resuming from blocked state', async () => {
    const repo = await createTempGitRepo();
    const contract = getContract(repo);
    const reason = 'Maximum iterations (2) reached without passing verification.';

    await saveCheckpoint({
      runId: 'resume-blocked-run',
      step: 'blocked',
      timestamp: new Date().toISOString(),
      options: { taskFile: 'task.json', applyEdits: true, runVerification: true },
      contract,
      blockedReasons: [reason],
      verification: [{
        command: 'npm test -- tests/example.test.ts',
        status: 'failed',
        exitCode: 1,
        stdout: '',
        stderr: 'failed',
      }],
    });

    const report = await runAgenticCodingCell({
      resume: 'resume-blocked-run',
    });

    expect(report.status).toBe('blocked');
    expect(report.autoExecutable).toBe(false);
    expect(report.blockedReasons).toEqual([reason]);
    expect(report.editResults).toEqual([]);
    expect(report.verification).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ]);
  });

  it('skips edit application when resuming from applied state', async () => {
    const repo = await createTempGitRepo();
    const docPath = path.join(repo, 'docs');
    await fs.mkdir(docPath, { recursive: true });
    // Write something that doesn't match the find pattern, if edits were applied this would error or change
    await fs.writeFile(path.join(docPath, 'note.md'), 'completely different text', 'utf8');

    const contract = getContract(repo);

    await saveCheckpoint({
      runId: 'resume-applied-run',
      step: 'applied',
      timestamp: new Date().toISOString(),
      options: { taskFile: 'task.json', applyEdits: true, runVerification: true },
      contract,
    });

    const report = await runAgenticCodingCell({
      resume: 'resume-applied-run',
      runVerification: true,
      applyEdits: true,
    });

    expect(report.status).toBe('verified');
    expect(report.editResults).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'applied' })
    ]);
    
    // Verify the file was NOT modified
    const fileContent = await fs.readFile(path.join(docPath, 'note.md'), 'utf8');
    expect(fileContent).toBe('completely different text');
  });

  it('applies edits and runs verification when resuming from proposal_generated state', async () => {
    const repo = await createTempGitRepo();
    const docPath = path.join(repo, 'docs');
    await fs.mkdir(docPath, { recursive: true });
    await fs.writeFile(path.join(docPath, 'note.md'), 'original text', 'utf8');

    const contract = getContract(repo);

    await saveCheckpoint({
      runId: 'resume-proposal-generated-run',
      step: 'proposal_generated',
      timestamp: new Date().toISOString(),
      options: { taskFile: 'task.json', previewEdits: true, applyEdits: true, runVerification: true },
      contract,
    });

    const report = await runAgenticCodingCell({
      resume: 'resume-proposal-generated-run',
      previewEdits: true,
      applyEdits: true,
      runVerification: true,
    });

    expect(report.status).toBe('verified');
    expect(report.editPreviews).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'previewed' })
    ]);
    expect(report.editResults).toEqual([
      expect.objectContaining({ path: 'docs/note.md', status: 'applied' })
    ]);
    
    // Verify the file was indeed modified (since we resume from proposal_generated, we apply edits)
    const fileContent = await fs.readFile(path.join(docPath, 'note.md'), 'utf8');
    expect(fileContent).toBe('new text');
  });

  it('runs the full loop (preview, apply, verify) when resuming from initialized state', async () => {
    const repo = await createTempGitRepo();
    const docPath = path.join(repo, 'docs');
    await fs.mkdir(docPath, { recursive: true });
    await fs.writeFile(path.join(docPath, 'note.md'), 'original text', 'utf8');

    const contract = getContract(repo);

    await saveCheckpoint({
      runId: 'resume-initialized-run',
      step: 'initialized',
      timestamp: new Date().toISOString(),
      options: { taskFile: 'task.json', previewEdits: true, applyEdits: true, runVerification: true },
      contract,
    });

    const report = await runAgenticCodingCell({
      resume: 'resume-initialized-run',
      previewEdits: true,
      applyEdits: true,
      runVerification: true,
    });

    expect(report.status).toBe('verified');
    // The edit was actually applied, so the file content should be 'new text'
    const fileContent = await fs.readFile(path.join(docPath, 'note.md'), 'utf8');
    expect(fileContent).toBe('new text');
  });

  it('records observability when resuming a decomposed checkpoint', async () => {
    const repo = await createTempGitRepo();
    const contract = getContract(repo);
    const subtask: AgenticCodingTaskContract = {
      ...contract,
      task: 'Resume decomposed subtask',
      edits: [],
    };

    await saveCheckpoint({
      runId: 'resume-decomposed-run',
      step: 'decomposed',
      timestamp: new Date().toISOString(),
      options: { taskFile: 'task.json' },
      contract,
      currentSubtaskIndex: 0,
      reports: [],
      subtasks: [subtask],
    });

    const report = await runAgenticCodingCell({
      resume: 'resume-decomposed-run',
    });

    // This checkpoint contains no requested edits or verification command, so
    // the completed subtask is ready rather than falsely marked verified.
    expect(report.status).toBe('ready');
    expect(report.validationErrors).toEqual([]);
    expect(report.observability).toEqual(expect.objectContaining({
      eventsPath: expect.stringContaining('events.jsonl'),
      runId: expect.stringMatching(/^run_/),
      runsDir: path.join(tempRoot, 'runs'),
    }));

    const events = (await fs.readFile(report.observability!.eventsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { data: { stepId?: string }; type: string });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ stepId: 'resume-decomposed-checkpoint' }),
        type: 'step_start',
      }),
      expect.objectContaining({
        data: expect.objectContaining({ stepId: 'resume-decomposed-checkpoint' }),
        type: 'step_end',
      }),
      expect.objectContaining({ type: 'run_end' }),
    ]));
  });
});
