/**
 * Phase (d).23 V1.3 — peer.tool.invoke bridge tests.
 *
 * Validates wire/unwire idempotency, the three security gates
 * (allowlist + fleetSafe + workspace root), the happy paths for the
 * three V1 read-only executors (view_file / list_directory / search),
 * the streaming variant, depth-cap inheritance, and the audit log
 * shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
  wirePeerToolBridge,
  unwirePeerToolBridge,
  isPeerToolBridgeWired,
  _unwireForTests,
} from '../../src/fleet/peer-tool-bridge.js';
import {
  dispatchPeerRequest,
  listPeerMethods,
  _resetPeerRpcForTests,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { CodeBuddyTool } from '../../src/codebuddy/client.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

// ---- helpers ---------------------------------------------------------

function mockTool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: `mock ${name}`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  };
}

function seedFleetSafeRegistry(): void {
  const registry = ToolRegistry.getInstance();
  registry.clear();
  for (const name of ['view_file', 'list_directory', 'search']) {
    registry.registerTool(mockTool(name), {
      name,
      category: 'file_read',
      keywords: [],
      priority: 5,
      description: name,
      fleetSafe: true,
    });
  }
  // Add a non-fleetSafe tool to validate the second gate.
  registry.registerTool(mockTool('bash'), {
    name: 'bash',
    category: 'system',
    keywords: [],
    priority: 5,
    description: 'bash',
    // fleetSafe omitted — defaults to false
  });
}

const baseCtx: PeerMethodContext = {
  connectionId: 'ws_test',
  scopes: ['peer:invoke'],
  traceId: 'trace-test-tool',
  depth: 0,
};

let tmpRoot: string;

beforeEach(async () => {
  _unwireForTests();
  _resetPeerRpcForTests();
  seedFleetSafeRegistry();
  vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockResolvedValue({ confirmed: true });
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-peer-tool-'));
  // The realpath check normalises symlinks (e.g. /tmp → /private/tmp on macOS).
  tmpRoot = await fs.realpath(tmpRoot);
  await fs.writeFile(path.join(tmpRoot, 'hello.txt'), 'hello world\nline 2\n');
  await fs.mkdir(path.join(tmpRoot, 'sub'));
  await fs.writeFile(path.join(tmpRoot, 'sub', 'nested.md'), 'inner content with hello pattern\n');
  process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = tmpRoot;
});

afterEach(async () => {
  _unwireForTests();
  _resetPeerRpcForTests();
  vi.restoreAllMocks();
  ToolRegistry.getInstance().clear();
  delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
  delete process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST;
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

// ---- tests -----------------------------------------------------------

describe('peer-tool-bridge — Phase (d).23 V1.3', () => {
  describe('wire / unwire', () => {
    it('wire registers peer.tool.invoke + peer.tool.invoke.stream', () => {
      expect(listPeerMethods()).not.toContain('peer.tool.invoke');
      wirePeerToolBridge();
      expect(listPeerMethods()).toContain('peer.tool.invoke');
      expect(listPeerMethods()).toContain('peer.tool.invoke.stream');
      expect(isPeerToolBridgeWired()).toBe(true);
    });

    it('wire is idempotent — second call does not double-register', () => {
      wirePeerToolBridge();
      wirePeerToolBridge();
      const methods = listPeerMethods();
      // Map keys are unique by construction; idempotency is about wired flag.
      expect(methods.filter((m) => m === 'peer.tool.invoke')).toHaveLength(1);
      expect(methods.filter((m) => m === 'peer.tool.invoke.stream')).toHaveLength(1);
    });

    it('unwire removes both methods', () => {
      wirePeerToolBridge();
      unwirePeerToolBridge();
      expect(listPeerMethods()).not.toContain('peer.tool.invoke');
      expect(listPeerMethods()).not.toContain('peer.tool.invoke.stream');
      expect(isPeerToolBridgeWired()).toBe(false);
    });
  });

  describe('error paths', () => {
    it('METHOD_ERROR when tool name is missing', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        { id: 'p1', method: 'peer.tool.invoke', params: {} },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('METHOD_ERROR');
      expect(r.error?.message).toContain('missing string tool name');
    });

    it('TOOL_NOT_ALLOWED for tool outside V1 allowlist (bash)', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        { id: 'p2', method: 'peer.tool.invoke', params: { tool: 'bash', args: {} } },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('TOOL_NOT_ALLOWED_FOR_PEER_INVOKE');
    });

    it('TOOL_NOT_FLEET_SAFE when env-allowed tool lacks fleetSafe metadata', async () => {
      // Override allowlist to include 'bash' — but bash is registered without fleetSafe.
      process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file,bash';
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        { id: 'p2b', method: 'peer.tool.invoke', params: { tool: 'bash', args: {} } },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('TOOL_NOT_FLEET_SAFE');
    });

    it('PEER_WORKSPACE_NOT_CONFIGURED when env unset', async () => {
      delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p3',
          method: 'peer.tool.invoke',
          params: { tool: 'view_file', args: { file_path: 'hello.txt' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('PEER_WORKSPACE_NOT_CONFIGURED');
    });

    it('PATH_OUTSIDE_PEER_WORKSPACE for absolute path outside root', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p4',
          method: 'peer.tool.invoke',
          params: { tool: 'view_file', args: { file_path: '/etc/hosts' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('PATH_OUTSIDE_PEER_WORKSPACE');
    });

    it('PATH_OUTSIDE_PEER_WORKSPACE via symlink-to-/etc + nonexistent target (probe-existence info-leak)', async () => {
      // Plain realpath() throws on missing paths; a naïve catch-and-fallback
      // would let `<symlink-to-/etc>/probe_xxxx` slip the startsWith(root)
      // check because the un-followed path string still starts with tmpRoot.
      // The fix walks up to the deepest existing ancestor before realpath.
      await fs.symlink('/etc', path.join(tmpRoot, 'escape'));
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p4b',
          method: 'peer.tool.invoke',
          params: {
            tool: 'view_file',
            args: { file_path: 'escape/probe_does_not_exist_xxx' },
          },
        },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('PATH_OUTSIDE_PEER_WORKSPACE');
    });

    it('peer.tool.invoke.stream rejects when transport has no emitChunk', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p5',
          method: 'peer.tool.invoke.stream',
          params: { tool: 'view_file', args: { file_path: 'hello.txt' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('does not support streaming');
    });

    it('UNKNOWN_PEER_TOOL when allowlist+fleetSafe pass but no executor', async () => {
      // Sneak find_definition into allowlist + registry; bridge has no
      // executor for it.
      process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'find_definition';
      ToolRegistry.getInstance().registerTool(mockTool('find_definition'), {
        name: 'find_definition',
        category: 'file_search',
        keywords: [],
        priority: 5,
        description: 'find_definition',
        fleetSafe: true,
      });
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p_unknown',
          method: 'peer.tool.invoke',
          params: { tool: 'find_definition', args: {} },
        },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('UNKNOWN_PEER_TOOL');
    });
  });

  describe('happy path — view_file', () => {
    it('reads a file inside workspace via relative path', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p6',
          method: 'peer.tool.invoke',
          params: { tool: 'view_file', args: { file_path: 'hello.txt' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(true);
      const payload = r.payload as { tool: string; output: string; truncated?: boolean };
      expect(payload.tool).toBe('view_file');
      expect(payload.output).toBe('hello world\nline 2\n');
      expect(payload.truncated).toBe(false);
    });

    it('reads a file via absolute path inside workspace', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p7',
          method: 'peer.tool.invoke',
          params: { tool: 'view_file', args: { file_path: path.join(tmpRoot, 'hello.txt') } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(true);
      expect((r.payload as { output: string }).output).toContain('hello world');
    });
  });

  describe('happy path — list_directory', () => {
    it('lists workspace root entries', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p8',
          method: 'peer.tool.invoke',
          params: { tool: 'list_directory', args: { path: '.' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(true);
      const payload = r.payload as { output: string };
      expect(payload.output).toContain('hello.txt');
      expect(payload.output).toContain('sub');
    });

    it('caps large directory listings and marks payload truncated', async () => {
      const largeDir = path.join(tmpRoot, 'large');
      await fs.mkdir(largeDir);
      await Promise.all(
        Array.from({ length: 1_005 }, (_, i) =>
          fs.writeFile(path.join(largeDir, `entry-${String(i).padStart(4, '0')}.txt`), ''),
        ),
      );

      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p8b',
          method: 'peer.tool.invoke',
          params: { tool: 'list_directory', args: { path: 'large' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(true);
      const payload = r.payload as { output: string; truncated: boolean };
      expect(payload.truncated).toBe(true);
      expect(payload.output).toContain('entry-0000.txt');
      expect(payload.output).not.toContain('entry-1004.txt');
      expect(payload.output).toContain('truncated after 256 entries (1005 total)');
    });
  });

  describe('happy path — search (ripgrep)', () => {
    it('finds matches across workspace', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p9',
          method: 'peer.tool.invoke',
          params: { tool: 'search', args: { query: 'hello', path: '.' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(true);
      const payload = r.payload as { output: string };
      expect(payload.output).toMatch(/hello\.txt/);
      expect(payload.output).toMatch(/nested\.md/);
    });

    it('returns success with empty output when ripgrep finds zero matches (exit 1)', async () => {
      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p9b',
          method: 'peer.tool.invoke',
          params: { tool: 'search', args: { query: 'unlikely_pattern_xyzzy_no_match', path: '.' } },
        },
        baseCtx,
      );
      // ripgrep exits 1 on no matches — bridge maps that to ok=true,
      // empty output (NOT to SEARCH_FAILED).
      expect(r.ok).toBe(true);
      const payload = r.payload as { output: string; truncated: boolean };
      expect(payload.output).toBe('');
      expect(payload.truncated).toBe(false);
    });
  });

  describe('view_file — 256 KB truncation cap', () => {
    it('returns truncated=true when file exceeds READ_TRUNCATE_BYTES', async () => {
      // Write a 256 KB + 1 byte file. Smaller than the cap by one byte
      // would round to truncated=false; we deliberately cross.
      const cap = 256 * 1024;
      const big = Buffer.alloc(cap + 1024, 'a'); // 256 KB + 1 KB ASCII 'a'
      await fs.writeFile(path.join(tmpRoot, 'huge.txt'), big);

      wirePeerToolBridge();
      const r = await dispatchPeerRequest(
        {
          id: 'p_trunc',
          method: 'peer.tool.invoke',
          params: { tool: 'view_file', args: { file_path: 'huge.txt' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(true);
      const payload = r.payload as { output: string; truncated: boolean };
      expect(payload.truncated).toBe(true);
      expect(payload.output.length).toBe(cap);
    });
  });

  describe('env override — CODEBUDDY_PEER_TOOL_ALLOWLIST', () => {
    it('restricts allowlist to the env value when set', async () => {
      // Lock allowlist to view_file only — list_directory + search reject.
      process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file';
      wirePeerToolBridge();

      const r1 = await dispatchPeerRequest(
        {
          id: 'p_env_1',
          method: 'peer.tool.invoke',
          params: { tool: 'list_directory', args: { path: '.' } },
        },
        baseCtx,
      );
      expect(r1.ok).toBe(false);
      expect(r1.error?.message).toContain('TOOL_NOT_ALLOWED_FOR_PEER_INVOKE');

      const r2 = await dispatchPeerRequest(
        {
          id: 'p_env_2',
          method: 'peer.tool.invoke',
          params: { tool: 'view_file', args: { file_path: 'hello.txt' } },
        },
        baseCtx,
      );
      expect(r2.ok).toBe(true);
    });

    it('falls back to V1 default when env is empty/whitespace', async () => {
      process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = '   ';
      wirePeerToolBridge();
      // Empty/whitespace-only env should NOT lock everything out — falls
      // back to V1 default {view_file, list_directory, search}.
      const r = await dispatchPeerRequest(
        {
          id: 'p_env_3',
          method: 'peer.tool.invoke',
          params: { tool: 'list_directory', args: { path: '.' } },
        },
        baseCtx,
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('streaming', () => {
    it('emits chunks during view_file via emitChunk', async () => {
      wirePeerToolBridge();
      // 50 KB file forces multiple 16 KB chunks.
      const big = 'x'.repeat(50_000);
      await fs.writeFile(path.join(tmpRoot, 'big.txt'), big);

      const chunks: string[] = [];
      const ctx: PeerMethodContext = {
        ...baseCtx,
        emitChunk: (delta) => chunks.push(delta),
      };
      const r = await dispatchPeerRequest(
        {
          id: 'p10',
          method: 'peer.tool.invoke.stream',
          params: { tool: 'view_file', args: { file_path: 'big.txt' } },
        },
        ctx,
      );
      expect(r.ok).toBe(true);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(big);
      expect((r.payload as { output: string }).output).toBe(big);
    });
  });

  describe('depth cap inheritance', () => {
    it('rejects when frame depth > maxDepth', async () => {
      wirePeerToolBridge();
      // Default cap is 3; depth=999 well past it.
      const r = await dispatchPeerRequest(
        {
          id: 'p11',
          method: 'peer.tool.invoke',
          params: { tool: 'view_file', args: { file_path: 'hello.txt' } },
          depth: 999,
        },
        baseCtx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('MAX_DEPTH_EXCEEDED');
    });
  });

  describe('audit log', () => {
    it('logs invocation metadata via logger.info on success', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      const spy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      try {
        wirePeerToolBridge();
        // Pass traceId in the frame so it propagates to the handler ctx
        // (the dispatcher generates a fresh one when the frame omits it).
        await dispatchPeerRequest(
          {
            id: 'p12',
            method: 'peer.tool.invoke',
            params: { tool: 'view_file', args: { file_path: 'hello.txt' } },
            traceId: 'trace-test-tool',
            depth: 1,
          },
          baseCtx,
        );
        const auditCall = spy.mock.calls.find((c) => c[0] === '[fleet] peer.tool.invoke');
        expect(auditCall).toBeDefined();
        const meta = auditCall?.[1] as Record<string, unknown>;
        expect(meta.tool).toBe('view_file');
        expect(meta.ok).toBe(true);
        expect(meta.traceId).toBe('trace-test-tool');
        expect(meta.from).toBe('ws_test');
        expect(meta.depth).toBe(1);
        expect(typeof meta.durationMs).toBe('number');
      } finally {
        spy.mockRestore();
      }
    });

    it('logs error path with ok=false', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      const spy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      try {
        wirePeerToolBridge();
        await dispatchPeerRequest(
          {
            id: 'p13',
            method: 'peer.tool.invoke',
            params: { tool: 'bash', args: {} },
          },
          baseCtx,
        );
        const auditCall = spy.mock.calls.find((c) => c[0] === '[fleet] peer.tool.invoke');
        expect(auditCall).toBeDefined();
        const meta = auditCall?.[1] as Record<string, unknown>;
        expect(meta.ok).toBe(false);
        expect(typeof meta.error).toBe('string');
        expect(meta.error).toContain('TOOL_NOT_ALLOWED_FOR_PEER_INVOKE');
      } finally {
        spy.mockRestore();
      }
    });
  });
});
