import { describe, expect, it } from 'vitest';
import { NodeManager } from '../../src/nodes/index.js';

describe('NodeManager invocation', () => {
  it('fails instead of claiming dispatch when no live node transport is wired', async () => {
    const manager = new NodeManager();
    const pairing = manager.requestPairing('android', 'Phone');
    const node = manager.approvePairing(pairing.code);

    const result = await manager.invoke({
      nodeId: node.id,
      capability: 'camera.snap',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no live transport');
    expect(result.data).toBeUndefined();
  });
});
