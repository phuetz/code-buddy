import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn() }));
function child() {
  return Object.assign(new EventEmitter(), { pid: 43210, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
}
const editor = () => new Response('<title>Workflow Automation Platform - Enterprise-Grade Workflow Builder</title>');
let service: typeof import('../src/main/workflow-service').WorkflowService;
let fetchMock: ReturnType<typeof vi.fn>;
let processChild: ReturnType<typeof child>;
let kill: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubEnv('CODEBUDDY_WORKFLOW_URL', '');
  vi.stubEnv('CODEBUDDY_WORKFLOW_DIR', '/isolated/workflow');
  processChild = child(); mocks.spawn.mockReturnValue(processChild);
  fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
  vi.stubGlobal('fetch', fetchMock);
  kill = vi.spyOn(process, 'kill').mockImplementation(() => {
    queueMicrotask(() => processChild.emit('close', 0)); return true;
  });
  service = (await import('../src/main/workflow-service')).WorkflowService;
});
afterEach(async () => {
  processChild.emit('close', 0); await service.stop();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
describe('WorkflowService readiness and ownership', () => {
  it('keeps the legacy launch port without claiming any existing service', async () => {
    expect(await service.status()).toMatchObject({ running: false, port: 8080, url: 'http://127.0.0.1:8080/', managed: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('connects to the configured URL without starting or stopping its external service', async () => {
    vi.stubEnv('CODEBUDDY_WORKFLOW_URL', 'http://127.0.0.1:18080/editor/');
    fetchMock.mockImplementation(async () => editor());
    expect(await service.start()).toEqual({ success: true });
    expect(await service.status()).toMatchObject({ running: true, port: 18080, url: 'http://127.0.0.1:18080/editor/', managed: false, external: true });
    await service.stop();
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled();
  });
  it('rejects HTTP 200 from OpenWebUI', async () => {
    vi.stubEnv('CODEBUDDY_WORKFLOW_URL', 'http://localhost:8080');
    fetchMock.mockImplementation(async () => new Response('<title>Open WebUI</title>'));
    expect(await service.start()).toMatchObject({ success: false, error: expect.stringContaining('not the WorkflowBuilder') });
    expect(await service.status()).toMatchObject({ running: false });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('refuses to launch on an occupied legacy URL', async () => {
    fetchMock.mockResolvedValue(editor());
    expect(await service.start()).toMatchObject({ success: false, error: expect.stringContaining('already occupied') });
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled();
  });
  it('waits for readiness and coalesces concurrent starts', async () => {
    const pending = service.start(); expect(service.start()).toBe(pending);
    let finished = false; void pending.then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith('npm', ['run', 'dev'], expect.objectContaining({ cwd: '/isolated/workflow', shell: false, detached: true }));
    expect(finished).toBe(false);
    expect(await service.status()).toMatchObject({ running: false, starting: true });
    fetchMock.mockImplementation(async () => editor());
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toEqual({ success: true });
    expect(await service.status()).toMatchObject({ running: true, managed: true });
  });
  it('handles asynchronous spawn errors', async () => {
    const pending = service.start(); await vi.advanceTimersByTimeAsync(0);
    processChild.emit('error', new Error('spawn npm ENOENT'));
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('ENOENT') });
    expect(await service.status()).toMatchObject({ running: false, managed: false });
    expect(service.logs().lines.join('\n')).toContain('ENOENT');
  });
  it('reports an early close as a failed start', async () => {
    const pending = service.start(); await vi.advanceTimersByTimeAsync(0);
    processChild.emit('close', 1);
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('code 1') });
  });
  it('cancels startup and signals only the group it created', async () => {
    const pending = service.start(); await vi.advanceTimersByTimeAsync(0);
    expect(await service.stop()).toEqual({ success: true });
    expect(await pending).toMatchObject({ success: false });
    expect(kill).toHaveBeenCalledWith(-43210, 'SIGTERM');
    expect(await service.status()).toMatchObject({ running: false, managed: false });
  });
  it('bounds startup time when the editor never becomes available', async () => {
    const pending = service.start(); await vi.advanceTimersByTimeAsync(30500);
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('Timed out') });
    expect(kill).toHaveBeenCalledTimes(1);
  });
  it('does not let an old close event clear a new owned process', async () => {
    const old = processChild;
    let pending = service.start(); await vi.advanceTimersByTimeAsync(0);
    old.emit('error', new Error('ENOENT')); await pending;
    processChild = child(); mocks.spawn.mockReturnValue(processChild);
    pending = service.start(); await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockImplementation(async () => editor()); await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toEqual({ success: true }); old.emit('close', -1);
    expect(await service.status()).toMatchObject({ running: true, managed: true });
  });
  it('rechecks availability after startup', async () => {
    const pending = service.start(); await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockImplementation(async () => editor()); await vi.advanceTimersByTimeAsync(250); await pending;
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await service.status()).toMatchObject({ running: false, managed: true });
  });
  it('rejects malformed or unsafe URLs before network or process activity', async () => {
    for (const url of ['file:///etc/passwd', 'http://user:password@localhost:18080', 'not a URL']) {
      vi.stubEnv('CODEBUDDY_WORKFLOW_URL', url);
      expect(await service.start()).toMatchObject({ success: false });
    }
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('bounds response body and logs, including zero and invalid log limits', async () => {
    vi.stubEnv('CODEBUDDY_WORKFLOW_URL', 'http://localhost:18080');
    fetchMock.mockResolvedValue(new Response('x'.repeat(65536) + '<title>WorkflowBuilder</title>'));
    expect(await service.start()).toMatchObject({ success: false });
    vi.stubEnv('CODEBUDDY_WORKFLOW_URL', ''); fetchMock.mockRejectedValue(new Error('offline'));
    const pending = service.start(); await vi.advanceTimersByTimeAsync(0);
    processChild.stdout.emit('data', 'x'.repeat(3000) + '\n');
    expect(service.logs(1).lines[0]).toHaveLength(2048);
    processChild.stdout.emit('data', Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'));
    expect(service.logs(10000).lines).toHaveLength(200);
    expect(service.logs(0).lines).toEqual([]); expect(service.logs(-1).lines).toEqual([]);
    expect(service.logs(NaN).lines).toHaveLength(50);
    await service.stop(); await pending;
  });
  it.each([
    { 'x-frame-options': 'DENY' },
    { 'x-frame-options': 'SAMEORIGIN' },
    { 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" },
    { 'content-security-policy': "frame-ancestors 'self'" },
  ])('detects restrictive framing policy %j while keeping the editor available', async (headers) => {
    vi.stubEnv('CODEBUDDY_WORKFLOW_URL', 'http://localhost:18080');
    fetchMock.mockImplementation(async () => new Response('<title>WorkflowBuilder</title>', { headers }));
    expect(await service.status()).toMatchObject({ running: true, embeddable: false, managed: false });
  });
  it('allows embedding when no restrictive framing headers are present', async () => {
    vi.stubEnv('CODEBUDDY_WORKFLOW_URL', 'http://localhost:18080');
    fetchMock.mockImplementation(async () => editor());
    expect(await service.status()).toMatchObject({ running: true, embeddable: true });
  });

  it('aborts a stalled identity probe within its request timeout', async () => {
    vi.stubEnv('CODEBUDDY_WORKFLOW_URL', 'http://localhost:18080');
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = service.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toMatchObject({ success: false });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

});
