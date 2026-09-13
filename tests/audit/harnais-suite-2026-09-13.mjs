/** Diagnostic audit probe: assertions document defects at 4b52cb6f4, not desired behavior. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-harness-audit-'));
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
process.env.HOME = path.join(root, 'home');
process.env.USERPROFILE = process.env.HOME;
await fs.mkdir(process.env.HOME);
globalThis.fetch = async () => { throw new Error('Network disabled for this probe'); };
const { ToolHarness, createAgentToolHarness } = await import('../../src/harness/tool-harness.ts');
const { createExecuteCodeRpcInvoker } = await import('../../src/tools/execute-code-rpc-invoker.ts');
const { executeCode } = await import('../../src/tools/execute-code-runner.ts');
const observations = {};
const tool = name => ({ type: 'function', function: { name, description: `Tool ${name}`, parameters: { type: 'object', properties: {} } } });

try {
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  const outside = path.join(root, 'outside.txt');
  await fs.writeFile(outside, 'SYNTHETIC_OUTSIDE_MARKER');
  await fs.symlink(outside, path.join(workspace, 'linked.txt'));
  const invoker = createExecuteCodeRpcInvoker({ workspaceRoot: workspace, allowlist: new Set(['view_file']), extraTools: new Set(), isFleetSafe: () => true });
  const escaped = await invoker({ tool: 'view_file', args: { file_path: 'linked.txt' } });
  observations.symlinkBoundary = { outsideRead: escaped.ok && escaped.output === 'SYNTHETIC_OUTSIDE_MARKER' };
  assert.equal(observations.symlinkBoundary.outsideRead, true);

  let botId = 'bot-a';
  const agent = {
    getMemoryScope: () => ({ cwd: workspace, botId }),
    executeToolByName: async () => ({ success: true, output: botId }),
  };
  const scoped = await createAgentToolHarness(agent, [tool('recall')]);
  try {
    const before = await scoped.call('recall');
    botId = 'bot-b';
    const after = await scoped.call('recall');
    observations.botScope = { before: before.output, after: after.output, acceptedChangedBot: after.success };
    assert.deepEqual(observations.botScope, { before: 'bot-a', after: 'bot-b', acceptedChangedBot: true });
  } finally { await scoped.dispose(); }

  const catalog = Array.from({ length: 513 }, (_, index) => tool(`tool_${String(index).padStart(4, '0')}`));
  const large = new ToolHarness({ cwd: workspace, tools: catalog, dispatch: async () => ({ success: true, output: 'ok' }) });
  try {
    const found = large.search('tool_0512', 1);
    const direct = await large.call('tool_0512');
    const cell = await large.exec(`text(await tools.call('tool_0512', {}));`);
    const discovery = await large.exec(`text(typeof tools.tool_search);`);
    observations.largeCatalog = { found: found[0]?.name, directSuccess: direct.success, cellSuccess: cell.success, cellError: cell.error, discoveryMissing: discovery.output?.includes('undefined') };
    assert.equal(found[0]?.name, 'tool_0512');
    assert.equal(direct.success, true);
    assert.equal(cell.success, false);
    assert.equal(observations.largeCatalog.discoveryMissing, true);
  } finally { await large.dispose(); }

  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let secondCalled;
  const lateCall = new Promise(resolve => { secondCalled = resolve; });
  const marker = path.join(root, 'child-may-exit');
  let finished = false;
  const calls = [];
  try {
    const result = await executeCode({ language: 'javascript', timeoutMs: 3000, code: `
      import * as auditFs from 'node:fs';
      const auditDir = process.env.CODEBUDDY_EXECUTE_CODE_RPC_DIR;
      for (const id of ['01', '02']) auditFs.writeFileSync(auditDir + '/' + id + '.req.json', JSON.stringify({tool:'probe', args:{id}}));
      while (!auditFs.existsSync(${JSON.stringify(marker)})) await new Promise(r => setTimeout(r, 10));
    ` }, { rootDir: workspace, envMode: 'isolate', rpcEnabled: true, rpcInvoke: async request => {
      calls.push({ id: request.args.id, afterCompletion: finished });
      if (calls.length === 1) { await fs.writeFile(marker, 'ready'); await firstGate; }
      else secondCalled();
      return { ok: true, output: 'synthetic' };
    } });
    finished = true;
    assert.equal(result.ok, true, result.error);
    assert.equal(calls.length, 1);
    releaseFirst();
    let timer;
    try { await Promise.race([lateCall, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No late RPC observed')), 2000); })]); }
    finally { clearTimeout(timer); }
    // Let the responder finish writing its second answer before fixture cleanup.
    await new Promise(resolve => setTimeout(resolve, 50));
    observations.rpcAfterExit = { calls, lateInvocation: calls[1]?.afterCompletion === true };
    assert.equal(observations.rpcAfterExit.lateInvocation, true);
  } finally { releaseFirst(); }
  console.log(JSON.stringify(observations, null, 2));
} finally {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  await fs.rm(root, { recursive: true, force: true });
}
