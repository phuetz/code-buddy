import { BashTool } from '../../src/tools/bash';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

describe('BashTool - Streaming Execution', () => {
  let bash: BashTool;

  beforeEach(() => {
    bash = new BashTool();
    // Auto-approve bash commands for tests
    const service = ConfirmationService.getInstance();
    service.setSessionFlag('bashCommands', true);
  });

  afterEach(() => {
    bash.dispose();
    const service = ConfirmationService.getInstance();
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

  it('should handle timeout', async () => {
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
});
