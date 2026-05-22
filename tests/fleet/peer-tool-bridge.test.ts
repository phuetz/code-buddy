import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  wirePeerToolBridge,
  unwirePeerToolBridge,
  _unwireForTests,
} from '../../src/fleet/peer-tool-bridge.js';
import {
  dispatchPeerRequest,
  _resetPeerRpcForTests,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getToolRegistry } from '../../src/tools/registry.js';

describe('PeerToolBridge', () => {
  let tempWorkspace: string;
  let defaultCtx: PeerMethodContext;

  beforeEach(async () => {
    // Set up temp workspace directory
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-tool-bridge-test-'));
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = tempWorkspace;
    process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file,list_directory,search';

    // Mock tool registry isFleetSafe
    vi.spyOn(getToolRegistry(), 'isFleetSafe').mockReturnValue(true);

    // Mock PolicyEngine evaluate to allow all peer invocations by default in tests
    vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({
      decision: 'allow',
      reason: 'Allowed',
    });

    // Context for websocket peer-rpc calls
    defaultCtx = {
      connectionId: 'test-peer-123',
      scopes: ['*'],
      traceId: 'test-trace',
      depth: 0,
    };

    _resetPeerRpcForTests();
    wirePeerToolBridge();
  });

  afterEach(async () => {
    unwirePeerToolBridge();
    _unwireForTests();
    _resetPeerRpcForTests();
    vi.restoreAllMocks();
    delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    delete process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST;
    
    // Clean up temp directory
    await fs.rm(tempWorkspace, { recursive: true, force: true });
  });

  it('fails closed when workspace root is not configured', async () => {
    delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    await fs.writeFile(path.join(tempWorkspace, 'test.txt'), 'hello');

    const frame = {
      id: 'req1',
      method: 'peer.tool.invoke',
      params: {
        tool: 'view_file',
        args: { file_path: 'test.txt' },
      },
    };

    const res = await dispatchPeerRequest(frame, defaultCtx);
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('PEER_WORKSPACE_NOT_CONFIGURED');
  });

  it('rejects paths outside the workspace root', async () => {
    const outsideFile = path.resolve(tempWorkspace, '../outside-test-file.txt');
    await fs.writeFile(outsideFile, 'sensitive data').catch(() => {});

    const frame = {
      id: 'req2',
      method: 'peer.tool.invoke',
      params: {
        tool: 'view_file',
        args: { file_path: '../outside-test-file.txt' },
      },
    };

    try {
      const res = await dispatchPeerRequest(frame, defaultCtx);
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('PATH_OUTSIDE_PEER_WORKSPACE');
    } finally {
      await fs.unlink(outsideFile).catch(() => {});
    }
  });

  it('rejects tools not in the allowlist', async () => {
    const frame = {
      id: 'req3',
      method: 'peer.tool.invoke',
      params: {
        tool: 'delete_file',
        args: { file_path: 'test.txt' },
      },
    };

    const res = await dispatchPeerRequest(frame, defaultCtx);
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('TOOL_NOT_ALLOWED_FOR_PEER_INVOKE');
  });

  describe('scope validation', () => {
    it('allows invocation if scopes is undefined (defaults to *)', async () => {
      await fs.writeFile(path.join(tempWorkspace, 'test.txt'), 'hello');
      const ctxWithUndefinedScopes = { ...defaultCtx, scopes: undefined as any };

      const frame = {
        id: 'req-scope-1',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'test.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, ctxWithUndefinedScopes);
      expect(res.ok).toBe(true);
      expect((res.payload as any).output).toBe('hello');
    });

    it('rejects invocation if scopes is empty list []', async () => {
      await fs.writeFile(path.join(tempWorkspace, 'test.txt'), 'hello');
      const ctxWithEmptyScopes = { ...defaultCtx, scopes: [] };

      const frame = {
        id: 'req-scope-2',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'test.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, ctxWithEmptyScopes);
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('PEER_SCOPE_DENIED');
    });

    it('rejects invocation if scopes does not contain matching tool permission', async () => {
      await fs.writeFile(path.join(tempWorkspace, 'test.txt'), 'hello');
      const ctxWithOtherScopes = { ...defaultCtx, scopes: ['tool:list_directory'] };

      const frame = {
        id: 'req-scope-3',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'test.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, ctxWithOtherScopes);
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('PEER_SCOPE_DENIED');
    });

    it('allows invocation if scopes has tool:<name>', async () => {
      await fs.writeFile(path.join(tempWorkspace, 'test.txt'), 'hello');
      const ctxWithToolScope = { ...defaultCtx, scopes: ['tool:view_file'] };

      const frame = {
        id: 'req-scope-4',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'test.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, ctxWithToolScope);
      expect(res.ok).toBe(true);
      expect((res.payload as any).output).toBe('hello');
    });

    it('allows invocation if scopes has tool:*', async () => {
      await fs.writeFile(path.join(tempWorkspace, 'test.txt'), 'hello');
      const ctxWithWildcardScope = { ...defaultCtx, scopes: ['tool:*'] };

      const frame = {
        id: 'req-scope-5',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'test.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, ctxWithWildcardScope);
      expect(res.ok).toBe(true);
    });
  });

  describe('size/entry caps and ANSI sanitization', () => {
    it('truncates file content to 256 KB limit', async () => {
      // 300 KB file (307200 characters)
      const data = 'A'.repeat(300 * 1024);
      const filePath = path.join(tempWorkspace, 'large.txt');
      await fs.writeFile(filePath, data);

      const frame = {
        id: 'req-trunc-1',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'large.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, defaultCtx);
      expect(res.ok).toBe(true);
      const payload = res.payload as any;
      expect(payload.truncated).toBe(true);
      expect(payload.output.length).toBe(256 * 1024);
    });

    it('truncates directory entries to 256 entries', async () => {
      const subDir = path.join(tempWorkspace, 'many-files');
      await fs.mkdir(subDir);
      // Create 300 files
      for (let i = 0; i < 300; i++) {
        await fs.writeFile(path.join(subDir, `file_${String(i).padStart(3, '0')}.txt`), 'content');
      }

      const frame = {
        id: 'req-trunc-2',
        method: 'peer.tool.invoke',
        params: {
          tool: 'list_directory',
          args: { path: 'many-files' },
        },
      };

      const res = await dispatchPeerRequest(frame, defaultCtx);
      expect(res.ok).toBe(true);
      const payload = res.payload as any;
      expect(payload.truncated).toBe(true);
      const lines = payload.output.split('\n');
      // 256 list entries + 1 truncated footer message = 257 lines
      expect(lines.length).toBe(257);
      expect(lines[lines.length - 1]).toContain('truncated after 256 entries');
    });

    it('strips ANSI escape codes from output', async () => {
      const ansiText = '\u001b[31mRed Alert\u001b[0m\n\u001b[1mBold text\u001b[22m';
      const filePath = path.join(tempWorkspace, 'ansi.txt');
      await fs.writeFile(filePath, ansiText);

      const frame = {
        id: 'req-ansi-1',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'ansi.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, defaultCtx);
      expect(res.ok).toBe(true);
      const payload = res.payload as any;
      expect(payload.output).toBe('Red Alert\nBold text');
    });
  });

  describe('PolicyEngine integration', () => {
    it('instantly denies when PolicyEngine decides deny', async () => {
      vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({
        decision: 'deny',
        reason: 'Policy Engine block',
      });

      const frame = {
        id: 'req-policy-deny',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'doesnt_matter.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, defaultCtx);
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('Policy Engine block');
    });

    it('prompts confirmation when PolicyEngine decides needs_approval and succeeds if approved', async () => {
      await fs.writeFile(path.join(tempWorkspace, 'test.txt'), 'approved_data');
      
      vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({
        decision: 'needs_approval',
        reason: 'Approval required',
      });

      const confirmSpy = vi
        .spyOn(ConfirmationService.getInstance(), 'requestConfirmation')
        .mockResolvedValue({ confirmed: true });

      const frame = {
        id: 'req-policy-confirm-ok',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'test.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, defaultCtx);
      expect(res.ok).toBe(true);
      expect((res.payload as any).output).toBe('approved_data');
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });

    it('prompts confirmation when PolicyEngine decides needs_approval and fails if rejected', async () => {
      vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({
        decision: 'needs_approval',
        reason: 'Approval required',
      });

      const confirmSpy = vi
        .spyOn(ConfirmationService.getInstance(), 'requestConfirmation')
        .mockResolvedValue({ confirmed: false });

      const frame = {
        id: 'req-policy-confirm-fail',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'test.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, defaultCtx);
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('Human approval was rejected');
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });

    it('bypasses confirmation when PolicyEngine decides allow', async () => {
      await fs.writeFile(path.join(tempWorkspace, 'test.txt'), 'direct_data');

      vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({
        decision: 'allow',
        reason: 'Allowed',
      });

      const confirmSpy = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation');

      const frame = {
        id: 'req-policy-allow',
        method: 'peer.tool.invoke',
        params: {
          tool: 'view_file',
          args: { file_path: 'test.txt' },
        },
      };

      const res = await dispatchPeerRequest(frame, defaultCtx);
      expect(res.ok).toBe(true);
      expect((res.payload as any).output).toBe('direct_data');
      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });
});
