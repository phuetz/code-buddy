import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeManager } from '../../src/nodes/index.js';

describe('node pairing across CLI processes', () => {
  it('restores pending requests and paired nodes without claiming a live transport', () => {
    const dir = mkdtempSync(join(tmpdir(), 'buddy-nodes-'));
    const persistPath = join(dir, 'nodes.json');
    try {
      const first = new NodeManager({ persistPath });
      const request = first.requestPairing('linux', 'fixture');
      const second = new NodeManager({ persistPath });
      expect(second.getPendingPairings().map((item) => item.code)).toContain(request.code);
      const node = second.approvePairing(request.code);
      const third = new NodeManager({ persistPath });
      expect(third.getPendingPairings()).toEqual([]);
      expect(third.getNode(node.id)?.status).toBe('offline');
      expect(third.removeNode(node.id)).toBe(true);
      expect(new NodeManager({ persistPath }).listNodes()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
