import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const input = vi.hoisted(() => ({
  nodes: ['node_modules/npm/node_modules/undici'] as string[] | undefined,
  allowedNodes: ['node_modules/npm/node_modules/undici'] as string[] | undefined,
  severity: 'high',
  reviewBy: '2999-01-01',
}));

vi.mock('node:child_process', () => ({
  execSync: () => JSON.stringify({
    vulnerabilities: { undici: { severity: input.severity, nodes: input.nodes } },
    metadata: { vulnerabilities: {
      info: 0, low: 0, moderate: 0, high: input.severity === 'high' ? 1 : 0,
      critical: input.severity === 'critical' ? 1 : 0, total: 1,
    } },
  }),
}));
vi.mock('node:fs', () => ({
  readFileSync: () => JSON.stringify({
    allow: [{ package: 'undici', nodes: input.allowedNodes, reviewBy: input.reviewBy }],
  }),
}));

describe('audit-gate : exception limitée à une copie d’outillage', () => {
  beforeEach(() => {
    vi.resetModules();
    input.nodes = ['node_modules/npm/node_modules/undici'];
    input.allowedNodes = ['node_modules/npm/node_modules/undici'];
    input.severity = 'high';
    input.reviewBy = '2999-01-01';
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

  it('conserve les exceptions historiques sans restriction de chemins', async () => {
    input.allowedNodes = undefined;
    await runGate();
    expect(process.exit).not.toHaveBeenCalled();
  });
});
