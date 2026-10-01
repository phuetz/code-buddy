import { describe, expect, it } from 'vitest';
import { SandboxPathBridge } from '../../src/desktop/sandbox-bridge';
import path from 'path';

describe('SandboxBridge prefix matching', () => {
  it('toSandboxPath should not misidentify sibling prefix', () => {
    const bridge = new SandboxPathBridge({
      enabled: true,
      type: 'wsl',
      sandboxMountPath: '/mnt/workspace',
      hostPath: '/work/proj',
    });
    const hostPath = '/work/proj-evil/x';
    const sandboxPath = bridge.toSandboxPath(hostPath);
    // Before fix it would return '/mnt/workspace-evil/x'
    expect(sandboxPath).toBe(hostPath); // Because it should not be mounted!
  });

  it('toHostPath should not misidentify sibling prefix', () => {
    const bridge = new SandboxPathBridge({
      enabled: true,
      type: 'wsl',
      sandboxMountPath: '/mnt/workspace',
      hostPath: '/work/proj',
    });
    const sandboxPath = '/mnt/workspace2/f';
    const hostPath = bridge.toHostPath(sandboxPath);
    // Before fix it would return '/work/proj2/f'
    expect(hostPath).toBe(sandboxPath); // Should not be mapped back!
  });
});
