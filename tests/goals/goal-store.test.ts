import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GoalStore } from '../../src/goals/goal-store.js';
import { createGoalState } from '../../src/goals/goal-state.js';

describe('GoalStore', () => {
  let tmpDir: string;
  let store: GoalStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-store-test-'));
    store = new GoalStore({ storeDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('saves and loads a goal state', () => {
    const state = createGoalState('ship the feature', 10);
    store.save('session-1', state);
    expect(store.load('session-1')).toEqual(state);
  });

  it('returns null for unknown keys', () => {
    expect(store.load('nope')).toBeNull();
  });

  it('returns null for corrupt files', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{not json', 'utf-8');
    expect(store.load('bad')).toBeNull();
  });

  it('deletes a stored goal', () => {
    store.save('session-1', createGoalState('g'));
    store.delete('session-1');
    expect(store.load('session-1')).toBeNull();
  });

  it('sanitizes keys so they cannot escape the store directory', () => {
    const state = createGoalState('g');
    const escapeName = `escape-${path.basename(tmpDir)}`;
    const escapedPath = path.join(tmpDir, '..', `${escapeName}.json`);
    fs.rmSync(escapedPath, { force: true });

    store.save(`../${escapeName}`, state);

    const storedFiles = fs.readdirSync(tmpDir);
    expect(storedFiles).toHaveLength(1);
    expect(storedFiles[0]).not.toContain('/');
    expect(fs.existsSync(escapedPath)).toBe(false);
    expect(store.load(`../${escapeName}`)).toEqual(state);
  });

  it('keeps sanitized key collisions in separate files', () => {
    const slashState = createGoalState('slash');
    const underscoreState = createGoalState('underscore');

    store.save('a/b', slashState);
    store.save('a_b', underscoreState);

    expect(store.load('a/b')).toEqual(slashState);
    expect(store.load('a_b')).toEqual(underscoreState);
    expect(fs.readdirSync(tmpDir)).toHaveLength(2);
  });

  it('loads legacy sanitized filenames for existing persisted goals', () => {
    const state = createGoalState('legacy');
    fs.writeFileSync(path.join(tmpDir, 'a_b.json'), JSON.stringify(state), 'utf-8');

    expect(store.load('a/b')).toEqual(state);
  });

  it('deletes both current and legacy filenames for a key', () => {
    const state = createGoalState('g');
    store.save('a/b', state);
    fs.writeFileSync(path.join(tmpDir, 'a_b.json'), JSON.stringify(state), 'utf-8');

    store.delete('a/b');

    expect(store.load('a/b')).toBeNull();
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('ignores empty keys', () => {
    store.save('', createGoalState('g'));
    expect(store.load('')).toBeNull();
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});
