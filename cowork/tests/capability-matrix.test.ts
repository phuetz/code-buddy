import { describe, expect, it } from 'vitest';

import { buildMatrix, coverageOf } from '../src/renderer/components/os/util/capability-matrix.js';
import type { Peer } from '../src/renderer/components/os/util/fleet-model.js';

const peers: Peer[] = [
  { id: 'a', label: 'Alpha', status: 'online', role: 'hub', utilization: 0.2, models: ['gpt'], tools: ['search'] },
  { id: 'b', label: 'Beta', status: 'busy', role: 'code', utilization: 0.7, capabilities: ['review'] },
];

describe('capability-matrix', () => {
  it('builds peer by capability cells with source labels', () => {
    expect(buildMatrix(peers, ['gpt', 'review'])[0]).toEqual([
      { peerId: 'a', capability: 'gpt', available: true, source: 'model' },
      { peerId: 'a', capability: 'review', available: false, source: 'missing' },
    ]);
  });

  it('computes fleet coverage ratio', () => {
    expect(coverageOf('review', peers)).toBe(0.5);
    expect(coverageOf('missing', [])).toBe(0);
  });
});
