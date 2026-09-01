import { describe, expect, it } from 'vitest';
import { SensoryMemory } from '../../src/sensory/sensory-memory.js';

describe('SensoryMemory', () => {
  it('keeps only the newest perceptions within its fixed capacity', () => {
    const memory = new SensoryMemory(3);
    for (let beat = 1; beat <= 4; beat += 1) {
      memory.push({ modality: 'vital', kind: 'heartbeat', payload: { beat } });
    }

    expect(memory.size()).toBe(3);
    expect(memory.snapshot().map((perception) => (perception.payload as { beat: number }).beat)).toEqual([
      2, 3, 4,
    ]);
  });

  it('does not expose its array and drain releases the complete window', () => {
    const memory = new SensoryMemory(2);
    memory.push({ modality: 'audio', kind: 'speech_start' });
    const snapshot = memory.snapshot();
    snapshot.length = 0;

    expect(memory.size()).toBe(1);
    expect(memory.drain()).toHaveLength(1);
    expect(memory.size()).toBe(0);
  });
});
