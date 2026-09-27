import { describe, expect, it } from 'vitest';
import { buildHermesParityManifest, buildHermesParityTodo } from '../../src/agent/hermes-parity-manifest.js';

describe('hermes parity manifest', () => {
  it('counts each feature exactly once', () => {
    const manifest = buildHermesParityManifest('2026-07-04T00:00:00Z');
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.generatedAt).toBe('2026-07-04T00:00:00Z');
    expect(manifest.summary.total).toBe(manifest.features.length);
  });

  it('reports an empty active todo list when all items are inactive', () => {
    const todo = buildHermesParityTodo();
    expect(todo.summary.activeTodoCount).toBe(0);
    expect(todo.todos).toEqual([]);
  });
});
