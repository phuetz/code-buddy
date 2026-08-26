import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeCode, type ExecuteCodeResult } from '../../src/tools/execute-code-runner.js';
import type {
  ExecuteCodeRpcInvoker,
  ExecuteCodeRpcInvokeRequest,
} from '../../src/tools/execute-code-rpc-invoker.js';
import { createExecuteCodeRpcInvoker, getExecuteCodeRpcExtraTools } from '../../src/tools/execute-code-rpc-invoker.js';
import { getToolRegistry } from '../../src/tools/registry.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

let tempWorkspace: string;
let idCounter: number;

function nextId(): string {
  idCounter += 1;
  return `execute-rpc-${idCounter}`;
}

/**
 * Script that calls a tool by RPC, then prints the RPC result as JSON so
 * the test can assert on the round-trip (`__RPC__:<json>`).
 */
function rpcScript(tool: string, args: Record<string, unknown>): string {
  return [
    `const r = globalThis.codebuddyToolCall(${JSON.stringify(tool)}, ${JSON.stringify(args)});`,
    "console.log('__RPC__:' + JSON.stringify(r));",
  ].join('\n');
}

function parseRpcLine(stdout: string): { ok: boolean; output?: string; error?: string } {
  const line = stdout.split('\n').find((l) => l.startsWith('__RPC__:'));
  expect(line, `no __RPC__ line in stdout:\n${stdout}`).toBeTruthy();
  return JSON.parse((line as string).slice('__RPC__:'.length));
}

