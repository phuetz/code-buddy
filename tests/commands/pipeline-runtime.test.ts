import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validatePipelineDefinition } from '../../src/commands/pipeline.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

describe('standalone pipeline runtime with real ToolHandler', () => {
  let directory: string;
  let evidence: {
    read: { success: boolean; output: string };
    missing: { success: boolean };
    denied: { success: boolean };
    unconfirmed: { success: boolean };
    approval: { approved: boolean };
    fileCreated: boolean;
    listenersBefore: number;
    listenersAfter: number;
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pipeline-runtime-'));
    const home = path.join(directory, 'home');
    const workspace = path.join(directory, 'workspace');
    await Promise.all([mkdir(home), mkdir(workspace)]);
    const source = pathToFileURL(path.join(root, 'src/')).href;
    const script = `
      import { writeFile, access } from 'node:fs/promises';
      const { createPipelineRuntime } = await import(${JSON.stringify(source + 'commands/pipeline.ts')});
      const { getPermissionModeManager } = await import(${JSON.stringify(source + 'security/permission-modes.ts')});
      const { ConfirmationService } = await import(${JSON.stringify(source + 'utils/confirmation-service.ts')});
      await writeFile('proof.txt', 'PIPELINE_NATIVE_READ_PROOF');
      const service = ConfirmationService.getInstance();
      const listenersBefore = service.listenerCount('confirmation-requested');
      const runtime = createPipelineRuntime();
      try {
        const read = await runtime.toolExecutor('view_file', { path: 'proof.txt' }, '');
        const missing = await runtime.toolExecutor('view_file', { path: 'missing.txt' }, '');
        const denied = await getPermissionModeManager().withModeAsync('plan', () =>
          runtime.toolExecutor('create_file', { path: 'blocked.txt', content: 'must not exist' }, ''));
        const unconfirmed = await runtime.toolExecutor('create_file', { path: 'blocked.txt', content: 'must not exist' }, '');
        service.setSessionFlag('allOperations', true);
        const approval = await runtime.approvalHandler({ message: 'Explicit gate', timeoutMs: 1000 }, 0, '');
        const fileCreated = await access('blocked.txt').then(() => true, () => false);
        await runtime.dispose();
        process.stdout.write('PIPELINE_RESULT:' + JSON.stringify({ read, missing, denied, unconfirmed,
          approval, fileCreated, listenersBefore, listenersAfter: service.listenerCount('confirmation-requested') }));
      } finally { await runtime.dispose(); }
    `;
    const result = await exec(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'),
      '--input-type=module', '-e', script], {
      cwd: workspace, timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'),
        CODEBUDDY_DISABLE_MCP: 'true', CODEBUDDY_SENSORY: 'false', NO_COLOR: '1' },
    });
    evidence = JSON.parse(result.stdout.split('PIPELINE_RESULT:').at(-1)!);
  }, 40000);

  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it('reads a real workspace file through normal dispatch and reports missing files', () => {
    expect(evidence.read.success).toBe(true);
    expect(evidence.read.output).toContain('PIPELINE_NATIVE_READ_PROOF');
    expect(evidence.missing.success).toBe(false);
  });

  it('preserves plan denial and fails closed for unconfirmed non-TTY edits', () => {
    expect(evidence.denied).toMatchObject({ success: false, error: expect.stringMatching(/plan|permission|denied/i) });
    expect(evidence.unconfirmed).toMatchObject({ success: false, error: expect.stringMatching(/confirm|approval|cancel|denied/i) });
    expect(evidence.fileCreated).toBe(false);
  });

  it('does not auto-approve explicit gates even with a session grant', () => {
    expect(evidence.approval.approved).toBe(false);
    expect(evidence.listenersAfter).toBe(evidence.listenersBefore);
  });

  it('validates explicit approval steps and rejects invalid deadlines', () => {
    expect(validatePipelineDefinition({ name: 'approval', steps: [{ name: 'review', type: 'approval' }] }).valid).toBe(true);
    expect(validatePipelineDefinition({ name: 'approval', steps: [{ name: 'review', type: 'approval',
      approvalGate: { message: 'Review', timeoutMs: -1 } }] }).valid).toBe(false);
  });
});
