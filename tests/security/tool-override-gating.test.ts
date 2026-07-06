/**
 * Persistent per-tool overrides (Hermes-style per-tool gating) — real
 * PolicyManager, real config file in a temp dir: an override denies at
 * resolution time, survives a fresh instance (restart), and clears back to
 * profile rules. The resolver's `globalOverrides` seam existed but nothing
 * ever fed it — this is its first real producer.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PolicyManager } from '../../src/security/tool-policy/policy-manager.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-gating-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PolicyManager.setToolOverride', () => {
  it('denies a tool the profile would allow, persists across instances, clears cleanly', () => {
    const manager = new PolicyManager(dir);
    expect(manager.checkTool('web_search').action).not.toBe('deny');

    manager.setToolOverride('web_search', 'deny');
    expect(manager.checkTool('web_search')).toMatchObject({ action: 'deny', source: 'global' });

    // Fresh instance = restart: the override must come back from disk.
    const reloaded = new PolicyManager(dir);
    expect(reloaded.checkTool('web_search').action).toBe('deny');
    expect(reloaded.getToolOverrides()).toEqual({ web_search: 'deny' });

    reloaded.clearToolOverride('web_search');
    expect(reloaded.checkTool('web_search').action).not.toBe('deny');
    const third = new PolicyManager(dir);
    expect(third.getToolOverrides()).toEqual({});
  });

  it('session overrides still outrank the persistent gate', () => {
    const manager = new PolicyManager(dir);
    manager.setToolOverride('bash', 'deny');
    manager.setSessionOverride('bash', 'allow');
    expect(manager.checkTool('bash').action).toBe('allow');
  });

  it('allow override wins over a deny group rule', () => {
    const manager = new PolicyManager(dir);
    manager.addGlobalRule({ group: 'group:web', action: 'deny' });
    expect(manager.checkTool('web_search').action).toBe('deny');
    manager.setToolOverride('web_search', 'allow');
    expect(manager.checkTool('web_search').action).toBe('allow');
  });
});
