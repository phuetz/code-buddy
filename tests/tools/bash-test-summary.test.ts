import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as policy from '../../src/tools/bash/execution-policy.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { evaluateHeadlessTaskOutcome } from '../../src/cli/headless-task-outcome.js';

afterEach(() => { vi.restoreAllMocks(); ConfirmationService.getInstance().setSessionFlag('bashCommands', false); });
it.each(['direct', 'sandbox'] as const)('preserves failing assertions after real npm exit zero (%s formatter)', async route => {
  const root = mkdtempSync(join(tmpdir(), 'bash-summary-'));
  const tool = new BashTool();
  ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
  // Isolate policy selection, not process execution or the test parser.
  vi.spyOn(policy, 'evaluateShellExecution').mockResolvedValue({ action: route === 'direct' ? 'allow' : 'sandbox', reason: 'fixture', executableIdentities: [], parsedSegments: [] });
  vi.spyOn(policy, 'executableIdentitiesStillMatch').mockReturnValue(true);
  vi.spyOn(policy, 'executeInWorkspaceSandbox').mockImplementation(async () => {
    const child = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8' });
    expect(child.status).toBe(0);
    return { available: true, result: { stdout: child.stdout, stderr: child.stderr, exitCode: child.status!, duration: 1, timedOut: false, backend: 'docker', sandboxed: true } };
  });
  try {
    for (const summary of ['Tests: 2 failed, 1 passed, 3 total', 'Tests 1 passed | 2 failed', 'Tests 2 failed (2)', '2 failed in 0.12s', 'Tests: 3 passed, 3 total']) {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node check.cjs' } }));
      writeFileSync(join(root, 'check.cjs'), `console.log(${JSON.stringify(summary)});\n`);
      const result = await tool.execute('npm test', 15000, root);
      expect(result.output, JSON.stringify(result)).toBeDefined();
      const parsed = JSON.parse(result.output!);
      const failed = summary.includes('failed');
      expect(parsed.summary.failed).toBe(failed ? 2 : 0);
      expect(result.success).toBe(!failed);
      expect(parsed.rawOutput).toContain(summary);
      const outcome = evaluateHeadlessTaskOutcome('Run the tests and fix any failures', [
        { type: 'tool_result', content: result.output!, toolCall: { id: 't', function: { name: 'bash', arguments: '{"command":"npm test"}' } }, toolResult: result },
        { type: 'assistant', content: 'The suite is green.' },
      ]);
      expect(outcome.exitCode === 0).toBe(!failed);
    }
  } finally { tool.dispose(); rmSync(root, { recursive: true, force: true }); }
}, 30000);
