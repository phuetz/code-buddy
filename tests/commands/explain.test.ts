import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoExplanationInput } from '../../src/analytics/repo-explainer.js';
import { createExplainCommand } from '../../src/commands/explain.js';

describe('buddy explain command', () => {
  let tempDirectory: string;
  let repoPath: string;

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-explain-test-'));
    repoPath = path.join(tempDirectory, 'minimal-repo');
    await fs.mkdir(repoPath);
  });

  afterEach(async () => {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  it('produces useful Markdown for a minimal non-Git repo without mutating it', async () => {
    const outputPath = path.join(tempDirectory, 'minimal.md');
    const command = createExplainCommand({
      cwd: tempDirectory,
      now: () => new Date('2026-08-16T10:00:00.000Z'),
    });

    await command.parseAsync(['node', 'explain', 'minimal-repo', '--out', outputPath]);

    const markdown = await fs.readFile(outputPath, 'utf8');
    expect(markdown).toContain('# Comprendre minimal-repo');
    expect(markdown).toContain('Dépôt minimal ou vide');
    expect(markdown).toContain('Historique Git absent');
    expect(await fs.readdir(repoPath)).toEqual([]);
  });

  it('honors deep HTML output and keeps the artifact zero-CDN when Mermaid fails open', async () => {
    const outputPath = path.join(tempDirectory, 'orientation.html');
    const collect = vi.fn(
      async (): Promise<RepoExplanationInput> => ({
        rootPath: repoPath,
        rootName: 'sample',
        depth: 'deep',
        generatedAt: '2026-08-16T10:00:00.000Z',
        files: [
          { path: 'README.md', sizeBytes: 20 },
          { path: 'src/index.ts', sizeBytes: 80 },
        ],
        profile: {
          name: 'sample',
          description: 'A sample command-line application.',
          entryPoints: ['src/index.ts'],
        },
        git: { available: false },
        codeExplorer: { indexed: false },
      })
    );
    const renderMermaid = vi.fn(async () => null);
    const command = createExplainCommand({
      cwd: tempDirectory,
      collect,
      renderMermaid,
    });

    await command.parseAsync([
      'node',
      'explain',
      'minimal-repo',
      '--depth',
      'deep',
      '--html',
      '--out',
      outputPath,
    ]);

    const html = await fs.readFile(outputPath, 'utf8');
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 'deep', rootPath: repoPath })
    );
    expect(renderMermaid).toHaveBeenCalledOnce();
    expect(html).toContain('Le moteur Mermaid local n’était pas disponible');
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i);
  });

  it('still writes an orientation artifact when the whole collector rejects', async () => {
    const outputPath = path.join(tempDirectory, 'fallback.md');
    const command = createExplainCommand({
      cwd: tempDirectory,
      collect: async () => {
        throw new Error('synthetic collection failure');
      },
    });

    await expect(
      command.parseAsync(['node', 'explain', 'minimal-repo', '--out', outputPath])
    ).resolves.toBeDefined();

    const markdown = await fs.readFile(outputPath, 'utf8');
    expect(markdown).toContain('Collecte globale incomplète');
    expect(markdown).toContain('## 4. Par où commencer');
  });
});
