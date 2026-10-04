import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

describe('dependency audit in GitHub workflows', () => {
  it.each([
    ['ci.yml', 'security'],
    ['security.yml', 'security_scan'],
  ])('enforces the same scoped audit policy in %s', (file, jobName) => {
    const workflow = parse(readFileSync(resolve(import.meta.dirname, '../../.github/workflows', file), 'utf8'));
    const job = workflow.jobs[jobName];
    const audits = job.steps.filter((step: { run?: string }) => step.run?.includes('ci-audit-gate.mjs'));

    expect(audits).toHaveLength(1);
    expect(audits[0].run).toBe('node scripts/ci-audit-gate.mjs');
    expect(audits[0]['continue-on-error']).toBeUndefined();
    expect(audits[0].if).toBeUndefined();
    expect(job['continue-on-error']).toBeUndefined();
    expect(job.if).toBeUndefined();
  });
});
