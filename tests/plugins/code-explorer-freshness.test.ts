/**
 * CodeExplorerManager — real tests (no mocks) for the freshness fix: reading the
 * REAL `.gitnexus/meta.json` schema (nested `stats`) and detecting a stale index
 * against git HEAD. Uses a real temp dir; git is injected so no repo is needed.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CodeExplorerManager } from '../../src/plugins/code-explorer/CodeExplorerManager.js';

const OLD = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
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
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
    writeMeta('.gitnexus', { lastCommit: OLD, indexedAt: '2026-07-02T20:05:58Z', stats: {} });
    const fresh = new CodeExplorerManager(dir).getFreshness((args) => {
      if (args === 'rev-parse --verify HEAD') return HEAD;
      expect(args).toBe(`rev-list --count ${OLD}..HEAD`);
      return '209';
    });
    expect(fresh).toEqual({
      indexed: true,
      lastCommit: OLD,
      indexedAt: '2026-07-02T20:05:58Z',
      commitsBehind: 209,
      stale: true,
    });
  });

  it('reports stale=false when the index is at HEAD (0 commits behind)', () => {
    writeMeta('.gitnexus', { lastCommit: HEAD, stats: {} });
    const fresh = new CodeExplorerManager(dir).getFreshness(() => HEAD);
    expect(fresh.commitsBehind).toBe(0);
    expect(fresh.stale).toBe(false);
  });

  it('reports unverified and stale when git fails', () => {
    writeMeta('.gitnexus', { lastCommit: OLD, stats: {} });
    const fresh = new CodeExplorerManager(dir).getFreshness(() => {
      throw new Error('not a git repo');
    });
    expect(fresh.commitsBehind).toBeUndefined();
    expect(fresh.stale).toBe(true);
    expect(fresh.unverified).toBe(true);
    expect(fresh.lastCommit).toBe(OLD);
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


describe('freshness trust and branch changes', () => {
  it('never passes an index-supplied command or revision expression to Git', () => {
    for (const lastCommit of ['', null, 7, 'HEAD', '--help', '$(touch sentinel)', 'a; echo injected', 'a'.repeat(41)]) {
      writeMeta('.gitnexus', { lastCommit });
      const git = vi.fn();
      expect(new CodeExplorerManager(dir).getFreshness(git)).toMatchObject({ stale: true, unverified: true });
      expect(git).not.toHaveBeenCalled();
    }
  });

  it('does not mistake a rewound HEAD for the indexed revision when the count is zero', () => {
    writeMeta('.gitnexus', { lastCommit: OLD });
    const result = new CodeExplorerManager(dir).getFreshness(args => args.startsWith('rev-parse') ? HEAD : '0');
    expect(result).toMatchObject({ stale: true, commitsBehind: 0 });
    expect(result.unverified).toBeUndefined();
  });

  it.each(['-1', '0garbage', '', '9007199254740992'])('does not certify a malformed commit count: %s', count => {
    writeMeta('.gitnexus', { lastCommit: OLD });
    expect(new CodeExplorerManager(dir).getFreshness(args => args.startsWith('rev-parse') ? HEAD : count))
      .toMatchObject({ stale: true, unverified: true });
  });

  it('reports incomplete modern metadata and unreadable existing indexes as unverified', () => {
    for (const metadata of [{ stats: {} }, { indexedAt: '2026-09-13' }, {}]) {
      writeMeta('.gitnexus', metadata);
      const git = vi.fn();
      expect(new CodeExplorerManager(dir).getFreshness(git))
        .toMatchObject({ indexed: true, stale: true, unverified: true });
      expect(git).not.toHaveBeenCalled();
    }
    writeFileSync(path.join(dir, '.gitnexus', 'meta.json'), '{broken');
    expect(new CodeExplorerManager(dir).getFreshness())
      .toMatchObject({ indexed: true, stale: true, unverified: true });
    rmSync(path.join(dir, '.gitnexus', 'meta.json'));
    expect(new CodeExplorerManager(dir).getFreshness())
      .toMatchObject({ indexed: true, stale: true, unverified: true });
  });

  it('falls back to valid metadata when the first layout is malformed or non-object', () => {
    writeMeta('.gitnexus', { lastCommit: HEAD });
    for (const invalid of ['null', '[]', '42', '{broken']) {
      writeMeta('.codeexplorer', {});
      writeFileSync(path.join(dir, '.codeexplorer', 'meta.json'), invalid);
      expect(new CodeExplorerManager(dir).getFreshness(() => HEAD)).toMatchObject({ indexed: true, stale: false });
    }
  });

  it('checks a real Git history without a shell, including a rewind', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: {
      ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
    } }).trim();
    git('init', '--quiet');
    git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'first');
    const first = git('rev-parse', 'HEAD');
    git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'second');
    writeMeta('.gitnexus', { lastCommit: git('rev-parse', 'HEAD') });
    const manager = new CodeExplorerManager(dir);
    expect(manager.getFreshness(undefined, { autoIndex: false })).toMatchObject({ stale: false, commitsBehind: 0 });
    git('checkout', '--quiet', '--detach', first);
    expect(manager.getFreshness(undefined, { autoIndex: false })).toMatchObject({ stale: true, commitsBehind: 0 });
  });
});