describe('execute_code → tool RPC (opt-in, OFF by default)', () => {
  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-execute-code-rpc-'));
    idCounter = 0;
    delete process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC;
    delete process.env.CODEBUDDY_EXECUTE_CODE_RPC_TOOLS;
  });

  afterEach(async () => {
    delete process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC;
    delete process.env.CODEBUDDY_EXECUTE_CODE_RPC_TOOLS;
    // Retry: a script killed on timeout may still hold its run dir on Windows.
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('OFF by default: script RPC attempt is refused and no tool runs', async () => {
    const invoke = vi.fn<[ExecuteCodeRpcInvokeRequest], ReturnType<ExecuteCodeRpcInvoker>>(
      async () => ({ ok: true, output: 'should-never-run' }),
    );

    const result = await executeCode(
      {
        language: 'javascript',
        code: rpcScript('view_file', { file_path: 'secret.txt' }),
      },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
      // rpcEnabled left to default (env unset) → OFF
    );

    expect(result.ok).toBe(true); // script itself exits cleanly
    // Strong assertion: the invoker (real tool execution) was NEVER called.
    expect(invoke).not.toHaveBeenCalled();
    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(false);
    expect(rpc.error).toContain('EXECUTE_CODE_TOOL_RPC_DISABLED');
  });

  it('ON (flag): allowlisted view_file round-trips real file content into script stdout', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const secretPath = path.join(tempWorkspace, 'secret.txt');
    const secret = 'TOP-SECRET-ROUNDTRIP-9f3a';
    await fs.writeFile(secretPath, secret, 'utf8');

    // Real invoker → real read-only tool execution (honest round-trip).
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      isFleetSafe: (name) => name === 'view_file' || name === 'list_directory' || name === 'search',
    });

    const result = await executeCode(
      {
        language: 'javascript',
        code: rpcScript('view_file', { file_path: secretPath }),
      },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );

    expect(result.ok, result.error).toBe(true);
    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(true);
    // The actual file content, read by the real tool, appears in script output.
    expect(rpc.output).toContain(secret);
  });

  it('ON but tool not allowlisted is refused (even though enabled)', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set(['view_file']),
      isFleetSafe: () => true,
    });

    const result = await executeCode(
      {
        language: 'javascript',
        code: rpcScript('write_file', { file_path: path.join(tempWorkspace, 'evil.txt'), content: 'x' }),
      },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );

    expect(result.ok).toBe(true);
    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(false);
    expect(rpc.error).toContain('TOOL_NOT_ALLOWED_FOR_EXECUTE_CODE_RPC');
    // And no file was written.
    await expect(fs.stat(path.join(tempWorkspace, 'evil.txt'))).rejects.toBeTruthy();
  });

  it('ON but tool lacks fleetSafe metadata is refused', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set(['view_file']),
      isFleetSafe: () => false, // simulate a non-fleetSafe registry entry
    });

    const result = await executeCode(
      {
        language: 'javascript',
        code: rpcScript('view_file', { file_path: path.join(tempWorkspace, 'x') }),
      },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );

    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(false);
    expect(rpc.error).toContain('TOOL_NOT_FLEET_SAFE');
  });

  it('enforces the per-execution RPC call bound (anti-loop)', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const filePath = path.join(tempWorkspace, 'f.txt');
    await fs.writeFile(filePath, 'hello', 'utf8');
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      isFleetSafe: () => true,
    });

    const code = [
      'const out = [];',
      'for (let i = 0; i < 3; i++) {',
      `  out.push(globalThis.codebuddyToolCall('view_file', { file_path: ${JSON.stringify(filePath)} }));`,
      '}',
      "console.log('__RPC__:' + JSON.stringify(out));",
    ].join('\n');

    const result = await executeCode(
      { language: 'javascript', code },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke, rpcMaxCalls: 2 },
    );

    expect(result.ok, result.error).toBe(true);
    const results = JSON.parse(
      (result.stdout.split('\n').find((l) => l.startsWith('__RPC__:')) as string).slice('__RPC__:'.length),
    ) as Array<{ ok: boolean; error?: string }>;
    expect(results).toHaveLength(3);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(true);
    expect(results[2]!.ok).toBe(false);
    expect(results[2]!.error).toContain('RPC_CALL_LIMIT_EXCEEDED');
  });

  it('uses the REAL registry fleetSafe gate by default (view_file safe, write_file unsafe)', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    // Register real metadata so getToolRegistry().isFleetSafe reflects production wiring.
    const registry = getToolRegistry();
    for (const name of ['view_file', 'write_file']) {
      const meta = TOOL_METADATA.find((m) => m.name === name);
      expect(meta, `metadata for ${name}`).toBeTruthy();
      registry.registerTool(
        { type: 'function', function: { name, description: meta!.description, parameters: { type: 'object', properties: {} } } },
        meta!,
      );
    }
    expect(registry.isFleetSafe('view_file')).toBe(true);
    expect(registry.isFleetSafe('write_file')).toBe(false);

    const filePath = path.join(tempWorkspace, 'real.txt');
    const secret = 'REAL-REGISTRY-GATE-c41d';
    await fs.writeFile(filePath, secret, 'utf8');

    // Default invoker → real registry fleetSafe + real allowlist.
    const invoke = createExecuteCodeRpcInvoker({ workspaceRoot: tempWorkspace });

    const okResult = await executeCode(
      { language: 'javascript', code: rpcScript('view_file', { file_path: filePath }) },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );
    const okRpc = parseRpcLine(okResult.stdout);
    expect(okRpc.ok).toBe(true);
    expect(okRpc.output).toContain(secret);

    // write_file is blocked by the allowlist first (read-only-only channel).
    const denyResult = await executeCode(
      { language: 'javascript', code: rpcScript('write_file', { file_path: filePath, content: 'x' }) },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );
    const denyRpc = parseRpcLine(denyResult.stdout);
    expect(denyRpc.ok).toBe(false);
  });

  it('python scripts can round-trip via codebuddy_tool_call when enabled', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const secretPath = path.join(tempWorkspace, 'py-secret.txt');
    const secret = 'PY-ROUNDTRIP-7b2c';
    await fs.writeFile(secretPath, secret, 'utf8');
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      isFleetSafe: () => true,
    });

    const code = [
      'import json',
      `r = codebuddy_tool_call('view_file', {'file_path': ${JSON.stringify(secretPath)}})`,
      "print('__RPC__:' + json.dumps(r))",
    ].join('\n');

    const started = Date.now();
    const result: ExecuteCodeResult = await executeCode(
      // 30 s own timeout (< the 60 s test budget): on a stall the interpreter
      // is killed and the failure carries `execute_code timed out`, instead of
      // a vitest timeout that leaves python polling and its run dir locked.
      { language: 'python', code, timeoutMs: 30_000 },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );
    const elapsed = Date.now() - started;
    if (elapsed > 5_000) {
      console.error(`[execute-code-rpc] slow python round-trip: ${elapsed}ms on ${process.platform}/node ${process.version}; stderr: ${result.stderr.slice(-500)}`);
    }

    expect(result.ok, `${result.error}\n${result.stderr}`).toBe(true);
    const rpc = parseRpcLine(result.stdout);
    expect(rpc.ok).toBe(true);
    expect(rpc.output).toContain(secret);
    // Real interpreter spawn + file-polling RPC: Windows CI runners jitter
    // 1.2–3.5 s with occasional I/O stalls (20 s+ on run 32590054137 after
    // three green runs) — same 60 s budget as the other real-I/O suites.
  }, 60_000);
});

