import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPatchApprovalRequest,
  buildExecApprovalRequest,
  parseElicitationDecision,
  sendElicitationApprovalRequest,
  createMcpApprovalBridge,
} from '../../../src/server/mcp/approval-elicitation.js';
import { ConfirmationService } from '../../../src/utils/confirmation-service.js';

describe('MCP Approval Elicitation Payload Builder', () => {
  const testCwd = '/home/user/project';

  describe('buildPatchApprovalRequest', () => {
    it('constructs an elicitation/create request with unified diff, relative paths, and form schema', () => {
      const request = buildPatchApprovalRequest({
        files: [
          {
            path: '/home/user/project/src/index.ts',
            before: 'console.log("hello");\n',
            after: 'console.log("hello world");\n',
          },
        ],
        cwd: testCwd,
        reason: 'Fix greeting output',
      });

      expect(request.method).toBe('elicitation/create');
      expect(request.params.mode).toBe('form');
      expect(request.params.message).toContain('Fix greeting output');
      expect(request.params.message).toContain('src/index.ts');
      expect(request.params.requestedSchema.type).toBe('object');
      expect(request.params.requestedSchema.properties).toHaveProperty('decision');
      expect(request.params.codex_elicitation).toBe('patch-approval');
      expect(request.params.approvalKind).toBe('patch-approval');

      // Relative path verified
      expect(request.params.files).toHaveLength(1);
      expect(request.params.files?.[0]?.path).toBe('src/index.ts');
      expect(request.params.files?.[0]?.diff).toContain('--- a/src/index.ts');
      expect(request.params.files?.[0]?.diff).toContain('+++ b/src/index.ts');
      expect(request.params.files?.[0]?.diff).toContain('-console.log("hello");');
      expect(request.params.files?.[0]?.diff).toContain('+console.log("hello world");');
    });

    it('handles file creations and deletions cleanly', () => {
      const request = buildPatchApprovalRequest({
        files: [
          {
            path: 'new-file.txt',
            before: null,
            after: 'brand new content\n',
          },
          {
            path: 'old-file.txt',
            before: 'obsolete content\n',
            after: null,
          },
        ],
        cwd: testCwd,
      });

      expect(request.params.files).toHaveLength(2);
      // New file
      expect(request.params.files?.[0]?.path).toBe('new-file.txt');
      expect(request.params.files?.[0]?.diff).toContain('Created new-file.txt');
      expect(request.params.files?.[0]?.diff).toContain('+brand new content');

      // Deleted file
      expect(request.params.files?.[1]?.path).toBe('old-file.txt');
      expect(request.params.files?.[1]?.diff).toContain('Deleted old-file.txt');
      expect(request.params.files?.[1]?.diff).toContain('-obsolete content');
    });

    it('bounds the maximum diff size when changes are very large', () => {
      const hugeContentBefore = 'A\n'.repeat(5000);
      const hugeContentAfter = 'B\n'.repeat(5000);

      const request = buildPatchApprovalRequest({
        files: [
          {
            path: 'big-file.txt',
            before: hugeContentBefore,
            after: hugeContentAfter,
          },
        ],
        cwd: testCwd,
        maxDiffBytes: 1024, // restrict to 1KB for test
      });

      const diff = request.params.diff || '';
      expect(diff.length).toBeLessThanOrEqual(1024 + 100); // within bounded buffer + marker
      expect(diff).toContain('[diff truncated]');
    });
  });

  describe('buildExecApprovalRequest', () => {
    it('constructs an elicitation/create request for command execution with risk and cwd', () => {
      const request = buildExecApprovalRequest({
        command: ['npm', 'test', '--', '--watch=false'],
        cwd: testCwd,
        riskLevel: 'high',
        reason: 'Run unit test suite',
      });

      expect(request.method).toBe('elicitation/create');
      expect(request.params.mode).toBe('form');
      expect(request.params.message).toContain('Run unit test suite');
      expect(request.params.message).toContain('`npm test -- --watch=false`');
      expect(request.params.message).toContain('`/home/user/project`');
      expect(request.params.message).toContain('Risk: high');
      expect(request.params.codex_elicitation).toBe('exec-approval');
      expect(request.params.approvalKind).toBe('exec-approval');
      expect(request.params.command).toEqual(['npm', 'test', '--', '--watch=false']);
      expect(request.params.cwd).toBe(testCwd);
      expect(request.params.riskLevel).toBe('high');
    });

    it('accepts string commands and defaults', () => {
      const request = buildExecApprovalRequest({
        command: 'cargo build --release',
        cwd: '/workspace',
      });

      expect(request.params.message).toContain('`cargo build --release`');
      expect(request.params.command).toBe('cargo build --release');
      expect(request.params.riskLevel).toBe('medium');
    });
  });

  describe('parseElicitationDecision', () => {
    it('parses standard MCP accept action', () => {
      expect(parseElicitationDecision({ action: 'accept' })).toEqual({ approved: true });
      expect(parseElicitationDecision({ action: 'accept', content: { decision: 'accept' } })).toEqual({ approved: true });
    });

    it('parses decline and cancel actions', () => {
      expect(parseElicitationDecision({ action: 'decline' })).toEqual({ approved: false, reason: 'Declined by client' });
      expect(parseElicitationDecision({ action: 'cancel' })).toEqual({ approved: false, reason: 'Cancelled by client' });
    });

    it('parses structured decision field', () => {
      expect(parseElicitationDecision({ decision: 'approved' })).toEqual({ approved: true });
      expect(parseElicitationDecision({ decision: { type: 'approved' } })).toEqual({ approved: true });
      expect(parseElicitationDecision({ decision: 'denied', reason: 'User rejected' })).toEqual({
        approved: false,
        reason: 'User rejected',
      });
    });

    it('fails closed on unknown or invalid results', () => {
      expect(parseElicitationDecision(null)).toEqual({ approved: false, reason: 'Invalid elicitation response' });
      expect(parseElicitationDecision({})).toEqual({ approved: false, reason: 'Unknown decision format' });
      expect(parseElicitationDecision({ action: 'unexpected' })).toEqual({ approved: false, reason: 'Unknown decision format' });
    });
  });

  describe('sendElicitationApprovalRequest transport', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves confirmed: true when client accepts', async () => {
      const mockServer = {
        server: {
          getClientCapabilities: () => ({ elicitation: { form: {} } }),
          elicitInput: vi.fn().mockResolvedValue({ action: 'accept' }),
        },
      };

      const request = buildExecApprovalRequest({ command: 'ls -la', cwd: '/test' });
      const resultPromise = sendElicitationApprovalRequest(mockServer, request);
      const result = await resultPromise;

      expect(result.confirmed).toBe(true);
      expect(mockServer.server.elicitInput).toHaveBeenCalledWith(request.params);
    });

    it('resolves confirmed: false when client declines', async () => {
      const mockServer = {
        server: {
          getClientCapabilities: () => ({ elicitation: { form: {} } }),
          elicitInput: vi.fn().mockResolvedValue({ action: 'decline' }),
        },
      };

      const request = buildExecApprovalRequest({ command: 'rm -rf ./tmp', cwd: '/test' });
      const result = await sendElicitationApprovalRequest(mockServer, request);

      expect(result.confirmed).toBe(false);
      expect(result.feedback).toBe('Declined by client');
    });

    it('fails closed with confirmed: false if client has no elicitation capability', async () => {
      const mockServer = {
        server: {
          getClientCapabilities: () => ({}), // no elicitation
          elicitInput: vi.fn(),
        },
      };

      const request = buildExecApprovalRequest({ command: 'ls', cwd: '/test' });
      const result = await sendElicitationApprovalRequest(mockServer, request);

      expect(result.confirmed).toBe(false);
      expect(result.feedback).toContain('does not support elicitation');
      expect(mockServer.server.elicitInput).not.toHaveBeenCalled();
    });

    it('fails closed after 60s timeout when client does not respond', async () => {
      const pendingPromise = new Promise<never>(() => {});

      const mockServer = {
        server: {
          getClientCapabilities: () => ({ elicitation: { form: {} } }),
          elicitInput: vi.fn().mockReturnValue(pendingPromise),
        },
      };

      const request = buildExecApprovalRequest({ command: 'npm install', cwd: '/test' });
      const approvalPromise = sendElicitationApprovalRequest(mockServer, request, 60000);

      // Fast-forward 60 seconds
      await vi.advanceTimersByTimeAsync(60000);

      const result = await approvalPromise;
      expect(result.confirmed).toBe(false);
      expect(result.feedback).toContain('timed out after 60s');
    });
  });
});

