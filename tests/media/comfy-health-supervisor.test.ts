import {
  ComfyHealthConfigurationError,
  ComfyHealthSupervisor,
  createComfyProcessOwnershipAuthority,
  diagnoseComfyHealth,
  findZeroByteComfyModels,
  type ComfyModelFileSnapshot,
} from '../../src/media/comfy-health-supervisor.js';

function responseWithUrl(body: unknown, url: string, status = 200): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  Object.defineProperty(response, 'url', { value: url, configurable: true });
  return response;
}

function healthyFetch(options: {
  runningIds?: string[];
  pendingIds?: string[];
  systemStatus?: number;
  objectInfo?: unknown;
} = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (url.pathname === '/queue') {
      const running = (options.runningIds ?? []).map((id, index) => [index, id, { secretPrompt: 'never-returned' }]);
      const pending = (options.pendingIds ?? []).map((id, index) => [index, id, { secretPrompt: 'never-returned' }]);
      return responseWithUrl(
        { queue_running: running, queue_pending: pending },
        url.href,
      );
    }
    if (url.pathname === '/system_stats') {
      return responseWithUrl(
        options.systemStatus === undefined ? { devices: [{ name: 'local-gpu' }] } : { error: 'failed' },
        url.href,
        options.systemStatus ?? 200,
      );
    }
    if (url.pathname === '/object_info') {
      return responseWithUrl(options.objectInfo ?? { KSampler: {}, SaveImage: {} }, url.href);
    }
    return responseWithUrl({ error: 'not found' }, url.href, 404);
  }) as typeof fetch;
}

