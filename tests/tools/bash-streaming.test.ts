import { vi } from 'vitest';
import * as executionPolicy from '../../src/tools/bash/execution-policy.js';
import { BashTool } from '../../src/tools/bash';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import {
  approveSandboxUnavailableEscalations,
  clearSandboxEscalationBridge,
} from '../helpers/sandbox-escalation-bridge.js';

describe('BashTool - Streaming Execution', () => {
  let bash: BashTool;

  beforeEach(() => {
    delete process.env.CODEBUDDY_NATIVE_SANDBOX;
    bash = new BashTool();
    // Auto-approve bash commands for tests
    const service = ConfirmationService.getInstance();
    service.setSessionFlag('bashCommands', true);
    // Hosts without a sandbox backend (Windows CI) escalate every allowed
    // command to an exact grant: stand in for the approving human.
    approveSandboxUnavailableEscalations(service);
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_NATIVE_SANDBOX;
    bash.dispose();
    vi.restoreAllMocks();
    const service = ConfirmationService.getInstance();
    clearSandboxEscalationBridge(service);
    service.setSessionFlag('bashCommands', false);
  });

  it('should stream output line by line', async () => {
    const chunks: string[] = [];
    const gen = bash.executeStreaming('echo "line1"; echo "line2"; echo "line3"', 10000);

    let result = await gen.next();
    while (!result.done) {
      chunks.push(result.value);
      result = await gen.next();
    }

    const fullOutput = chunks.join('');
    expect(fullOutput).toContain('line1');
    expect(fullOutput).toContain('line2');
    expect(fullOutput).toContain('line3');
    expect(result.value.success).toBe(true);
  });

  it('should return error result for blocked commands', async () => {
    const gen = bash.executeStreaming('rm -rf /', 10000);
    const result = await gen.next();
    // Should immediately return done with error
    expect(result.done).toBe(true);
    expect((result.value as { success: boolean }).success).toBe(false);
  });

  it('should return error for failed commands', async () => {
    const chunks: string[] = [];
    const gen = bash.executeStreaming('ls /nonexistent-dir-12345', 10000);

    let result = await gen.next();
    while (!result.done) {
      chunks.push(result.value);
      result = await gen.next();
    }

    expect(result.value.success).toBe(false);
  });

  // sleep is not available on Windows
  (process.platform === 'win32' ? it.skip : it)('should handle timeout', async () => {
    const gen = bash.executeStreaming('sleep 60', 500);
    const chunks: string[] = [];

    let result = await gen.next();
    while (!result.done) {
      chunks.push(result.value);
      result = await gen.next();
    }

    expect(result.value.success).toBe(false);
    expect(result.value.error).toContain('timed out');
  }, 10000);

  (process.platform === 'win32' ? it.skip : it)('kills a long-running process when aborted', async () => {
    // Exercise the direct streaming spawn on every host, including hosts
    // whose workspace sandbox normally buffers stdout until completion.
    vi.spyOn(executionPolicy, 'executeInWorkspaceSandbox').mockResolvedValue({
      available: false, reason: 'Workspace sandbox unavailable (direct streaming test)',
    });
    const controller = new AbortController();
    const gen = bash.executeStreaming(
      'sleep 60 & echo ABORT_READY; wait',
      30000,
      undefined,
      controller.signal,
    );
    // Wait for the child to start, then consume until the executor's close
    // event completes the generator. No scheduler-dependent 50 ms race.
    let result = await gen.next();
    let output = '';
    while (!result.done && !output.includes('ABORT_READY')) {
      output += result.value;
      if (!output.includes('ABORT_READY')) result = await gen.next();
    }
    expect(output).toContain('ABORT_READY');
    controller.abort();
    while (!result.done) result = await gen.next();

    expect(result.value.success).toBe(false);
    expect(result.value.error).toContain('aborted by user');
  }, 15000);
});
