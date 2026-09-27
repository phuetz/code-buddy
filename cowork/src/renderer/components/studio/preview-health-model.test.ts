import { describe, expect, it } from 'vitest';
import {
  buildPreviewFixPrompt,
  collectPreviewHealth,
  extractBuildErrors,
  listDeclaredDependencies,
} from './preview-health-model.js';

const RENDERED = { rootChildren: 3, textLength: 240 };

describe('collectPreviewHealth', () => {
  it('passes a clean build with a rendered page', () => {
    const report = collectPreviewHealth({ buildExitCode: 0, ...RENDERED });
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it('fails when vite build fails even though the page rendered something', () => {
    const report = collectPreviewHealth({
      buildExitCode: 1,
      buildOutput: [
        'vite v5.4.21 building for production...',
        '\u001b[31m[vite]: Rollup failed to resolve import "recharts" from "src/App.tsx".\u001b[39m',
        'error during build:',
      ],
      ...RENDERED,
    });
    expect(report.ok).toBe(false);
    expect(report.problems[0]!.kind).toBe('build');
    expect(report.problems[0]!.detail).toContain('failed to resolve import "recharts"');
    expect(report.problems[0]!.detail).not.toContain('\u001b[');
  });

  it('fails on an uncaught runtime exception and does not double count its console echo', () => {
    const report = collectPreviewHealth({
      buildExitCode: 0,
      pageErrors: ["Cannot read properties of undefined (reading 'map')"],
      consoleErrors: ["Uncaught TypeError: Cannot read properties of undefined (reading 'map')"],
      ...RENDERED,
    });
    expect(report.ok).toBe(false);
    expect(report.problems.filter((p) => p.kind === 'runtime')).toHaveLength(1);
  });

  it('treats a fatal console error (hidden-window probe has no pageerror channel) as runtime', () => {
    const report = collectPreviewHealth({
      buildExitCode: 0,
      consoleErrors: ['Uncaught ReferenceError: TodoItem is not defined'],
      ...RENDERED,
    });
    expect(report.ok).toBe(false);
    expect(report.summary).toBe('runtime');
  });

  it('ignores console noise (favicon 404, React key warning) but keeps it as context', () => {
    const report = collectPreviewHealth({
      buildExitCode: 0,
      consoleErrors: [
        'Failed to load resource: the server responded with a status of 404 (Not Found)',
        'Warning: Each child in a list should have a unique "key" prop.',
        'some app-level console.error',
      ],
      ...RENDERED,
    });
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual(['some app-level console.error']);
  });

  it('fails on a blank page, the Vite overlay, the starter placeholder and a failed load', () => {
    expect(collectPreviewHealth({ buildExitCode: 0, rootChildren: 0, textLength: 0 }).summary).toBe('blank');
    expect(collectPreviewHealth({ buildExitCode: 0, overlay: true, ...RENDERED }).summary).toBe('overlay');
    expect(collectPreviewHealth({ buildExitCode: 0, placeholder: true, ...RENDERED }).summary).toBe('placeholder');
    const nav = collectPreviewHealth({ navError: 'ERR_CONNECTION_REFUSED' });
    expect(nav.summary).toBe('navigation');
  });

  it('does not require a build signal (probe skipped the build)', () => {
    expect(collectPreviewHealth({ ...RENDERED }).ok).toBe(true);
  });
});

describe('extractBuildErrors', () => {
  it('keeps the error lines with a little context rather than the whole log', () => {
    const log = [...Array.from({ length: 50 }, (_, i) => `transforming ${i}`), 'src/App.tsx:3:7: ERROR: Expected ";" but found "x"', '  3 | let a b', 'done'];
    const out = extractBuildErrors(log);
    expect(out.some((l) => l.includes('Expected ";"'))).toBe(true);
    expect(out.length).toBeLessThan(10);
  });
});

describe('buildPreviewFixPrompt', () => {
  it('embeds each problem in a fenced block and states the no-shell / full-file contract', () => {
    const prompt = buildPreviewFixPrompt(
      collectPreviewHealth({ buildExitCode: 0, consoleErrors: ['Uncaught ReferenceError: x is not defined'], ...RENDERED }),
    );
    expect(prompt).toContain("Erreur d'exécution");
    expect(prompt).toContain('```\nUncaught ReferenceError: x is not defined\n```');
    expect(prompt).toMatch(/réécris-le en ENTIER/);
    expect(prompt).toMatch(/AUCUNE commande shell/);
  });
});

describe('listDeclaredDependencies', () => {
  it('lists deps and devDeps once, and tolerates invalid JSON', () => {
    expect(
      listDeclaredDependencies(JSON.stringify({ dependencies: { react: '^18', recharts: '^2' }, devDependencies: { vite: '^5', react: '^18' } })),
    ).toEqual(['react', 'recharts', 'vite']);
    expect(listDeclaredDependencies('{ nope')).toEqual([]);
  });
});
