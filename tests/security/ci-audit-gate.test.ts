import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const input = vi.hoisted(() => ({
  nodes: ['node_modules/npm/node_modules/undici'] as string[] | undefined,
  allowedNodes: ['node_modules/npm/node_modules/undici'] as string[] | undefined,
  severity: 'high',
  reviewBy: '2999-01-01',
  reviewedOn: '2026-01-01',
  reason: 'Only build-time fetch; no WebSocket calls. GHSA-rfgv-xxqx-mfg5',
  urls: ['https://github.com/advisories/GHSA-rfgv-xxqx-mfg5'],
  allowedUrls: ['https://github.com/advisories/GHSA-rfgv-xxqx-mfg5'] as string[] | undefined,
  inherited: false,
  error: false,
}));

vi.mock('node:child_process', () => ({
  execSync: () => JSON.stringify({
    ...(input.error ? { error: { code: 'E503' } } : {}),
    metadata: { vulnerabilities: { high: 1, critical: 0 } },
    vulnerabilities: {
      undici: {
        severity: input.severity, nodes: input.nodes,
        via: input.inherited ? ['child'] : input.urls.map((url) => ({ url })),
      },
      ...(input.inherited ? { child: { severity: 'moderate', via: input.urls.map((url) => ({ url })) } } : {}),
    },
  }),
}));
vi.mock('node:fs', () => ({
  readFileSync: () => JSON.stringify({
    allow: [{
      package: 'undici', nodes: input.allowedNodes, reviewBy: input.reviewBy,
      reviewedOn: input.reviewedOn, reason: input.reason, advisories: input.allowedUrls,
    }],
  }),
}));

describe('audit-gate : exception limitée à une copie d’outillage', () => {
  beforeEach(() => {
    vi.resetModules();
    input.nodes = ['node_modules/npm/node_modules/undici'];
    input.allowedNodes = ['node_modules/npm/node_modules/undici'];
    input.severity = 'high';
    input.reviewBy = '2999-01-01';
    input.reviewedOn = '2026-01-01';
    input.reason = 'Only build-time fetch; no WebSocket calls. GHSA-rfgv-xxqx-mfg5';
    input.urls = ['https://github.com/advisories/GHSA-rfgv-xxqx-mfg5'];
    input.allowedUrls = [...input.urls];
    input.inherited = false;
    input.error = false;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('audit refusé'); });
  });

  afterEach(() => vi.restoreAllMocks());

  async function runGate(): Promise<void> {
    await import('../../scripts/ci-audit-gate.mjs');
  }

  it('accepte la seule copie embarquée autorisée', async () => {
    await runGate();
    expect(process.exit).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('audit-gate: PASS'));
  });

  it('refuse une copie runtime même si le paquet et la copie npm sont autorisés', async () => {
    input.nodes!.push('node_modules/undici');
    await expect(runGate()).rejects.toThrow('audit refusé');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('outside the allowlisted scope'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it.each([undefined, []])('refuse un audit sans chemins vérifiables : %s', async (nodes) => {
    input.nodes = nodes;
    await expect(runGate()).rejects.toThrow('audit refusé');
  });

  it('refuse une exception expirée dans le bon périmètre', async () => {
    input.reviewBy = '2000-01-01';
    await expect(runGate()).rejects.toThrow('audit refusé');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });

  it('refuse toujours les avis critiques', async () => {
    input.severity = 'critical';
    await expect(runGate()).rejects.toThrow('audit refusé');
  });

  it.each([undefined, [], ['']])('refuse une exception sans périmètre explicite : %s', async (nodes) => {
    input.allowedNodes = nodes;
    await expect(runGate()).rejects.toThrow('audit refusé');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('outside the allowlisted scope'));
  });

  it('refuse un nouvel avis sur la copie déjà autorisée', async () => {
    input.urls.push('https://github.com/advisories/GHSA-new-advisory');
    await expect(runGate()).rejects.toThrow('audit refusé');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('advisory outside'));
  });

  it('contrôle aussi les avis hérités des dépendances', async () => {
    input.inherited = true;
    await runGate();
    vi.resetModules();
    input.urls.push('https://github.com/advisories/GHSA-new-advisory');
    await expect(runGate()).rejects.toThrow('audit refusé');
  });

  it.each(['motif', 'date', 'avis', 'erreur npm'])('refuse une exception ou un audit incomplet : %s', async (field) => {
    if (field === 'motif') input.reason = '';
    if (field === 'date') input.reviewedOn = '';
    if (field === 'avis') input.allowedUrls = undefined;
    if (field === 'erreur npm') input.error = true;
    await expect(runGate()).rejects.toThrow('audit refusé');
  });
});
