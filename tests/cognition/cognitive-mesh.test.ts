import { describe, expect, it } from 'vitest';
import { CognitiveMesh } from '../../src/cognition/cognitive-mesh.js';
import { GlobalWorkspace } from '../../src/cognition/global-workspace.js';
import type { WorkspaceDraft } from '../../src/cognition/types.js';

function percept(correlationId: string, salience = 0.5): WorkspaceDraft {
  return {
    kind: 'percept',
    producerId: 'sense',
    correlationId,
    salience,
    confidence: 1,
    privacy: 'local-only',
    provenance: { source: 'test' },
    payload: { modality: 'vision' },
  };
}

async function turn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('CognitiveMesh', () => {
  it('starts independent specialists in parallel and preserves privacy on their results', async () => {
    const workspace = new GlobalWorkspace();
    const mesh = new CognitiveMesh(workspace);
    const started: string[] = [];
    let releaseVision!: () => void;
    let releaseMemory!: () => void;
    const visionGate = new Promise<void>((resolve) => (releaseVision = resolve));
    const memoryGate = new Promise<void>((resolve) => (releaseMemory = resolve));
    mesh.register({
      id: 'vision-specialist',
      role: 'vision',
      subscriptions: ['percept'],
      activate: async ({ trigger }) => {
        started.push('vision');
        await visionGate;
        return [{
          kind: 'hypothesis',
          producerId: 'vision-specialist',
          correlationId: trigger.correlationId,
          salience: 0.8,
          confidence: 0.7,
          privacy: 'cloud-ok',
          provenance: { source: 'vision-model' },
          payload: { label: 'person' },
        }];
      },
    });
    mesh.register({
      id: 'memory-specialist',
      role: 'memory',
      subscriptions: ['percept'],
      activate: async () => {
        started.push('memory');
        await memoryGate;
      },
    });

    mesh.publish(percept('parallel'));
    await turn();
    expect(started).toEqual(['vision', 'memory']);
    expect(mesh.metrics().map((metric) => metric.active)).toEqual([1, 1]);
    // Simulate a slow specialist whose private trigger has left the workspace.
    workspace.pruneExpired(Date.now() + 60_000);
    releaseVision();
    releaseMemory();
    await turn();
    const hypothesis = workspace.snapshot({ kinds: ['hypothesis'] })[0];
    expect(hypothesis?.privacy).toBe('local-only');
    expect(hypothesis?.provenance.derivedFrom).toHaveLength(1);
    mesh.stop();
  });

  it('never overlaps one stateful specialist with itself', async () => {
    const mesh = new CognitiveMesh(new GlobalWorkspace());
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mesh.register({
      id: 'single-writer',
      role: 'world model',
      subscriptions: ['percept'],
      activate: async ({ trigger }) => {
        started.push(trigger.correlationId);
        if (trigger.correlationId === 'first') await gate;
      },
    });
    mesh.publish(percept('first'));
    mesh.publish(percept('second'));
    await turn();
    expect(started).toEqual(['first']);
    release();
    await turn();
    expect(started).toEqual(['first', 'second']);
    mesh.stop();
  });

  it('bounds a flooded visual mailbox without starving the audio lane', async () => {
    const mesh = new CognitiveMesh(new GlobalWorkspace());
    const started: string[] = [];
    mesh.register({
      id: 'vision',
      role: 'vision',
      subscriptions: ['percept'],
      mailboxCapacity: 2,
      overflow: 'drop-lowest-salience',
      activate: async ({ trigger }) => void started.push(`vision:${trigger.correlationId}`),
    });
    mesh.register({
      id: 'hearing',
      role: 'hearing',
      subscriptions: ['utterance'],
      mailboxCapacity: 8,
      activate: async ({ trigger }) => void started.push(`audio:${trigger.correlationId}`),
    });
    for (let i = 0; i < 100; i++) mesh.publish(percept(`frame-${i}`, i / 100));
    mesh.publish({ ...percept('speech'), kind: 'utterance', salience: 1 });
    await turn();
    expect(started).toContain('audio:speech');
    expect(mesh.metrics().find((metric) => metric.id === 'vision')?.dropped).toBeGreaterThan(0);
    mesh.stop();
  });

  it('aborts active specialists when stopped', async () => {
    const mesh = new CognitiveMesh(new GlobalWorkspace());
    let aborted = false;
    mesh.register({
      id: 'planner',
      role: 'planner',
      subscriptions: ['goal'],
      activate: ({ signal }) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        }),
    });
    mesh.publish({ ...percept('goal'), kind: 'goal' });
    await turn();
    mesh.stop();
    await turn();
    expect(aborted).toBe(true);
  });
});
