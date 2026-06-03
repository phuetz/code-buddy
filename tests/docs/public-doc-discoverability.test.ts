import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publicMarkdownDocs } from './public-doc-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

async function readPublicDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

function expectLinks(markdown: string, doc: string, links: string[]): void {
  const missing = links.filter((link) => !markdown.includes(link));
  expect(missing, `${doc} is missing public discovery links`).toEqual([]);
}

function expectText(markdown: string, doc: string, snippets: string[]): void {
  const missing = snippets.filter((snippet) => !markdown.includes(snippet));
  expect(missing, `${doc} is missing public usage text`).toEqual([]);
}

function stripLinkTarget(rawHref: string): string {
  return rawHref
    .trim()
    .replace(/^<|>$/g, '')
    .split('#')[0]
    ?.split('?')[0]
    ?.trim() ?? '';
}

function isExternalOrAnchor(href: string): boolean {
  return href === ''
    || href.startsWith('#')
    || /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function toRepoRelative(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function collectLocalRefs(markdown: string): string[] {
  const refs = new Set<string>();
  for (const match of markdown.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    if (match[1]) refs.add(match[1]);
  }
  for (const match of markdown.matchAll(/<(?:a|img)\s+[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) refs.add(match[1]);
  }
  return [...refs]
    .map(stripLinkTarget)
    .filter((href) => !isExternalOrAnchor(href));
}

describe('public Cowork documentation discoverability', () => {
  it('keeps the aggregate public-docs script wired to every guard', async () => {
    const packageJson = JSON.parse(await readPublicDoc('package.json')) as {
      scripts?: Record<string, string>;
    };
    const script = packageJson.scripts?.['test:docs-public'] ?? '';

    expectLinks(script, 'package.json test:docs-public', [
      'tests/docs/public-doc-fixtures.ts',
      'tests/docs/public-doc-discoverability.test.ts',
      'tests/docs/public-doc-links.test.ts',
      'tests/docs/public-qa-evidence-integrity.test.ts',
      'tests/docs/public-screenshot-privacy.test.ts',
      'tests/docs/renderers.test.ts',
      'eslint',
    ]);
  });

  it('keeps root README linked to user guides and the QA evidence hub', async () => {
    const readme = await readPublicDoc('README.md');

    expectLinks(readme, 'README.md', [
      'docs/troubleshooting.md',
      'docs/cowork-user-guide.md',
      'docs/cowork-guide-fr.md',
      'docs/channel-a2a-bridge.md',
      'docs/computer-use-application-profiles.md',
      'docs/spec-pipeline.md',
      'docs/cowork-pilotability-matrix.md',
      'docs/hermes-agent-strategy.md',
      'docs/code-buddy-hermes-gap-analysis.md',
      'docs/code-buddy-hermes-gap-audit-2026-05-24.md',
      'docs/hermes-cowork-cli-improvement-plan.md',
      'docs/migration.md',
      'docs/qa/code-buddy-studio/README.md',
      'docs/qa/code-buddy-studio/feature-qa.md',
      'docs/qa/code-buddy-studio/screenshots/',
      'docs/qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png',
      'docs/qa/code-buddy-studio/screenshots/110-packaged-win-unpacked-launch.png',
      'npm run test:docs-public',
    ]);
    expectText(readme, 'README.md', [
      'Packaged desktop launch proof',
      'e2e/packaged-launch-smoke.spec.ts',
    ]);
  });

  it('keeps every guarded public markdown doc reachable from the public doc graph', async () => {
    const entrypoints = new Set(['README.md', 'CHANGELOG.md', 'CLAUDE.md']);
    const publicDocs = new Set<string>(publicMarkdownDocs);
    const incomingRefs = new Map<string, string[]>(
      publicMarkdownDocs.map((docPath) => [docPath, []]),
    );

    for (const sourceDoc of publicMarkdownDocs) {
      const absoluteSource = path.join(repoRoot, sourceDoc);
      const sourceDir = path.dirname(absoluteSource);
      const markdown = await fs.readFile(absoluteSource, 'utf8');

      for (const ref of collectLocalRefs(markdown)) {
        const absoluteTarget = path.resolve(sourceDir, ref);
        let target = toRepoRelative(absoluteTarget);
        if (!publicDocs.has(target) && publicDocs.has(`${target}/README.md`)) {
          target = `${target}/README.md`;
        }
        if (target !== sourceDoc && publicDocs.has(target)) {
          incomingRefs.get(target)?.push(sourceDoc);
        }
      }
    }

    const orphanedDocs = [...incomingRefs.entries()]
      .filter(([docPath, incoming]) => !entrypoints.has(docPath) && incoming.length === 0)
      .map(([docPath]) => docPath);

    expect(orphanedDocs).toEqual([]);
  });

  it('keeps getting-started linked to Cowork guides and QA evidence', async () => {
    const gettingStarted = await readPublicDoc('docs/getting-started.md');

    expectLinks(gettingStarted, 'docs/getting-started.md', [
      'cowork-user-guide.md',
      'cowork-guide-fr.md',
      'qa/code-buddy-studio/README.md',
      './qa/code-buddy-studio/screenshots/01-home-work-surface.png',
      './qa/code-buddy-studio/screenshots/30-test-runner-window.png',
      'npm run test:docs-public',
    ]);
    expectText(gettingStarted, 'docs/getting-started.md', [
      'Cowork Desktop Quickstart',
      'Tests & executions',
      'ChatGPT OAuth',
      'local providers',
      'MCP',
      'Fleet',
      'Hermes',
      'PNG dimensions',
      'private-token or local-path leaks',
    ]);
  });

  it('keeps Cowork README variants linked to user guides and publication guards', async () => {
    const coworkReadmes = [
      'cowork/README.md',
      'cowork/README_zh.md',
    ];

    for (const doc of coworkReadmes) {
      const markdown = await readPublicDoc(doc);
      expectLinks(markdown, doc, [
        '../docs/cowork-user-guide.md',
        '../docs/cowork-guide-fr.md',
        '../docs/qa/code-buddy-studio/README.md',
        '../tests/docs/public-doc-discoverability.test.ts',
        '../tests/docs/public-screenshot-privacy.test.ts',
        '../tests/docs/public-doc-links.test.ts',
        '../docs/qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png',
        '../docs/qa/code-buddy-studio/screenshots/110-packaged-win-unpacked-launch.png',
        'npm run test:docs-public',
      ]);
      expectText(markdown, doc, [
        'Release Readiness Route',
        'packaged',
        'e2e/packaged-launch-smoke.spec.ts',
      ]);
    }
  });

  it('keeps user guides cross-linked to the QA hub and representative real captures', async () => {
    const guides = [
      'docs/cowork-user-guide.md',
      'docs/cowork-guide-fr.md',
    ];

    for (const doc of guides) {
      const markdown = await readPublicDoc(doc);
      expectLinks(markdown, doc, [
        './qa/code-buddy-studio/README.md',
        './qa/code-buddy-studio/screenshots/29-real-gpt55-cowork-gui.png',
        './qa/code-buddy-studio/screenshots/30-test-runner-window.png',
        './qa/code-buddy-studio/screenshots/54-test-runner-workflow-integration.png',
        './qa/code-buddy-studio/screenshots/59-test-runner-cowork-ipc-chat.png',
        './qa/code-buddy-studio/screenshots/55-test-runner-permission-real-flow.png',
        './qa/code-buddy-studio/screenshots/108-test-runner-computer-use-real-suite.png',
        './qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png',
        './qa/code-buddy-studio/screenshots/110-packaged-win-unpacked-launch.png',
      ]);
      expectText(markdown, doc, [
        'buddy tools skill-candidate inspect',
        'e2e/packaged-launch-smoke.spec.ts',
        'outputStatus: written',
        'outputVerified: true',
      ]);
    }
  });

  it('keeps the QA hub linked to reports, screenshots, and publication guards', async () => {
    const qaHub = await readPublicDoc('docs/qa/code-buddy-studio/README.md');

    expectLinks(qaHub, 'docs/qa/code-buddy-studio/README.md', [
      '../../getting-started.md',
      '../../cowork-user-guide.md',
      '../../cowork-guide-fr.md',
      './feature-qa.md',
      './feature-qa-report.json',
      './overnight-qa-campaign.md',
      './overnight-test-datasets.json',
      './screenshots/',
      './screenshots/29-real-gpt55-cowork-gui.png',
      './screenshots/30-test-runner-window.png',
      './screenshots/54-test-runner-workflow-integration.png',
      './screenshots/55-test-runner-permission-real-flow.png',
      './screenshots/108-test-runner-computer-use-real-suite.png',
      './screenshots/109-test-runner-hermes-built-cli-real.png',
      './screenshots/110-packaged-win-unpacked-launch.png',
      'tests/docs/public-doc-links.test.ts',
      'tests/docs/public-doc-discoverability.test.ts',
      'tests/docs/public-qa-evidence-integrity.test.ts',
      'tests/docs/public-screenshot-privacy.test.ts',
      'npm run test:docs-public',
    ]);
    expectText(qaHub, 'docs/qa/code-buddy-studio/README.md', [
      'Release Readiness Route',
      'Build/package gates pass',
      'npm run build',
      'cd cowork && npm run typecheck',
      'cd cowork && npm run build:e2e',
      'npm run build:gui',
      'electron-builder',
      'pre-build check: 9 passed, 0 warnings, 0 failed',
      'Packaged launch guard',
      'COWORK_PACKAGED_EXE="release/win-unpacked/Code Buddy Cowork.exe"',
      'e2e/packaged-launch-smoke.spec.ts',
      'Packaged win-unpacked launch',
      'Evidence Matrix',
      'Safe publication',
      'Source build/typecheck',
      'Packaged desktop',
      'Packaging warning triage',
      'Known Packaging Warnings',
      'Do not claim a zero-warning release',
      'chunkSizeWarningLimit',
      'Resolved Packaging Signals',
      'Dynamic/static import reporter warnings',
      '0 occurrences of `vite:reporter`',
      'core-loader',
      'server-bridge',
      'sandbox-bootstrap',
      'reasoning-bridge',
      'DEP0190',
      'NODE_OPTIONS=--trace-deprecation npm run build:gui',
      'app-builder-lib/src/node-module-collector/nodeModulesCollector.ts',
      'Safe runner bundles',
      'Opt-in real provider/system',
      'Safe runner bundles cover CLI',
      'Opt-in real checks are explicit',
      'Publication guard passes',
    ]);
  });
});
