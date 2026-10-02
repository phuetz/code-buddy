import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    setImmediate(() => child.emit('close', 0));
    return child;
  }),
}));

import { spawn } from 'child_process';
import { DockerTool } from '../../src/tools/docker-tool.js';
import { KubernetesTool } from '../../src/tools/kubernetes-tool.js';
import { RequestPermissionsTool, hasPermission } from '../../src/tools/request-permissions-tool.js';
import { NotebookTool } from '../../src/tools/notebook-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { withToolExecutionContext } from '../../src/utils/tool-execution-context.js';

afterEach(() => vi.restoreAllMocks());
const cwdA = path.resolve('_qa/acp/home/context-A');
const cwdB = path.resolve('_qa/acp/home/context-B');
function scoped<T>(service: ConfirmationService, cwd: string, fn: () => Promise<T>): Promise<T> {
  return ConfirmationService.withInstanceAsync(service, () => withToolExecutionContext({ cwd }, fn));
}

describe('shared tool instances use the calling session', () => {
  it('reads and edits relative notebooks in the calling session with a reused VFS tool', async () => {
    const root = fs.mkdtempSync(path.resolve('_qa/acp/home/notebook-'));
    const a = new ConfirmationService(); const b = new ConfirmationService();
    const first = path.join(root, 'A'); const second = path.join(root, 'B');
    for (const cwd of [first, second]) {
      fs.mkdirSync(cwd);
      fs.writeFileSync(path.join(cwd, 'sample.ipynb'), JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] }));
    }
    try {
      const tool = await scoped(a, first, async () => new NotebookTool());
      expect((await scoped(a, first, () => tool.execute({ action: 'read', path: 'sample.ipynb' }))).success).toBe(true);
      expect((await scoped(b, second, () => tool.execute({ action: 'add_cell', path: 'sample.ipynb', cellType: 'markdown', content: 'only B' }))).success).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(first, 'sample.ipynb'), 'utf8')).cells).toHaveLength(0);
      expect(JSON.parse(fs.readFileSync(path.join(second, 'sample.ipynb'), 'utf8')).cells).toHaveLength(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['docker', 'kubernetes'] as const)('%s resolves both permission service and cwd on every call', async (kind) => {
    const a = new ConfirmationService();
    const b = new ConfirmationService();
    a.setSessionFlag('bashCommands', true);
    const confirmA = vi.spyOn(a, 'requestConfirmation');
    const confirmB = vi.spyOn(b, 'requestConfirmation').mockResolvedValue({ confirmed: false });
    const tool = await scoped(a, cwdA, async () => kind === 'docker' ? new DockerTool() : new KubernetesTool());
    const call = () => tool instanceof DockerTool ? tool.build('.') : tool.apply('manifest.yaml');
    vi.mocked(spawn).mockClear();
    expect((await scoped(b, cwdB, call)).success).toBe(false);
    expect(confirmB).toHaveBeenCalledOnce();
    expect(confirmA).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    confirmB.mockResolvedValue({ confirmed: true });
    expect((await scoped(b, cwdB, call)).success).toBe(true);
    expect(spawn).toHaveBeenLastCalledWith(kind === 'docker' ? 'docker' : 'kubectl', expect.any(Array), expect.objectContaining({ cwd: cwdB }));
  });

  it('dynamic permission grants belong to their session, even with a reused tool', async () => {
    const a = new ConfirmationService();
    const b = new ConfirmationService();
    vi.spyOn(a, 'requestConfirmation').mockResolvedValue({ confirmed: true });
    const denied = vi.spyOn(b, 'requestConfirmation').mockResolvedValue({ confirmed: false });
    const tool = await scoped(a, cwdA, async () => new RequestPermissionsTool());
    const request = { type: 'filesystem', target: '*', scope: 'session', reason: 'fixture' };
    expect((await scoped(a, cwdA, () => tool.execute(request))).success).toBe(true);
    expect(await scoped(a, cwdA, async () => hasPermission('filesystem', 'sample.txt'))).toBe(true);
    expect((await scoped(b, cwdB, () => tool.execute(request))).success).toBe(false);
    expect(denied).toHaveBeenCalledOnce();
    expect(await scoped(b, cwdB, async () => hasPermission('filesystem', 'sample.txt'))).toBe(false);
  });
});