describe('ConfirmationService MCP Routing Integration', () => {
  let confirmationService: ConfirmationService;

  beforeEach(() => {
    confirmationService = ConfirmationService.getInstance();
    confirmationService.resetSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    confirmationService.setMcpApprovalBridge(null);
    confirmationService.resetSession();
    vi.useRealTimers();
  });

  it('routes ConfirmationService requests through MCP elicitation bridge when configured', async () => {
    const mockServer = {
      server: {
        getClientCapabilities: () => ({ elicitation: { form: {} } }),
        elicitInput: vi.fn().mockResolvedValue({ action: 'accept' }),
      },
    };

    const bridge = createMcpApprovalBridge(mockServer);
    confirmationService.setMcpApprovalBridge(bridge);

    const result = await confirmationService.requestConfirmation(
      {
        operation: 'Edit file',
        filename: '/workspace/src/app.ts',
        diffPreview: '@@ -1 +1 @@\n-old\n+new',
      },
      'file',
    );

    expect(result.confirmed).toBe(true);
    expect(mockServer.server.elicitInput).toHaveBeenCalled();
  });

  it('blocks operation when client rejects via MCP elicitation bridge', async () => {
    const mockServer = {
      server: {
        getClientCapabilities: () => ({ elicitation: { form: {} } }),
        elicitInput: vi.fn().mockResolvedValue({ action: 'decline' }),
      },
    };

    const bridge = createMcpApprovalBridge(mockServer);
    confirmationService.setMcpApprovalBridge(bridge);

    const result = await confirmationService.requestConfirmation(
      {
        operation: 'Run dangerous command',
        filename: 'rm -rf /tmp/data',
        riskLevel: 'high',
      },
      'bash',
    );

    expect(result.confirmed).toBe(false);
    expect(result.feedback).toBe('Declined by client');
  });

  it('blocks operation after 60s timeout without response (fail-closed)', async () => {
    const pendingPromise = new Promise<never>(() => {});

    const mockServer = {
      server: {
        getClientCapabilities: () => ({ elicitation: { form: {} } }),
        elicitInput: vi.fn().mockReturnValue(pendingPromise),
      },
    };

    const bridge = createMcpApprovalBridge(mockServer, { timeoutMs: 60000 });
    confirmationService.setMcpApprovalBridge(bridge);

    const confirmationPromise = confirmationService.requestConfirmation(
      {
        operation: 'Bash execution',
        filename: 'build.sh',
      },
      'bash',
    );

    await vi.advanceTimersByTimeAsync(60000);

    const result = await confirmationPromise;
    expect(result.confirmed).toBe(false);
    expect(result.feedback).toContain('timed out after 60s');
  });

  it('preserves byte-identical default behavior when no MCP bridge is active', async () => {
    // Non-TTY environment without MCP bridge or remote approval -> fails closed
    const result = await confirmationService.requestConfirmation(
      {
        operation: 'Edit file',
        filename: 'somefile.txt',
      },
      'file',
    );

    expect(result.confirmed).toBe(false);
    expect(result.feedback).toContain('Approval requires an interactive terminal');
  });
});