describe('ComfyHealthSupervisor', () => {
  it('probes the three fixed endpoints and reports a healthy local server', async () => {
    const fetchImpl = healthyFetch();
    const report = await diagnoseComfyHealth({
      baseUrl: 'http://127.0.0.1:8188',
      fetch: fetchImpl,
      now: () => 1_000,
    });

    expect(report.state).toBe('healthy');
    expect(report.baseOrigin).toBe('http://127.0.0.1:8188');
    expect(report.probes).toHaveLength(3);
    expect(report.probes.every((probe) => probe.ok)).toBe(true);
    expect(report.nodeCount).toBe(2);
    expect(report.queue).toEqual({ runningCount: 0, pendingCount: 0, stale: false, staleForMs: 0 });
    expect(report.restartRecommended).toBe(false);
    expect(report.restartAllowed).toBe(false);

    const calledPaths = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls
      .map(([input]) => new URL(input instanceof URL ? input.href : String(input)).pathname)
      .sort();
    expect(calledPaths).toEqual(['/object_info', '/queue', '/system_stats']);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.4:8188',
    'http://192.168.1.20:8188',
    'http://example.com:8188',
    'http://127.0.0.1.evil.example:8188',
    'file:///tmp/comfy.sock',
    'http://user:password@127.0.0.1:8188',
    'http://127.0.0.1:8188/api',
    'http://127.0.0.1:8188/?token=secret',
  ])('rejects non-origin or non-loopback target %s before fetch', async (baseUrl) => {
    const fetchImpl = vi.fn();
    await expect(diagnoseComfyHealth({ baseUrl, fetch: fetchImpl as typeof fetch })).rejects.toBeInstanceOf(
      ComfyHealthConfigurationError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts only loopback HTTP origins, including IPv6 loopback', async () => {
    const ipv6Fetch = healthyFetch();
    const report = await diagnoseComfyHealth({ baseUrl: 'http://[::1]:8188', fetch: ipv6Fetch });
    expect(report.state).toBe('healthy');
    expect(report.baseOrigin).toBe('http://[::1]:8188');
  });

  it('rejects a response that claims a different origin even from an injected transport', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      responseWithUrl({ queue_running: [], queue_pending: [] }, 'http://169.254.169.254/queue'),
    ) as typeof fetch;

    const report = await diagnoseComfyHealth({ fetch: fetchImpl });

    expect(report.state).toBe('unreachable');
    expect(report.probes.every((probe) => probe.errorCode === 'response_origin_rejected')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('169.254.169.254');
  });

  it('times out all probes even when the transport never settles on its own', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('transport aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
    ) as typeof fetch;
    const startedAt = Date.now();

    const report = await diagnoseComfyHealth({ fetch: fetchImpl, requestTimeoutMs: 10 });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(report.state).toBe('unreachable');
    expect(report.probes.every((probe) => probe.errorCode === 'timeout')).toBe(true);
    expect(report.probes.every((probe) => probe.error === 'Timed out after 10ms')).toBe(true);
  });

  it('marks a partially responsive server degraded rather than poisoned', async () => {
    const report = await diagnoseComfyHealth({ fetch: healthyFetch({ systemStatus: 500 }) });

    expect(report.state).toBe('degraded');
    expect(report.poisonDetected).toBe(false);
    expect(report.probes.find((probe) => probe.endpoint === 'system_stats')).toMatchObject({
      ok: false,
      statusCode: 500,
      errorCode: 'http_error',
      error: 'HTTP 500',
    });
  });

  it('rejects invalid endpoint shapes without echoing their payload', async () => {
    const secret = `sk-${'a'.repeat(32)}`;
    const report = await diagnoseComfyHealth({
      fetch: healthyFetch({ objectInfo: { error: secret } }),
    });

    // A non-empty object is valid object_info; the server may expose any node names.
    expect(report.state).toBe('healthy');
    expect(JSON.stringify(report)).not.toContain(secret);

    const invalidFetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input instanceof URL ? input.href : String(input));
      if (url.pathname === '/queue') return responseWithUrl({ queue_running: 'bad', queue_pending: [] }, url.href);
      if (url.pathname === '/system_stats') return responseWithUrl([], url.href);
      return responseWithUrl({}, url.href);
    }) as typeof fetch;
    const invalid = await diagnoseComfyHealth({ fetch: invalidFetch });
    expect(invalid.state).toBe('unreachable');
    expect(invalid.probes.every((probe) => probe.errorCode === 'invalid_response')).toBe(true);
  });

  it('bounds response bodies before parsing JSON', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input instanceof URL ? input.href : String(input));
      return responseWithUrl({ padding: 'x'.repeat(2_000) }, url.href);
    }) as typeof fetch;

    const report = await diagnoseComfyHealth({ fetch: fetchImpl, maxResponseBytes: 1_024 });

    expect(report.state).toBe('unreachable');
    expect(report.probes.every((probe) => probe.errorCode === 'response_too_large')).toBe(true);
  });

  it('detects a stale active queue from injected temporal snapshots without exposing prompt IDs', async () => {
    let now = 10_000;
    const secretPromptId = `prompt-${'secret'.repeat(20)}`;
    const supervisor = new ComfyHealthSupervisor({
      fetch: healthyFetch({ runningIds: [secretPromptId] }),
      staleQueueAfterMs: 100,
      now: () => now,
    });

    const first = await supervisor.probe();
    expect(first.state).toBe('healthy');
    expect(first.queue?.stale).toBe(false);

    now += 99;
    const almost = await supervisor.probe();
    expect(almost.queue?.stale).toBe(false);

    now += 1;
    const stale = await supervisor.probe();
    expect(stale.state).toBe('degraded');
    expect(stale.queue).toMatchObject({ stale: true, staleForMs: 100, runningCount: 1 });
    expect(stale.issues.some((issue) => issue.code === 'queue_stale')).toBe(true);
    expect(JSON.stringify(stale)).not.toContain(secretPromptId);

    now += 1;
    const progressed = await supervisor.probe({ progressMarker: 'executing-node-7' });
    expect(progressed.queue?.stale).toBe(false);
    expect(progressed.queue?.staleForMs).toBe(0);
  });

  it('supports explicit queue snapshot injection for stateless callers', async () => {
    const fetchImpl = healthyFetch({ pendingIds: ['pending-1'] });
    const first = await diagnoseComfyHealth({ fetch: fetchImpl, now: () => 1_000, staleQueueAfterMs: 100 });
    expect(first.queueSnapshot).toBeDefined();

    const second = await diagnoseComfyHealth(
      { fetch: fetchImpl, now: () => 1_100, staleQueueAfterMs: 100 },
      { previousQueueSnapshot: first.queueSnapshot },
    );
    expect(second.queue?.stale).toBe(true);
  });

  it('detects only zero-byte model files from a safe relative inventory', async () => {
    const modelFiles: ComfyModelFileSnapshot[] = [
      { relativePath: 'diffusion_models/wan2.2-14b-Q4_K_M.gguf', sizeBytes: 0 },
      { relativePath: 'checkpoints/flux_hq/flux1-dev-fp8.safetensors', sizeBytes: 0 },
      { relativePath: 'checkpoints/sd_turbo.safetensors', sizeBytes: 5_214_561_328 },
      { relativePath: 'controlnet/put_controlnets_here', sizeBytes: 0 },
      { relativePath: '../../etc/passwd', sizeBytes: 0 },
      { relativePath: '/home/patrice/private/model.gguf', sizeBytes: 0 },
      { relativePath: 'directory.gguf', sizeBytes: 0, kind: 'directory' },
    ];

    const report = await diagnoseComfyHealth({ fetch: healthyFetch() }, { modelFiles });

    expect(report.state).toBe('degraded');
    expect(report.zeroByteModelCount).toBe(2);
    expect(report.zeroByteModels).toEqual([
      'checkpoints/flux_hq/flux1-dev-fp8.safetensors',
      'diffusion_models/wan2.2-14b-Q4_K_M.gguf',
    ]);
    expect(report.issues.some((issue) => issue.code === 'invalid_model_inventory')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('/home/patrice');
  });

  it('provides a pure zero-byte inventory helper', () => {
    expect(findZeroByteComfyModels([
      { relativePath: 'a/model.gguf', sizeBytes: 0 },
      { relativePath: 'b/model.json', sizeBytes: 0 },
      { relativePath: 'c/model.gguf', sizeBytes: 10 },
    ])).toMatchObject({
      zeroByteModels: ['a/model.gguf'],
      zeroByteModelCount: 1,
      invalidCount: 0,
    });
  });

  it('classifies bounded ROCm/HIP symptoms as poisoned and redacts diagnostic secrets', async () => {
    const openAiKey = `sk-${'a'.repeat(32)}`;
    const bearer = `Bearer ${'b'.repeat(40)}`;
    const raw = [
      `torch.AcceleratorError: CUDA error: an illegal memory access was encountered ${openAiKey} ${bearer}`,
      `details at /home/patrice/private token=plain-secret-value ${'x'.repeat(1_000)}`,
    ];

    const report = await diagnoseComfyHealth({ fetch: healthyFetch() }, { runtimeErrors: raw });
    const serialized = JSON.stringify(report);

    expect(report.state).toBe('poisoned');
    expect(report.poisonDetected).toBe(true);
    expect(report.restartRecommended).toBe(true);
    expect(report.restartAllowed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'runtime_accelerator_poisoned')).toBe(true);
    expect(serialized).not.toContain(openAiKey);
    expect(serialized).not.toContain('b'.repeat(40));
    expect(serialized).not.toContain('/home/patrice');
    expect(serialized).not.toContain('plain-secret-value');
    expect(report.issues.every((issue) => issue.message.length <= 320)).toBe(true);
  });

  it('limits supplied runtime errors and degrades on a generic runtime failure', async () => {
    const runtimeErrors = Array.from({ length: 30 }, (_, index) => `ordinary runtime failure ${index}`);
    const report = await diagnoseComfyHealth({ fetch: healthyFetch() }, { runtimeErrors });

    expect(report.state).toBe('degraded');
    expect(report.runtimeErrorCount).toBe(16);
    expect(report.issues.filter((issue) => issue.code === 'runtime_error')).toHaveLength(16);
  });

  it('allows restart only for a poisoned/unreachable process with a live private ownership proof', async () => {
    const authority = createComfyProcessOwnershipAuthority();
    const proof = authority.issue('comfy-managed-42');
    const runtimeErrors = ['hipErrorIllegalAddress in managed process'];
    const options = {
      fetch: healthyFetch(),
      ownershipAuthority: { verify: authority.verify },
    };

    const missing = await diagnoseComfyHealth(options, { runtimeErrors });
    expect(missing.restartAllowed).toBe(false);
    expect(missing.ownershipVerified).toBe(false);

    const forged = await diagnoseComfyHealth(options, {
      runtimeErrors,
      ownership: { processInstanceId: 'comfy-managed-42', proof: {} },
    });
    expect(forged.restartAllowed).toBe(false);

    const wrongInstance = await diagnoseComfyHealth(options, {
      runtimeErrors,
      ownership: { processInstanceId: 'comfy-managed-43', proof },
    });
    expect(wrongInstance.restartAllowed).toBe(false);

    const serializedProof = JSON.parse(JSON.stringify(proof)) as unknown;
    const roundTripped = await diagnoseComfyHealth(options, {
      runtimeErrors,
      ownership: { processInstanceId: 'comfy-managed-42', proof: serializedProof },
    });
    expect(roundTripped.restartAllowed).toBe(false);

    const owned = await diagnoseComfyHealth(options, {
      runtimeErrors,
      ownership: { processInstanceId: 'comfy-managed-42', proof },
    });
    expect(owned.state).toBe('poisoned');
    expect(owned.ownershipVerified).toBe(true);
    expect(owned.restartAllowed).toBe(true);

    authority.revoke(proof);
    const revoked = await diagnoseComfyHealth(options, {
      runtimeErrors,
      ownership: { processInstanceId: 'comfy-managed-42', proof },
    });
    expect(revoked.restartAllowed).toBe(false);
  });

  it('does not permit a restart for a healthy process even with valid ownership', async () => {
    const authority = createComfyProcessOwnershipAuthority();
    const proof = authority.issue('healthy-owned-process');
    const report = await diagnoseComfyHealth(
      { fetch: healthyFetch(), ownershipAuthority: authority },
      { ownership: { processInstanceId: 'healthy-owned-process', proof } },
    );

    expect(report.state).toBe('healthy');
    expect(report.ownershipVerified).toBe(true);
    expect(report.restartRecommended).toBe(false);
    expect(report.restartAllowed).toBe(false);
  });
});
