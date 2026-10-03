import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const input = vi.hoisted(() => ({ response: {} as unknown, npmFailed: true }));
vi.mock('node:child_process', () => ({
  execSync: () => {
    const stdout = JSON.stringify(input.response);
    if (input.npmFailed) throw Object.assign(new Error('npm audit failed'), { stdout });
    return stdout;
  },
}));
vi.mock('node:fs', () => ({ readFileSync: () => '{"allow":[]}' }));

function cleanAudit() {
  return { vulnerabilities: {}, metadata: { vulnerabilities: {
    info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0,
  } } };
}

describe('audit-gate : une réponse npm en erreur ne vaut jamais un audit vert', () => {
  beforeEach(() => {
    vi.resetModules();
    input.response = cleanAudit();
    input.npmFailed = true;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('audit refusé'); });
  });
  afterEach(() => vi.restoreAllMocks());

  async function runGate() {
    await import('../../scripts/ci-audit-gate.mjs');
  }

  it.each([
    { error: { code: 'ENETUNREACH', summary: 'network unavailable' } },
    {}, null, [], { vulnerabilities: {} },
    { ...cleanAudit(), error: { code: 'E401' } },
    { vulnerabilities: {}, metadata: { vulnerabilities: { high: 0, total: 0 } } },
    { ...cleanAudit(), vulnerabilities: { undici: { severity: 'high' } } },
    { vulnerabilities: {}, metadata: { vulnerabilities: {
      low: 0, moderate: 0, high: 1, critical: 0, total: 1,
    } } },
    { vulnerabilities: {}, metadata: { vulnerabilities: {
      low: 0, moderate: 0, high: -1, critical: 0, total: -1,
    } } },
  ])('refuse un document absent ou incohérent : %j', async (response) => {
    input.response = response;
    await expect(runGate()).rejects.toThrow('audit refusé');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('audit-gate: PASS'));
  });

  it('accepte un audit complet sans vulnérabilité', async () => {
    input.npmFailed = false;
    await runGate();
    expect(process.exit).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('audit-gate: PASS'));
  });

  it('conserve le JSON complet de npm malgré son code non nul pour les avis', async () => {
    input.response = {
      vulnerabilities: { undici: { severity: 'high', nodes: ['node_modules/undici'] } },
      metadata: { vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    };
    await expect(runGate()).rejects.toThrow('audit refusé');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not in audit-allowlist'));
  });
});
