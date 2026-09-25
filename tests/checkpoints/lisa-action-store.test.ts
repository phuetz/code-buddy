import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LisaActionStore, lisaUnifiedCheckpointsEnabled } from '../../src/checkpoints/lisa-action-store.js';

const roots: string[] = [];
function fixture(): { root: string; store: LisaActionStore; target: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-return-'));
  roots.push(root);
  return { root, store: new LisaActionStore(root, path.join(root, 'history')), target: path.join(root, 'work.txt') };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Lisa action return points', () => {
  it('leaves the feature off by default', () => {
    expect(lisaUnifiedCheckpointsEnabled({})).toBe(false);
    expect(lisaUnifiedCheckpointsEnabled({ CODEBUDDY_LISA_UNIFIED_CHECKPOINTS: 'true' })).toBe(true);
  });

  it('persists the before state, restores it, and leaves a second return point', () => {
    const { root, store, target } = fixture();
    fs.writeFileSync(target, 'before');
    const checkpoint = store.prepare('action-1', 'Edit file', 'initiative', [target]);
    fs.writeFileSync(target, 'after');
    store.complete(checkpoint.id);
    const reopened = new LisaActionStore(root, path.join(root, 'history'));
    expect(reopened.list().map(item => item.actionId)).toContain('action-1');
    const result = reopened.restore(checkpoint.id);
    expect(fs.readFileSync(target, 'utf8')).toBe('before');
    expect(result.restored).toEqual([target]);
    expect(reopened.get(result.safetyCheckpointId).state).toBe('completed');
    reopened.restore(result.safetyCheckpointId);
    expect(fs.readFileSync(target, 'utf8')).toBe('after');
  });

  it('refuses to overwrite a later human edit', () => {
    const { store, target } = fixture();
    fs.writeFileSync(target, 'before');
    const checkpoint = store.prepare('action-2', 'Edit file', 'initiative', [target]);
    fs.writeFileSync(target, 'after');
    store.complete(checkpoint.id);
    fs.writeFileSync(target, 'human');
    expect(() => store.restore(checkpoint.id)).toThrow('File changed after action');
    expect(fs.readFileSync(target, 'utf8')).toBe('human');
  });

  it('refuses outside paths, directories and symbolic links before writing a checkpoint', () => {
    const { root, store } = fixture();
    expect(() => store.prepare('x', 'x', 'initiative', [path.dirname(root)])).toThrow('outside workspace');
    expect(() => store.prepare('x', 'x', 'initiative', [root])).toThrow('outside workspace');
    const directory = path.join(root, 'directory');
    fs.mkdirSync(directory);
    expect(() => store.prepare('x', 'x', 'initiative', [directory])).toThrow('not a regular file');
    const link = path.join(root, 'link');
    fs.symlinkSync(path.join(root, 'missing'), link);
    expect(() => store.prepare('x', 'x', 'initiative', [link])).toThrow('not a regular file');
  });

  it('refuses autonomous edits to Lisa guardrails', () => {
    const { root, store } = fixture();
    expect(() => store.prepare('x', 'x', 'initiative', [path.join(root, 'AGENTS.md')]))
      .toThrow('Lisa cannot modify her guardrails');
    expect(() => store.prepare('x', 'x', 'initiative', [path.join(root, '.codebuddy', 'mandats.toml')]))
      .toThrow('Lisa cannot modify her guardrails');
  });
});
