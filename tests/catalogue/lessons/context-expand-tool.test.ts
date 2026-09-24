import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ContextExpandTool } from '../../../src/tools/context-expand-tool.js';
import { SegmentArchive } from '../../../src/context/segment-archive.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

describe('Context Expand Tool', () => {
  let tempDir: string;
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-context-expand-test-'));
    originalEnv.HOME = process.env.HOME;
    originalEnv.CODEBUDDY_HOME = process.env.CODEBUDDY_HOME;
    originalEnv.CODEBUDDY_CONTEXT_ZOOM = process.env.CODEBUDDY_CONTEXT_ZOOM;
    
    process.env.CODEBUDDY_HOME = tempDir;
    process.env.CODEBUDDY_CONTEXT_ZOOM = 'true';
  });

  afterEach(() => {
    for (const key of ['HOME', 'CODEBUDDY_HOME', 'CODEBUDDY_CONTEXT_ZOOM']) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('context_expand successfully retrieves a compressed segment', async () => {
    const sessionId = 'test-session';
    
    // Create some messages to archive
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'What is the full content?' },
      { role: 'assistant', content: 'Here is some very long content that was compacted.' }
    ];
    
    process.env.HOME = tempDir;
    const archive = new SegmentArchive();
    const segmentId = archive.archive(sessionId, messages, 'Summary preview');
    expect(segmentId).toBeTruthy();

    const tool = new ContextExpandTool();
    
    const result = await tool.execute(
      { segment_id: segmentId! },
      { sessionId, cwd: tempDir } as any
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Here is some very long content that was compacted.');
    
    // Verify it fails properly on invalid segment
    const failResult = await tool.execute(
      { segment_id: 'non-existent-segment' },
      { sessionId, cwd: tempDir } as any
    );
    expect(failResult.success).toBe(false);
    expect(failResult.error).toContain('not found');
  });

  it('context_expand fails if CODEBUDDY_CONTEXT_ZOOM is false and no explicit archive is given', async () => {
    process.env.CODEBUDDY_CONTEXT_ZOOM = 'false';
    const tool = new ContextExpandTool(); // No explicit archive
    
    const result = await tool.execute(
      { segment_id: 'some-id' },
      { sessionId: 'test-session', cwd: tempDir } as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('context_expand is disabled');
  });
});
