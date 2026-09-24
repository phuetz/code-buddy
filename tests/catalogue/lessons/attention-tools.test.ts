import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { RestoreContextTool } from '../../../src/tools/registry/attention-tools.js';

describe('Restore Context Tool', () => {
  let tempDir: string;
  let originalCodebuddyHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-attention-test-'));
    originalCodebuddyHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = tempDir;
  });

  afterEach(() => {
    if (originalCodebuddyHome !== undefined) {
      process.env.CODEBUDDY_HOME = originalCodebuddyHome;
    } else {
      delete process.env.CODEBUDDY_HOME;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('restore_context correctly retrieves stored content', async () => {
    const callId = 'test-call-123';
    const content = 'This is the restorable content';

    // Mock an active run store/compressor context by writing to it directly
    const { getRestorableCompressor } = await import('../../../src/context/restorable-compression.js');
    const compressor = getRestorableCompressor();
    const sessionId = 'test-session';
    
    // Write tool result that can be restored
    compressor.writeToolResult(callId, content, tempDir, sessionId);

    const tool = new RestoreContextTool();
    const res = await tool.execute(
      { identifier: callId },
      { cwd: tempDir, sessionId: sessionId } as any
    );

    expect(res.success).toBe(true);
    expect(res.output).toContain(content);
    expect(res.output).toContain(callId);

    // Verify it fails for unknown identifier
    const badRes = await tool.execute(
      { identifier: 'unknown-id' },
      { cwd: tempDir, sessionId: sessionId } as any
    );
    expect(badRes.success).toBe(false);
  });
});
