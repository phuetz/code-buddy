import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  persistRunArtifact,
  runAgenticCodingCell
} from '../../../src/agent/autonomous/agentic-coding-runner.js';
import { ConfirmationService } from '../../../src/utils/confirmation-service.js';
import { auditLogger } from '../../../src/security/audit-logger.js';
import { CodeBuddyClient } from '../../../src/codebuddy/client.js';

const execFileAsync = promisify(execFile);

describe('AgenticCodingRunner - Security and Self-Improvement', () => {
  let tempRoot: string;
  let tempRepo: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-security-test-'));
    // Set up a dummy Git repository for tests
    tempRepo = path.join(tempRoot, 'test-git-repo');
    await fs.mkdir(tempRepo, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: tempRepo });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tempRepo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempRepo });
    
    // Commit a dummy file
    const readmeFile = path.join(tempRepo, 'README.md');
    await fs.writeFile(readmeFile, 'Initial README content\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: tempRepo });
    await execFileAsync('git', ['commit', '-m', 'initial commit'], { cwd: tempRepo });
    
    auditLogger.clear();
    vi.spyOn(CodeBuddyClient.prototype, 'chat').mockRejectedValue(new Error('Mock LLM error'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempRoot, { force: true, recursive: true });
  });

  describe('persistRunArtifact', () => {
    it('redacts secrets (e.g. OpenAI API key) when writing files', async () => {
      const artifactPath = path.join(tempRoot, 'report.json');
      const sensitiveContent = JSON.stringify({
        message: 'Running preflight',
        key: 'sk-1234567890abcdef1234567890abcdef'
      }, null, 2);

      await persistRunArtifact(artifactPath, sensitiveContent);

      const fileContent = await fs.readFile(artifactPath, 'utf8');
      expect(fileContent).not.toContain('sk-1234567890abcdef1234567890abcdef');
      expect(fileContent).toContain('[REDACTED:OPENAI_KEY]');
    });
  });

  describe('Self-Improvement Detection and Branch Lifecycle', () => {
    it('flags self-improvement, prompts for human approval, and rolls back if approval is denied', async () => {
      // Mock process.cwd() to return our tempRepo path, so isSelfImprovement detects it
      vi.spyOn(process, 'cwd').mockReturnValue(tempRepo);

      // Create a task file targeting tempRepo
      const taskFile = path.join(tempRoot, 'task.json');
      const contract = {
        repo: tempRepo,
        task: 'Fix the README formatting',
        allowedPaths: ['README.md'],
        verification: ['node -e "console.log(\'verifying\')\"'],
        riskLevel: 'low',
        edits: [{
          type: 'replace_text',
          path: 'README.md',
          find: 'Initial README content',
          replace: 'Modified README content'
        }]
      };
      await fs.writeFile(taskFile, JSON.stringify(contract, null, 2), 'utf8');

      // Mock confirmation service to deny approval
      const confirmationService = ConfirmationService.getInstance();
      const spyConfirm = vi.spyOn(confirmationService, 'requestConfirmation').mockResolvedValue({
        confirmed: false,
        feedback: 'Safety sandbox policy denied self-improvement'
      });

      const report = await runAgenticCodingCell({
        taskFile,
        applyEdits: true,
        runVerification: true,
        runId: 'deny-test'
      });

      expect(spyConfirm).toHaveBeenCalled();
      expect(report.status).toBe('blocked');
      expect(report.blockedReasons).toContain('Self-improvement approval denied: Safety sandbox policy denied self-improvement');

      // Verify that audit log contains the block action
      const logs = auditLogger.getEntriesByAction('self_improvement');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].decision).toBe('block');
      expect(logs[0].details).toContain('Self-improvement approval denied');

      // Verify repo is untouched (no branch created or left checkout)
      const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tempRepo });
      expect(branchOut.trim()).not.toContain('tmp-self-improve-deny-test');
    });

    it('rolls back edits and sandbox branch if verification loop fails or returns blocked status', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(tempRepo);

      const taskFile = path.join(tempRoot, 'task.json');
      const contract = {
        repo: tempRepo,
        task: 'Fix the README formatting',
        allowedPaths: ['README.md'],
        verification: ['node -e "process.exit(1)\"'], // failing verification command
        riskLevel: 'low',
        edits: [{
          type: 'replace_text',
          path: 'README.md',
          find: 'Initial README content',
          replace: 'Modified README content'
        }]
      };
      await fs.writeFile(taskFile, JSON.stringify(contract, null, 2), 'utf8');

      // Mock confirmation service to approve
      const confirmationService = ConfirmationService.getInstance();
      const spyConfirm = vi.spyOn(confirmationService, 'requestConfirmation').mockResolvedValue({
        confirmed: true
      });

      const report = await runAgenticCodingCell({
        taskFile,
        applyEdits: true,
        runVerification: true,
        runId: 'fail-test'
      });

      expect(spyConfirm).toHaveBeenCalled();
      // The verification failed, so runner rolls back
      expect(report.status).toBe('blocked');

      // Check if audit logs show the rollback
      const logs = auditLogger.getEntriesByAction('self_improvement');
      const rollbackLog = logs.find(log => log.decision === 'block' && log.details?.includes('rolled back'));
      expect(rollbackLog).toBeDefined();

      // Check if active branch is restored to original (main/master) and sandbox branch is deleted
      const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tempRepo });
      expect(branchOut.trim()).not.toContain('tmp-self-improve-fail-test');

      // Check if sandbox branch was cleaned up
      const { stdout: branches } = await execFileAsync('git', ['branch'], { cwd: tempRepo });
      expect(branches).not.toContain('tmp-self-improve-fail-test');

      // Check if README.md was rolled back to initial state
      const readmeContent = await fs.readFile(path.join(tempRepo, 'README.md'), 'utf8');
      expect(readmeContent).toContain('Initial README content');
    });

    it('keeps sandbox branch and logs allow if verification loop succeeds', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(tempRepo);

      const taskFile = path.join(tempRoot, 'task.json');
      const contract = {
        repo: tempRepo,
        task: 'Fix the README formatting',
        allowedPaths: ['README.md'],
        verification: ['node -e "console.log(\'all green\')\"'], // successful verification command
        riskLevel: 'low',
        edits: [{
          type: 'replace_text',
          path: 'README.md',
          find: 'Initial README content',
          replace: 'Modified README content'
        }]
      };
      await fs.writeFile(taskFile, JSON.stringify(contract, null, 2), 'utf8');

      const confirmationService = ConfirmationService.getInstance();
      vi.spyOn(confirmationService, 'requestConfirmation').mockResolvedValue({
        confirmed: true
      });

      const report = await runAgenticCodingCell({
        taskFile,
        applyEdits: true,
        runVerification: true,
        runId: 'success-test'
      });

      expect(report.status).toBe('verified');

      // Check if audit logs show allow
      const logs = auditLogger.getEntriesByAction('self_improvement');
      const allowLog = logs.find(log => log.decision === 'allow');
      expect(allowLog).toBeDefined();
      expect(allowLog?.details).toContain('Self-improvement verified successfully');

      // Check if active branch is the sandbox branch
      const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tempRepo });
      expect(branchOut.trim()).toBe('tmp-self-improve-success-test');

      // Check if README.md has the modified content
      const readmeContent = await fs.readFile(path.join(tempRepo, 'README.md'), 'utf8');
      expect(readmeContent).toContain('Modified README content');
    });
  });
});
