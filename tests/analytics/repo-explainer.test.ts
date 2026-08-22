import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  explainRepository,
  type RepoExplanationInput,
  type RepoFileInput,
} from '../../src/analytics/repo-explainer.js';
import {
  renderRepoExplanationHtml,
  renderRepoExplanationMarkdown,
} from '../../src/export/repo-explanation.js';

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/repo-explainer'
);

async function fixtureFiles(directory = fixtureRoot, prefix = ''): Promise<RepoFileInput[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<RepoFileInput[]> => {
      const relativePath = path.posix.join(prefix, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return fixtureFiles(absolutePath, relativePath);
      const stat = await fs.stat(absolutePath);
      return [{ path: relativePath, sizeBytes: stat.size }];
    })
  );
  return files.flat().sort((left, right) => left.path.localeCompare(right.path));
}

async function fixtureInput(): Promise<RepoExplanationInput> {
  return {
    rootPath: fixtureRoot,
    rootName: 'repo-explainer',
    depth: 'quick',
    generatedAt: '2026-08-16T10:00:00.000Z',
    files: await fixtureFiles(),
    profile: {
      name: 'fixture-service',
      description: 'A small TypeScript HTTP service used to validate repository orientation.',
      languages: ['TypeScript'],
      packageManager: 'npm',
      testFramework: 'Vitest',
      entryPoints: ['dist/index.js'],
      commands: { build: 'npm run build', test: 'npm test' },
      topDependencies: ['fastify'],
    },
    cartography: {
      architecture: {
        style: 'Layered',
        layers: [
          { name: 'Source', directory: 'src', fileCount: 3 },
          { name: 'Tests', directory: 'tests', fileCount: 1 },
        ],
      },
      fileStats: {
        totalSourceFiles: 3,
        totalTestFiles: 1,
        largestFiles: [{ path: 'src/risky.ts', lines: 420 }],
      },
      importGraph: {
        hotModules: [{ module: 'src/service.ts', importedBy: 4 }],
        circularRisks: [],
      },
      importEdges: [
        ['src/index.ts', 'src/service.ts'],
        ['src/service.ts', 'src/risky.ts'],
      ],
    },
    complexity: {
      files: [
        {
          filePath: path.join(fixtureRoot, 'src/risky.ts'),
          maxComplexity: 24,
          averageComplexity: 12,
          totalLinesOfCode: 420,
          maintainabilityIndex: 42,
        },
        {
          filePath: path.join(fixtureRoot, 'src/service.ts'),
          maxComplexity: 3,
          averageComplexity: 2,
          totalLinesOfCode: 24,
          maintainabilityIndex: 88,
        },
      ],
      hotspots: [
        {
          filePath: path.join(fixtureRoot, 'src/risky.ts'),
          name: 'evaluateRequest',
          cyclomaticComplexity: 24,
          cognitiveComplexity: 18,
          linesOfCode: 40,
        },
      ],
      summary: {
        totalFiles: 2,
        totalFunctions: 2,
        averageComplexity: 7,
        maxComplexity: 24,
        overallRating: 'C',
      },
    },
    heatmap: {
      files: [
        {
          filePath: 'src/risky.ts',
          commits: 20,
          additions: 600,
          deletions: 300,
          churnScore: 900,
          heatLevel: 'hot',
        },
        {
          filePath: 'src/service.ts',
          commits: 2,
          additions: 20,
          deletions: 4,
          churnScore: 24,
          heatLevel: 'cold',
        },
      ],
    },
    documentation: {
      modules: [
        {
          path: 'src/index.ts',
          entries: [{ name: 'service', kind: 'variable' }],
        },
      ],
      totalEntries: 1,
    },
    codeExplorer: { indexed: false },
    git: { available: true },
  };
}

describe('repository explainer', () => {
  it('detects the fixture orientation and ranks injected risk signals', async () => {
    const explanation = explainRepository(await fixtureInput());

    expect(explanation.repo.name).toBe('fixture-service');
    expect(explanation.repo.purpose).toContain('TypeScript HTTP service');
    expect(explanation.overview.languages[0]).toMatchObject({ name: 'TypeScript', files: 4 });
    expect(explanation.overview.frameworks).toContain('Fastify');
    expect(explanation.overview.entryPoints[0]).toMatchObject({ path: 'src/index.ts' });
    expect(explanation.overview.entryPoints[0]?.exportedSymbols).toContain('service');
    expect(explanation.architecture.modules.map((module) => module.directory)).toEqual([
      'src',
      'tests',
    ]);
    expect(explanation.architecture.diagram.mermaid).toContain('flowchart LR');
    expect(explanation.risks.hotspots[0]?.path).toBe('src/risky.ts');
    expect(explanation.risks.hotspots[0]?.reasons.join(' ')).toContain('churn');
    expect(explanation.gettingStarted.docs[0]).toBe('README.md');
    expect(explanation.gettingStarted.tests).toContain('tests/service.test.ts');
    expect(explanation.limitations).toContain(
      'Code Explorer non indexé : diagramme construit depuis les imports/fichiers disponibles.'
    );
  });

  it('uses an injected Code Explorer Mermaid graph when available', async () => {
    const input = await fixtureInput();
    input.codeExplorer = {
      indexed: true,
      target: 'createService',
      mermaid: 'flowchart LR\n  Entry --> Service',
    };

    const diagram = explainRepository(input).architecture.diagram;

    expect(diagram.source).toBe('code-explorer');
    expect(diagram.mermaid).toContain('Entry --> Service');
  });

  it('rejects network-capable Mermaid from an index and falls back locally', async () => {
    const input = await fixtureInput();
    input.codeExplorer = {
      indexed: true,
      mermaid: 'flowchart LR\n  Entry --> Service\n  click Service "https://example.test"',
    };

    const explanation = explainRepository(input);

    expect(explanation.architecture.diagram.source).toBe('file-analysis');
    expect(explanation.architecture.diagram.mermaid).not.toContain('https://');
    expect(explanation.limitations.join(' ')).toContain('non exploitable ou non sûr');
  });

  it('always returns a useful explanation for an empty non-Git repository', () => {
    const explanation = explainRepository({
      rootName: 'empty-repo',
      depth: 'quick',
      generatedAt: '2026-08-16T10:00:00.000Z',
      files: [],
      git: { available: false },
      codeExplorer: { indexed: false },
    });

    expect(explanation.repo.purpose).toContain('Dépôt minimal ou vide');
    expect(explanation.architecture.diagram.mermaid).toContain('empty-repo');
    expect(explanation.limitations.join(' ')).toContain('Historique Git indisponible');
  });
});

describe('repository explanation renderers', () => {
  it('renders the four required Markdown sections', async () => {
    const markdown = renderRepoExplanationMarkdown(explainRepository(await fixtureInput()));

    expect(markdown.length).toBeGreaterThan(500);
    expect(markdown).toContain('## 1. À quoi sert ce repo');
    expect(markdown).toContain('## 2. Architecture');
    expect(markdown).toContain('## 3. Points chauds et risques');
    expect(markdown).toContain('## 4. Par où commencer');
    expect(markdown).toContain('```mermaid');
  });

  it('renders autonomous HTML without a network resource URL', async () => {
    const html = renderRepoExplanationHtml(explainRepository(await fixtureInput()), {
      diagramDataUri: 'data:image/png;base64,aGVsbG8=',
    });

    expect(html.length).toBeGreaterThan(1_000);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('data:image/png;base64,aGVsbG8=');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i);
  });
});
