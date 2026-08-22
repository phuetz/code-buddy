import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeGraph } from '../../src/memory/knowledge-graph.js';

describe('memory knowledge graph loading', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    ));
  });

  it('makes concurrent callers await the same disk load', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'codebuddy-kg-load-'));
    temporaryDirectories.push(cwd);
    const storageDir = join(cwd, '.codebuddy');
    await mkdir(storageDir, { recursive: true });
    await writeFile(join(storageDir, 'knowledge-graph.json'), JSON.stringify({
      version: 2,
      entities: [{
        id: 'e_1_1',
        type: 'concept',
        name: 'responsive assistant',
        properties: {},
        confidence: 0.9,
        mentions: 1,
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      }],
      relations: [],
      categories: [],
      contentHashes: [],
    }));

    const graph = new KnowledgeGraph(cwd);
    const backgroundLoad = graph.load();

    // A second consumer must not observe loaded=true while the first read is pending.
    await graph.load();
    expect(graph.findEntity('responsive assistant', 'concept')).toBeDefined();
    await backgroundLoad;
  });
});