// ──────────────────────────────────────────────────────────────────
// CODEBUDDY_EXECUTE_CODE_RPC_TOOLS — per-tool opt-in
// ──────────────────────────────────────────────────────────────────

describe('getExecuteCodeRpcExtraTools()', () => {
  it('returns empty set when env var is unset', () => {
    const result = getExecuteCodeRpcExtraTools(undefined, () => true);
    expect(result.size).toBe(0);
  });

  it('returns empty set for empty string', () => {
    const result = getExecuteCodeRpcExtraTools('', () => true);
    expect(result.size).toBe(0);
  });

  it('parses comma-separated executor-backed tool names', () => {
    const result = getExecuteCodeRpcExtraTools('search, view_file', () => true);
    expect(result).toEqual(new Set(['search', 'view_file']));
  });

  it('skips unknown tools and logs a warning', () => {
    const isRegistered = (name: string) => name === 'search';
    const result = getExecuteCodeRpcExtraTools('search, does_not_exist', isRegistered);
    expect(result).toEqual(new Set(['search']));
    expect(result.has('does_not_exist')).toBe(false);
  });

  it('skips registered tools that do not have execute_code RPC executors', () => {
    const result = getExecuteCodeRpcExtraTools(
      'search, bash',
      () => true,
      (name) => name === 'search',
    );
    expect(result).toEqual(new Set(['search']));
    expect(result.has('bash')).toBe(false);
  });

  it('handles whitespace and empty entries', () => {
    const result = getExecuteCodeRpcExtraTools('  search , , view_file  ', () => true);
    expect(result).toEqual(new Set(['search', 'view_file']));
  });

  it('deduplicates repeated names', () => {
    const result = getExecuteCodeRpcExtraTools('search,search,search', () => true);
    expect(result).toEqual(new Set(['search']));
    expect(result.size).toBe(1);
  });
});

