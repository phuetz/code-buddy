import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PolicyEngine } from '../../src/security/policy-engine.js';

describe('PolicyEngine', () => {
  let policyEngine: PolicyEngine;

  beforeEach(() => {
    policyEngine = PolicyEngine.getInstance();
    policyEngine.releaseKillSwitch();
  });

  afterEach(() => {
    policyEngine.releaseKillSwitch();
  });

  it('should default to singleton instance', () => {
    const instance1 = PolicyEngine.getInstance();
    const instance2 = PolicyEngine.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should evaluate fs:read as allow', () => {
    const result = policyEngine.evaluate({
      capability: 'fs:read',
      risk: 'low',
    });
    expect(result.decision).toBe('allow');
  });

  it('should evaluate fs:write:scoped low risk as allow', () => {
    const result = policyEngine.evaluate({
      capability: 'fs:write:scoped',
      risk: 'low',
    });
    expect(result.decision).toBe('allow');
  });

  it('should evaluate fs:write:scoped medium/high risk as needs_approval', () => {
    const resultMedium = policyEngine.evaluate({
      capability: 'fs:write:scoped',
      risk: 'medium',
    });
    expect(resultMedium.decision).toBe('needs_approval');

    const resultHigh = policyEngine.evaluate({
      capability: 'fs:write:scoped',
      risk: 'high',
    });
    expect(resultHigh.decision).toBe('needs_approval');
  });

  it('should allow only explicitly low-risk shell operations', () => {
    const result = policyEngine.evaluate({
      capability: 'shell:safe',
      risk: 'low',
    });
    expect(result.decision).toBe('allow');
  });

  it('should require approval for medium/high-risk shell operations', () => {
    expect(policyEngine.evaluate({ capability: 'shell:safe', risk: 'medium' }).decision)
      .toBe('needs_approval');
    expect(policyEngine.evaluate({ capability: 'shell:safe', risk: 'high' }).decision)
      .toBe('needs_approval');
  });

  it('should evaluate net:listed, fleet:listen, peer:invoke as needs_approval', () => {
    expect(policyEngine.evaluate({ capability: 'net:listed', risk: 'low' }).decision).toBe('needs_approval');
    expect(policyEngine.evaluate({ capability: 'fleet:listen', risk: 'low' }).decision).toBe('needs_approval');
    expect(policyEngine.evaluate({ capability: 'peer:invoke', risk: 'low' }).decision).toBe('needs_approval');
  });

  it('should evaluate unknown capabilities as needs_approval', () => {
    const result = policyEngine.evaluate({
      capability: 'fs:delete-system' as any,
      risk: 'high',
    });
    expect(result.decision).toBe('needs_approval');
    expect(result.reason).toContain('Unknown capability');
  });

  it('should block everything with deny when kill switch is engaged', () => {
    policyEngine.engageKillSwitch('Emergency termination');
    expect(policyEngine.isKilled()).toBe(true);

    const result = policyEngine.evaluate({
      capability: 'fs:read',
      risk: 'low',
    });
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('Kill switch engaged: Emergency termination');
  });

  it('should detect secrets or deployment and override to needs_approval', () => {
    const resultEnv = policyEngine.evaluate({
      capability: 'fs:read',
      risk: 'low',
      detail: { path: '/workspace/.env' },
    });
    expect(resultEnv.decision).toBe('needs_approval');

    const resultDeploy = policyEngine.evaluate({
      capability: 'shell:safe',
      risk: 'low',
      detail: { command: 'npm run deploy' },
    });
    expect(resultDeploy.decision).toBe('needs_approval');
  });
});
