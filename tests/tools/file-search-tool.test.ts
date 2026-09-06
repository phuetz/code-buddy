import * as fs from 'fs/promises';
import { execFileSync } from 'node:child_process';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSearchTool } from '../../src/tools/file-search-tool.js';
import { createAuthoredExtraTools } from '../../src/tools/registry/authored-extra-tools.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

describe('FileSearchTool', () => {
  it('searches text files and ignores node_modules', async () => {
    const root = await tempDir('file-search-tool-');
    await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(root, 'a.txt'), 'alpha\nbeta needle\n');
    await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'b.txt'), 'needle\n');
    const result = await new FileSearchTool().execute({ root, pattern: 'needle' });
    expect(result.success).toBe(true);
    expect((result.data as { matches: Array<{ file: string; line: number }> }).matches).toEqual([
      { file: 'a.txt', line: 2, excerpt: 'beta needle' },
    ]);
  });

  it('defaults to the launch folder when root is omitted (headless -p case)', async () => {
    const launch = await tempDir('file-search-cwd-');
    await fs.writeFile(path.join(launch, 'alpha.txt'), 'probe-alpha-only\n');
    await fs.writeFile(path.join(launch, 'beta.txt'), 'shared-needle\n');
    await fs.writeFile(path.join(launch, 'gamma.md'), 'probe-gamma-only\n');

    const result = await new FileSearchTool().execute(
      { pattern: 'probe-alpha-only' },
      { cwd: launch },
    );
    expect(result.success).toBe(true);
    const data = result.data as { root: string; matches: Array<{ file: string }> };
    expect(data.root).toBe(path.resolve(launch));
    expect(data.matches.map((row) => row.file)).toEqual(['alpha.txt']);
  });

  it('resolves "." against the launch folder, not a git toplevel', async () => {
    const launch = await tempDir('file-search-dot-');
    await fs.writeFile(path.join(launch, 'here.txt'), 'dot-root-marker\n');
    const result = await new FileSearchTool().execute(
      { root: '.', pattern: 'dot-root-marker' },
      { cwd: launch },
    );
    expect(result.success).toBe(true);
    const data = result.data as { root: string; matches: Array<{ file: string }> };
    expect(data.root).toBe(path.resolve(launch));
    expect(data.matches).toEqual([{ file: 'here.txt', line: 1, excerpt: 'dot-root-marker' }]);
  });

  it('stays on process.cwd() when launched from a git subdirectory (interactive repo)', async () => {
    const repo = await tempDir('file-search-repo-');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'only-in-root.txt'), 'repo-root-marker\n');
    const sub = path.join(repo, 'sub');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, 'only-in-sub.txt'), 'repo-sub-marker\n');

    const fromSub = await new FileSearchTool().execute(
      { pattern: 'repo-root-marker|repo-sub-marker' },
      { cwd: sub },
    );
    expect(fromSub.success).toBe(true);
    const subData = fromSub.data as { root: string; matches: Array<{ file: string; excerpt: string }> };
    expect(subData.root).toBe(path.resolve(sub));
    expect(subData.matches.map((row) => row.file)).toEqual(['only-in-sub.txt']);
    expect(subData.matches[0]?.excerpt).toBe('repo-sub-marker');

    const fromRoot = await new FileSearchTool().execute(
      { pattern: 'repo-root-marker' },
      { cwd: repo },
    );
    expect(fromRoot.success).toBe(true);
    const rootData = fromRoot.data as { root: string; matches: Array<{ file: string }> };
    expect(rootData.root).toBe(path.resolve(repo));
    expect(rootData.matches.map((row) => row.file)).toEqual(['only-in-root.txt']);
  });

  it('uses process.cwd() when the registry did not pass a session cwd', async () => {
    const launch = await tempDir('file-search-process-cwd-');
    await fs.writeFile(path.join(launch, 'cwd-only.txt'), 'process-cwd-marker\n');
    const previous = process.cwd();
    try {
      process.chdir(launch);
      const result = await new FileSearchTool().execute({ pattern: 'process-cwd-marker' });
      expect(result.success).toBe(true);
      const data = result.data as { root: string; matches: Array<{ file: string }> };
      expect(data.root).toBe(path.resolve(launch));
      expect(data.matches.map((row) => row.file)).toEqual(['cwd-only.txt']);
    } finally {
      process.chdir(previous);
    }
  });

  it('the authored adapter forwards context.cwd so omitted root is not the host process dir', async () => {
    const launch = await tempDir('file-search-adapter-');
    await fs.writeFile(path.join(launch, 'adapter.txt'), 'adapter-cwd-marker\n');
    const tool = createAuthoredExtraTools().find((entry) => entry.name === 'file_search');
    expect(tool).toBeDefined();
    const result = await tool!.execute(
      { pattern: 'adapter-cwd-marker' },
      { cwd: launch, sessionId: 'file-search-adapter' },
    );
    expect(result.success).toBe(true);
    const data = result.data as { root: string; matches: Array<{ file: string }> };
    expect(data.root).toBe(path.resolve(launch));
    expect(data.matches.map((row) => row.file)).toEqual(['adapter.txt']);
  });
});