describe('CODEBUDDY_EXECUTE_CODE_RPC_TOOLS integration', () => {
  let tempWorkspace: string;
  let idCounter: number;

  function nextId(): string {
    idCounter += 1;
    return `execute-rpc-extra-${idCounter}`;
  }

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-execute-code-rpc-extra-'));
    idCounter = 0;
    delete process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC;
    delete process.env.CODEBUDDY_EXECUTE_CODE_RPC_TOOLS;
  });

  afterEach(async () => {
    delete process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC;
    delete process.env.CODEBUDDY_EXECUTE_CODE_RPC_TOOLS;
    // Retry: a script killed on timeout may still hold its run dir on Windows.
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('extraTools are unioned with the base allowlist', () => {
    // Create an invoker where `view_file` is in the base allowlist and
    // `bash` is only in extraTools.
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set(['view_file']),
      extraTools: new Set(['bash']),
      isFleetSafe: () => true,
    });
    // The invoker is a function; we test indirectly via the full chain below.
    expect(invoke).toBeTypeOf('function');
  });

  it('extra tool bypasses fleetSafe gate', async () => {
    // `bash` is NOT fleetSafe, but it is in extraTools → should pass the
    // allowlist + fleetSafe gates (fail at UNKNOWN_EXECUTE_CODE_RPC_TOOL
    // because there is no built-in executor for bash, which is fine).
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set(['view_file']),
      extraTools: new Set(['bash']),
      isFleetSafe: () => false, // simulate ALL tools lacking fleetSafe
    });

    const result = await invoke({ tool: 'bash', args: { command: 'echo hi' } });
    // bash passes both allowlist (via extraTools) and fleetSafe (bypassed),
    // but hits the executor gate — no built-in executor for 'bash'.
    expect(result.ok).toBe(false);
    expect(result.error).toContain('UNKNOWN_EXECUTE_CODE_RPC_TOOL');
  });

  it('non-extra tool still requires fleetSafe', async () => {
    // view_file is in the base allowlist but NOT in extraTools, and
    // isFleetSafe returns false → should be refused.
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set(['view_file']),
      extraTools: new Set(['bash']),
      isFleetSafe: () => false,
    });

    const result = await invoke({ tool: 'view_file', args: { file_path: '/etc/passwd' } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('TOOL_NOT_FLEET_SAFE');
  });

  it('tool not in any allowlist is still refused', async () => {
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set(['view_file']),
      extraTools: new Set(['bash']),
      isFleetSafe: () => true,
    });

    const result = await invoke({ tool: 'write_file', args: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('TOOL_NOT_ALLOWED_FOR_EXECUTE_CODE_RPC');
  });

  it('extra tool with a built-in executor works end-to-end (view_file via extraTools)', async () => {
    // view_file added via extraTools (not base allowlist) and fleetSafe
    // returns false → should still succeed because extraTools bypass fleetSafe.
    const secretPath = path.join(tempWorkspace, 'extra-secret.txt');
    const secret = 'EXTRA-ROUNDTRIP-e51a';
    await fs.writeFile(secretPath, secret, 'utf8');

    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set([]), // empty base allowlist
      extraTools: new Set(['view_file']),
      isFleetSafe: () => false,
    });

    const result = await invoke({ tool: 'view_file', args: { file_path: secretPath } });
    expect(result.ok).toBe(true);
    expect(result.output).toContain(secret);
  });

  it('end-to-end: extraTools allow a view_file RPC from a script', async () => {
    process.env.CODEBUDDY_EXECUTE_CODE_TOOL_RPC = 'true';
    const secretPath = path.join(tempWorkspace, 'e2e-extra.txt');
    const secret = 'E2E-EXTRA-TOOLS-d42f';
    await fs.writeFile(secretPath, secret, 'utf8');

    // view_file added ONLY via extraTools, fleetSafe=false → should work.
    const invoke = createExecuteCodeRpcInvoker({
      workspaceRoot: tempWorkspace,
      allowlist: new Set([]), // empty base
      extraTools: new Set(['view_file']),
      isFleetSafe: () => false,
    });

    const code = [
      `const r = globalThis.codebuddyToolCall('view_file', { file_path: ${JSON.stringify(secretPath)} });`,
      "console.log('__RPC__:' + JSON.stringify(r));",
    ].join('\n');

    const result = await executeCode(
      { language: 'javascript', code },
      { rootDir: tempWorkspace, createId: nextId, rpcInvoke: invoke },
    );

    expect(result.ok, result.error).toBe(true);
    const rpcLine = result.stdout.split('\n').find((l) => l.startsWith('__RPC__:'));
    expect(rpcLine).toBeTruthy();
    const rpc = JSON.parse(rpcLine!.slice('__RPC__:'.length));
    expect(rpc.ok).toBe(true);
    expect(rpc.output).toContain(secret);
  });
});
