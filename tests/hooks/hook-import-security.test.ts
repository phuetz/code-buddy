import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importHooks, manageImportedHook } from '../../src/hooks/hook-importer.js';
import { UserHooksManager } from '../../src/hooks/user-hooks.js';
import { runPreToolUseHook } from '../../src/agent/execution/tool-hooks.js';

describe.skipIf(process.platform === 'win32')('imported hooks: independent review regressions', () => {
  let root: string, file: string, project: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-review-'));
    file = path.join(root, 'source/hooks/hooks.json'); project = path.join(root, 'project');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.mkdirSync(project);
  });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
  function install(text: string, event = 'PreToolUse') {
    fs.writeFileSync(path.join(root, 'source/proof.cjs'), text);
    fs.writeFileSync(file, JSON.stringify({ hooks: { [event]: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/proof.cjs"' }] }] } }));
    return importHooks({ file, projectRoot: project, apply: true });
  }
  it.each([
    'globalThis["Function"](\'process.mainModule.require("outside.cjs")\')()',
    'globalThis["eval"](\'process.mainModule.require("outside.cjs")\')',
    'const key="toString";JSON[key]("{}");',
    'const g=globalThis;g.eval("1");',
    'const g=globalThis;',
    'process.mainModule.require("outside.cjs");',
    'const {constructor}=()=>{};constructor("return process")();',
    'Array.from(arguments).at(1)("fs");',
    'const p=process;p.binding("fs");',
    'Reflect.get(globalThis,"ev"+"al")("1");',
    'require("fs").readFileSync(`${process.env.HOME}/.ssh/id_rsa`);',
    'require("node:fs/promises").readFile(".env");',
    'const {readFileSync}=require("fs");readFileSync("private");',
    'require("fs").writeFileSync(".codebuddy/hooks.json","{}");',
    'require("child_process").execSync("true");',
    'require("node:http").get("https://example.invalid");',
    'process.env.HOME;',
  ])('quarantines capability access, cannot enable or execute: %s', async (text) => {
    const report = install(text);
    expect(report.imported).toHaveLength(0); expect(report.quarantined).toHaveLength(1);
    const record = report.quarantined[0]!;
    expect(record.reasons.join()).toContain('hook-policy');
    expect(() => manageImportedHook('enable', record.id, project)).toThrow('Quarantined');
    expect(new UserHooksManager(project).getHandlers('PreToolUse')).toHaveLength(0);
    expect(fs.readdirSync(project)).toEqual(['.codebuddy']);
  });
  it('rechecks the hook policy on enable and execution for older admitted manifests', async () => {
    // Import while simulating the older policy, then restore the current guard.
    const policy = await import('../../src/hooks/hook-import-policy.js');
    const spy = vi.spyOn(policy, 'hookScriptPolicy').mockReturnValue([]);
    const record = install('globalThis["Function"]("return 1")();').imported[0]!;
    expect(record).toBeDefined(); spy.mockRestore();
    expect(() => manageImportedHook('enable', record.id, project)).toThrow('Hook policy refused');
    const manifest = path.join(project, '.codebuddy/imported-hooks', record.id, 'manifest.json');
    const data = JSON.parse(fs.readFileSync(manifest, 'utf8')); data.enabled = true;
    fs.writeFileSync(manifest, JSON.stringify(data));
    expect(await new UserHooksManager(project).executeHooks('PreToolUse', {})).toMatchObject({ allowed: false });
  });
  it.each([['node', 'proof.txt'], ['node', 'proof.sh'], ['sh', 'proof.js']])('refuses interpreter disguises: %s %s', (interpreter, script) => {
    fs.writeFileSync(path.join(root, 'source', script), 'globalThis["Function"]("return 1")();');
    fs.writeFileSync(file, JSON.stringify({hooks:{PreToolUse:[{hooks:[{type:'command',command:`${interpreter} ${script}`}]}]}}));
    const report = importHooks({file,projectRoot:project,apply:true});
    expect(report.imported).toHaveLength(0); expect(report.refused[0]?.reason).toContain('extension mismatch');
  });
  it.each(['mystery', undefined])('fails closed for native unknown/missing type %s', async (type) => {
    fs.mkdirSync(path.join(project, '.codebuddy'));
    fs.writeFileSync(path.join(project, '.codebuddy/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ type, command: 'exit 0' }] } }));
    expect(await runPreToolUseHook(project, { function: { name: 'view_file', arguments: '{}' } })).toMatchObject({ allowed: false, feedback: expect.stringContaining('handler type') });
  });
  it('fails closed if native guard becomes unreadable after loading (real file replacement)', async () => {
    fs.mkdirSync(path.join(project, '.codebuddy'));
    const config = path.join(project, '.codebuddy/hooks.json');
    fs.writeFileSync(config, JSON.stringify({ hooks: { PreToolUse: [{ type: 'command', command: 'exit 2' }] } }));
    const manager = new UserHooksManager(project);
    fs.unlinkSync(config); fs.mkdirSync(config); // EISDIR, including privileged test users.
    expect(await manager.executeHooks('PreToolUse', {})).toMatchObject({ allowed: false, feedback: expect.stringContaining('Unreadable') });
  });
  it('fails closed for an unreadable imported manifest and invalid tool JSON', async () => {
    const record = install('process.exit(2);').imported[0]!;
    manageImportedHook('enable', record.id, project);
    const manager = new UserHooksManager(project);
    fs.writeFileSync(path.join(project, '.codebuddy/imported-hooks', record.id, 'manifest.json'), '{');
    expect(await manager.executeHooks('PreToolUse', {})).toMatchObject({ allowed: false });
    expect(await runPreToolUseHook(project, { function: { name: 'view_file', arguments: '{' } })).toMatchObject({ allowed: false });
  });
  it('fails closed when stat of the imported guard directory is denied', async () => {
    const stat = fs.lstatSync.bind(fs);
    vi.spyOn(fs, 'lstatSync').mockImplementation((file, options) => {
      if (String(file) === path.join(project, '.codebuddy/imported-hooks')) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      return stat(file, options as { bigint?: false });
    });
    expect(await new UserHooksManager(project).executeHooks('PreToolUse', {})).toMatchObject({ allowed: false, feedback: expect.stringContaining('permission denied') });
  });
  it.each(['PreToolUse', 'SessionStart', 'SessionEnd', 'PreCompact'])('does not fabricate unrelated stdin fields for %s', async (event) => {
    const record = install(`let raw='';process.stdin.on('data',s=>raw+=s);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:raw}})));`, event).imported[0]!;
    manageImportedHook('enable', record.id, project);
    const manager = new UserHooksManager(project);
    const output = event === 'PreCompact'
      ? manager.runPreCompact({ reason: 'manual', tokensBefore: 123, messagesBefore: 2 })
      : (await manager.executeHooks(event as 'PreToolUse', {})).additionalContext;
    const input = JSON.parse(output!);
    expect(input).not.toHaveProperty('source'); expect(input).not.toHaveProperty('reason');
    if (event !== 'PreToolUse') expect(input).not.toHaveProperty('tool_input');
    if (event === 'PreCompact') expect(input.trigger).toBe('manual'); else expect(input).not.toHaveProperty('trigger');
  });
  it('hard-kills PreCompact descendants ignoring SIGTERM within a bounded foreground call', () => {
    const pidFile = path.join(root, 'pid'); const script = path.join(root, 'descendant.cjs');
    fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),2500);`);
    fs.mkdirSync(path.join(project, '.codebuddy'));
    fs.writeFileSync(path.join(project, '.codebuddy/hooks.json'), JSON.stringify({ hooks: { PreCompact: [{ type: 'command', command: `node '${script}' & wait`, timeout: 250 }] } }));
    let pid: number | undefined;
    try {
      const start = Date.now();
      expect(new UserHooksManager(project).runPreCompact({ reason: 'manual', tokensBefore: 10, messagesBefore: 1 })).toBeUndefined();
      const elapsed = Date.now() - start;
      pid = Number(fs.readFileSync(pidFile, 'utf8'));
      let alive = false;
      try {
        process.kill(pid, 0); alive = true;
        if (process.platform === 'linux') {
          try { alive = !fs.readFileSync(`/proc/${pid}/stat`, 'utf8').includes(') Z '); } catch { /* PID namespace may differ from /proc. Keep kill(0)'s result. */ }
        }
      } catch { /* Exited and reaped. */ }
      expect(alive).toBe(false); expect(elapsed).toBeLessThan(1500);
    } finally { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already dead. */ } } }
  });
});
