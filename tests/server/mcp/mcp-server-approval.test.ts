import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfirmationService } from '../../../src/utils/confirmation-service.js';
import { createMcpApprovalBridge } from '../../../src/server/mcp/approval-elicitation.js';
import { TextEditorTool } from '../../../src/tools/text-editor.js';

describe('MCP Server End-to-End Tool Confirmation Flow', () => {
  let tmpDir: string;
  let testFile: string;
  let confirmationService: ConfirmationService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mcp-test-'));
    testFile = path.join(tmpDir, 'sample.txt');
    fs.writeFileSync(testFile, 'line 1\noriginal text\nline 3\n', 'utf8');

    confirmationService = ConfirmationService.getInstance();
    confirmationService.resetSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    confirmationService.setMcpApprovalBridge(null);
    confirmationService.resetSession();
    vi.useRealTimers();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('executes text editor replacement when simulated MCP client accepts', async () => {
    const mockServer = {
      server: {
        getClientCapabilities: () => ({ elicitation: { form: {} } }),
        elicitInput: vi.fn().mockImplementation(async (params) => {
          expect(params.mode).toBe('form');
          expect(params.message).toContain('sample.txt');
          return { action: 'accept' };
        }),
      },
    };

    const bridge = createMcpApprovalBridge(mockServer, { cwd: tmpDir });
    confirmationService.setMcpApprovalBridge(bridge);

    const editor = new TextEditorTool();
    editor.setBaseDirectory(tmpDir);

    const result = await editor.strReplace(testFile, 'original text', 'updated text');

    expect(result.success).toBe(true);
    expect(mockServer.server.elicitInput).toHaveBeenCalled();

    const fileContent = fs.readFileSync(testFile, 'utf8');
    expect(fileContent).toContain('updated text');
  });

  it('refuses text editor replacement when simulated MCP client rejects', async () => {
    const mockServer = {
      server: {
        getClientCapabilities: () => ({ elicitation: { form: {} } }),
        elicitInput: vi.fn().mockResolvedValue({ action: 'decline' }),
      },
    };

    const bridge = createMcpApprovalBridge(mockServer, { cwd: tmpDir });
    confirmationService.setMcpApprovalBridge(bridge);

    const editor = new TextEditorTool();
    editor.setBaseDirectory(tmpDir);

    const result = await editor.strReplace(testFile, 'original text', 'updated text');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Declined by client');

    const fileContent = fs.readFileSync(testFile, 'utf8');
    expect(fileContent).toContain('original text'); // Unchanged
  });

  it('refuses text editor replacement when simulated MCP client times out after 60s', async () => {
    let elicitStarted!: () => void;
    const elicitStartedPromise = new Promise<void>((r) => {
      elicitStarted = r;
    });
    const pendingPromise = new Promise<never>(() => {});

    const mockServer = {
      server: {
        getClientCapabilities: () => ({ elicitation: { form: {} } }),
        elicitInput: vi.fn().mockImplementation(() => {
          elicitStarted();
          return pendingPromise;
        }),
      },
    };

    const bridge = createMcpApprovalBridge(mockServer, { timeoutMs: 60000, cwd: tmpDir });
    confirmationService.setMcpApprovalBridge(bridge);

    const editor = new TextEditorTool();
    editor.setBaseDirectory(tmpDir);

    const replacePromise = editor.strReplace(testFile, 'original text', 'updated text');

    // Wait until elicitation has actually started before advancing fake timers
    await elicitStartedPromise;
    await vi.advanceTimersByTimeAsync(60000);

    const result = await replacePromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out after 60s');

    const fileContent = fs.readFileSync(testFile, 'utf8');
    expect(fileContent).toContain('original text'); // Unchanged
  });

  it('refuses when simulated MCP client lacks elicitation capabilities', async () => {
    const mockServer = {
      server: {
        getClientCapabilities: () => ({}), // no elicitation capability
        elicitInput: vi.fn(),
      },
    };

    const bridge = createMcpApprovalBridge(mockServer, { cwd: tmpDir });
    confirmationService.setMcpApprovalBridge(bridge);

    const editor = new TextEditorTool();
    editor.setBaseDirectory(tmpDir);

    const result = await editor.strReplace(testFile, 'original text', 'updated text');

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not support elicitation');
    expect(mockServer.server.elicitInput).not.toHaveBeenCalled();
  });

  it('remains byte-identical outside of MCP mode', async () => {
    // With no MCP bridge set, non-TTY calls fail closed asking for interactive terminal
    const editor = new TextEditorTool();
    editor.setBaseDirectory(tmpDir);

    const result = await editor.strReplace(testFile, 'original text', 'updated text');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Approval requires an interactive terminal');
  });
});
