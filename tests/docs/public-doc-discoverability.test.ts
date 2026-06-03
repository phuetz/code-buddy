import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

describe('public Cowork documentation discoverability', () => {
  it('keeps the aggregate public-docs script wired to every guard', async () => {
    const packageJson = JSON.parse(await readPublicDoc('package.json')) as {
      scripts?: Record<string, string>;
    };
    const script = packageJson.scripts?.['test:docs-public'] ?? '';

    expectLinks(script, 'package.json test:docs-public', [
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
      'docs/cowork-user-guide.md',
      'docs/cowork-guide-fr.md',
      'docs/qa/code-buddy-studio/README.md',
      'docs/qa/code-buddy-studio/feature-qa.md',
      'docs/qa/code-buddy-studio/screenshots/',
      'docs/qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png',
      'npm run test:docs-public',
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
        '../tests/docs/public-doc-discoverability.test.ts',
        '../tests/docs/public-screenshot-privacy.test.ts',
        '../tests/docs/public-doc-links.test.ts',
        '../docs/qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png',
        'npm run test:docs-public',
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
        './qa/code-buddy-studio/screenshots/55-test-runner-permission-real-flow.png',
        './qa/code-buddy-studio/screenshots/108-test-runner-computer-use-real-suite.png',
        './qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png',
      ]);
      expectText(markdown, doc, [
        'buddy tools skill-candidate inspect',
        'outputStatus: written',
        'outputVerified: true',
      ]);
    }
  });

  it('keeps the QA hub linked to reports, screenshots, and publication guards', async () => {
    const qaHub = await readPublicDoc('docs/qa/code-buddy-studio/README.md');

    expectLinks(qaHub, 'docs/qa/code-buddy-studio/README.md', [
      './feature-qa.md',
      './feature-qa-report.json',
      './overnight-qa-campaign.md',
      './overnight-test-datasets.json',
      './screenshots/',
      './screenshots/29-real-gpt55-cowork-gui.png',
      './screenshots/30-test-runner-window.png',
      './screenshots/55-test-runner-permission-real-flow.png',
      './screenshots/108-test-runner-computer-use-real-suite.png',
      './screenshots/109-test-runner-hermes-built-cli-real.png',
      'tests/docs/public-doc-links.test.ts',
      'tests/docs/public-doc-discoverability.test.ts',
      'tests/docs/public-qa-evidence-integrity.test.ts',
      'tests/docs/public-screenshot-privacy.test.ts',
      'npm run test:docs-public',
    ]);
  });
});
