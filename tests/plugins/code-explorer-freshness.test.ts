/**
 * CodeExplorerManager — real tests (no mocks) for the freshness fix: reading the
 * REAL `.gitnexus/meta.json` schema (nested `stats`) and detecting a stale index
 * against git HEAD. Uses a real temp dir; git is injected so no repo is needed.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CodeExplorerManager } from '../../src/plugins/code-explorer/CodeExplorerManager.js';

let dir: string;

function writeMeta(subdir: string, meta: unknown): void {
  const d = path.join(dir, subdir);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'meta.json'), JSON.stringify(meta));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ce-freshness-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('getStats — real .gitnexus nested schema', () => {
  it('maps nested stats (nodes/edges/communities) to the flat CodeExplorerStats', () => {
    writeMeta('.gitnexus', {
      repoPath: dir,
      lastCommit: 'abc123',
      indexedAt: '2026-07-02T20:05:58Z',
      stats: { files: 4673, nodes: 97812, edges: 232361, communities: 7942, processes: 75 },
    });
    const stats = new CodeExplorerManager(dir).getStats();
    expect(stats).toEqual({
      symbols: 97812,
      relations: 232361,
      processes: 75,
      clusters: 7942,
      indexed: true,
      stale: false,
    });
  });

  it('isRepoIndexed() recognises a .gitnexus index', () => {
    writeMeta('.gitnexus', { stats: {} });
    expect(new CodeExplorerManager(dir).isRepoIndexed()).toBe(true);
  });

  it('returns defaults when no index exists', () => {
    const stats = new CodeExplorerManager(dir).getStats();
    expect(stats.indexed).toBe(false);
    expect(stats.symbols).toBe(0);
  });
});

describe('getFreshness — index vs HEAD', () => {
  it('reports commitsBehind and stale=true when the index lags HEAD', () => {
    writeMeta('.gitnexus', { lastCommit: 'oldsha', indexedAt: '2026-07-02T20:05:58Z', stats: {} });
    const fresh = new CodeExplorerManager(dir).getFreshness((args) => {
      expect(args).toBe('rev-list --count oldsha..HEAD');
      return '209';
    });
    expect(fresh).toEqual({
      indexed: true,
      lastCommit: 'oldsha',
      indexedAt: '2026-07-02T20:05:58Z',
      commitsBehind: 209,
      stale: true,
    });
  });

  it('reports stale=false when the index is at HEAD (0 commits behind)', () => {
    writeMeta('.gitnexus', { lastCommit: 'headsha', stats: {} });
    const fresh = new CodeExplorerManager(dir).getFreshness(() => '0');
    expect(fresh.commitsBehind).toBe(0);
    expect(fresh.stale).toBe(false);
  });

  it('never throws when git fails — commitsBehind stays undefined, not stale', () => {
    writeMeta('.gitnexus', { lastCommit: 'x', stats: {} });
    const fresh = new CodeExplorerManager(dir).getFreshness(() => {
      throw new Error('not a git repo');
    });
    expect(fresh.commitsBehind).toBeUndefined();
    expect(fresh.stale).toBe(false);
    expect(fresh.lastCommit).toBe('x');
  });

  it('legacy flat schema (no lastCommit) trusts the explicit stale flag, no git', () => {
    writeMeta('.codeexplorer', { symbols: 10, relations: 20, stale: true });
    let called = false;
    const fresh = new CodeExplorerManager(dir).getFreshness(() => {
      called = true;
      return '0';
    });
    expect(called).toBe(false);
    expect(fresh.stale).toBe(true);
    expect(fresh.lastCommit).toBeUndefined();
  });

  it('returns not-indexed when there is no meta', () => {
    expect(new CodeExplorerManager(dir).getFreshness(() => '0')).toEqual({
      indexed: false,
      stale: false,
    });
  });
});
