/**
 * peer_tool_invoke tool tests.
 *
 * Mocks the FleetRegistry singleton. Verifies parameter validation,
 * unknown peer, missing invokeTool, remote refusals, timeout mapping,
 * and the happy path with a fake listener.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executePeerToolInvoke,
  clampPeerToolInvokeTimeout,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
} from '../../src/tools/peer-tool-invoke-tool.js';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';

const ORIGINAL_ENV = process.env;

function makeStubListener(partial: Partial<FleetListenerPublicAPI>): FleetListenerPublicAPI {
  return {
    disconnect: async () => undefined,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request: partial.request ?? vi.fn(),
    invokeTool: partial.invokeTool,
    getLastSeen: () => ({ at: null, reason: null, ageMs: null }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    }),
    getEventHistory: () => [],
    ...partial,
  };
}

function registerPeer(id: string, listener: Partial<FleetListenerPublicAPI>): ActiveListenerEntry {
  const entry: ActiveListenerEntry = {
    id,
    url: `ws://example/${id}`,
    startedAt: new Date(),
    eventCount: 0,
    autoReconnect: false,
    maxAttempts: 5,
    listener: makeStubListener(listener),
  };
  getFleetRegistry().register(entry);
  return entry;
}

function remoteError(code: string, message: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = code;
  return err;
}

describe('peer_tool_invoke tool', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CODEBUDDY_PEER_ROLE;
    _resetFleetRegistryForTests();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('validation', () => {
    it('rejects missing peer and tool', async () => {
      registerPeer('B', { invokeTool: vi.fn() });
      let r = await executePeerToolInvoke({ peer: '', tool: 'view_file' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('"peer"');
      r = await executePeerToolInvoke({ peer: 'B', tool: '' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('"tool"');
    });

    it('rejects nested args without calling invokeTool', async () => {
      const invokeTool = vi.fn();
      registerPeer('B', { invokeTool });
      const r = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: { nested: { file_path: 'oracle.txt' } },
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('flat object');
      expect(invokeTool).not.toHaveBeenCalled();
    });

    it('rejects array args', async () => {
      const invokeTool = vi.fn();
      registerPeer('B', { invokeTool });
      const r = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: ['oracle.txt'] as unknown as Record<string, unknown>,
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('flat object');
      expect(invokeTool).not.toHaveBeenCalled();
    });

    it('does not resolve absolute paths on this host — forwards them as given', async () => {
      const invokeTool = vi.fn().mockResolvedValue({
        tool: 'view_file',
        output: 'denied-by-peer',
        durationMs: 3,
      });
      registerPeer('B', { invokeTool });
      const r = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: { file_path: '/etc/passwd' },
      });
      expect(r.success).toBe(true);
      expect(invokeTool).toHaveBeenCalledTimes(1);
      const [tool, args] = invokeTool.mock.calls[0];
      expect(tool).toBe('view_file');
      expect(args).toEqual({ file_path: '/etc/passwd' });
    });

    it('clamps timeoutMs to the documented max', () => {
      expect(clampPeerToolInvokeTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
      expect(clampPeerToolInvokeTimeout(0)).toBe(DEFAULT_TIMEOUT_MS);
      expect(clampPeerToolInvokeTimeout(-5)).toBe(DEFAULT_TIMEOUT_MS);
      expect(clampPeerToolInvokeTimeout(500_000)).toBe(MAX_TIMEOUT_MS);
      expect(clampPeerToolInvokeTimeout(8_000)).toBe(8_000);
    });

    it('rejects unknown tool names unless peer.describe advertises them', async () => {
      const invokeTool = vi.fn();
      const request = vi.fn().mockResolvedValue({ methods: ['peer.tool.invoke'] });
      registerPeer('B', { invokeTool, request });
      const r = await executePeerToolInvoke({
        peer: 'B',
        tool: 'bash',
        args: { command: 'echo x' },
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('bash');
      expect(r.error).toContain('not in the local read-only set');
      expect(invokeTool).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledWith('peer.describe', {}, expect.objectContaining({ timeoutMs: 3_000 }));
    });

    it('allows an extra tool advertised via peer.describe', async () => {
      const invokeTool = vi.fn().mockResolvedValue({
        tool: 'workspace_read',
        output: 'extra-ok',
        durationMs: 4,
      });
      const request = vi.fn().mockResolvedValue({ peerTools: ['workspace_read'] });
      registerPeer('B', { invokeTool, request });
      const r = await executePeerToolInvoke({
        peer: 'B',
        tool: 'workspace_read',
        args: { path: 'notes.md' },
      });
      expect(r.success).toBe(true);
      expect(r.output).toContain('extra-ok');
      expect(invokeTool).toHaveBeenCalledWith(
        'workspace_read',
        { path: 'notes.md' },
        { timeoutMs: DEFAULT_TIMEOUT_MS },
      );
    });
  });

  describe('guards', () => {
    it('refuses when CODEBUDDY_PEER_ROLE=leaf', async () => {
      process.env.CODEBUDDY_PEER_ROLE = 'leaf';
      const result = await executePeerToolInvoke({ peer: 'B', tool: 'view_file' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('leaf peer');
    });

    it('errors when no peers connected', async () => {
      const result = await executePeerToolInvoke({ peer: 'B', tool: 'view_file' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No fleet peers connected');
    });

    it('errors when peer name is unknown', async () => {
      registerPeer('alpha', { invokeTool: vi.fn() });
      const result = await executePeerToolInvoke({ peer: 'gamma', tool: 'view_file' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('"gamma" not found');
      expect(result.error).toContain('alpha');
    });

    it('errors when listener has no invokeTool', async () => {
      registerPeer('B', { request: vi.fn() });
      const result = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: { file_path: 'oracle.txt' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('no invokeTool');
    });
  });

  describe('happy path', () => {
    it('calls listener.invokeTool and returns output plus data', async () => {
      const invokeTool = vi.fn().mockResolvedValue({
        tool: 'view_file',
        output: 'ORACLE-abc',
        durationMs: 12,
        truncated: false,
      });
      registerPeer('B', { invokeTool });

      const result = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: { file_path: 'oracle.txt' },
        timeoutMs: 20_000,
      });

      expect(result.success).toBe(true);
      expect(invokeTool).toHaveBeenCalledTimes(1);
      expect(invokeTool.mock.calls[0][0]).toBe('view_file');
      expect(invokeTool.mock.calls[0][1]).toEqual({ file_path: 'oracle.txt' });
      expect(invokeTool.mock.calls[0][2]).toEqual({ timeoutMs: 20_000 });
      expect(result.output).toContain('[peer: B]');
      expect(result.output).toContain('[tool: view_file]');
      expect(result.output).toContain('ORACLE-abc');
      const data = result.data as { peer: string; tool: string; output: string };
      expect(data.peer).toBe('B');
      expect(data.tool).toBe('view_file');
      expect(data.output).toBe('ORACLE-abc');
    });
  });

  describe('remote refusals and timeout', () => {
    it('propagates allowlist refusal as failure', async () => {
      const invokeTool = vi.fn().mockRejectedValue(
        remoteError(
          'METHOD_ERROR',
          'TOOL_NOT_ALLOWED_FOR_PEER_INVOKE: tool "bash" is not in the peer-invoke allowlist',
        ),
      );
      registerPeer('B', { invokeTool });
      const result = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: { file_path: 'x' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('TOOL_NOT_ALLOWED_FOR_PEER_INVOKE');
    });

    it('propagates workspace path refusal as failure', async () => {
      const invokeTool = vi.fn().mockRejectedValue(
        remoteError(
          'METHOD_ERROR',
          'PATH_OUTSIDE_PEER_WORKSPACE: /etc/passwd resolves to /etc/passwd, outside /tmp/ws',
        ),
      );
      registerPeer('B', { invokeTool });
      const result = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: { file_path: '/etc/passwd' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('PATH_OUTSIDE_PEER_WORKSPACE');
    });

    it('propagates depth refusal as failure', async () => {
      const invokeTool = vi.fn().mockRejectedValue(
        remoteError('MAX_DEPTH_EXCEEDED', 'MAX_DEPTH_EXCEEDED: peer.invoke chain depth 2 > max 1'),
      );
      registerPeer('B', { invokeTool });
      const result = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: { file_path: 'oracle.txt' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('MAX_DEPTH_EXCEEDED');
    });

    it('maps REQUEST_TIMEOUT to an explicit failure', async () => {
      const invokeTool = vi.fn().mockRejectedValue(
        remoteError('REQUEST_TIMEOUT', 'peer.invoke REQUEST_TIMEOUT: peer.tool.invoke did not respond within 15000ms'),
      );
      registerPeer('B', { invokeTool });
      const result = await executePeerToolInvoke({
        peer: 'B',
        tool: 'view_file',
        args: { file_path: 'oracle.txt' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('did not respond');
      expect(result.error).toContain('15000ms');
    });
  });
});
