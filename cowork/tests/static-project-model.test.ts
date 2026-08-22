/**
 * static-project-model — real test (no mocks): static vs dev-server detection.
 */
import { describe, expect, it } from 'vitest';
import {
  isStaticProject,
  isNpmProject,
  previewEntry,
  describePreviewMode,
  staticServePlan,
} from '../src/renderer/components/studio/static-project-model';
import type { TreeNode } from '../src/renderer/components/studio/utils/file-tree-model';

const staticTree: TreeNode[] = [
  { name: 'index.html', path: 'index.html', type: 'file' },
  { name: 'style.css', path: 'style.css', type: 'file' },
  { name: 'app.js', path: 'app.js', type: 'file' },
];

const viteTree: TreeNode[] = [
  { name: 'index.html', path: 'index.html', type: 'file' },
  { name: 'package.json', path: 'package.json', type: 'file' },
  { name: 'src', path: 'src', type: 'directory', children: [{ name: 'main.tsx', path: 'src/main.tsx', type: 'file' }] },
];

describe('static-project-model', () => {
  it('detects a static project (index.html, no package.json)', () => {
    expect(isStaticProject(staticTree)).toBe(true);
    expect(describePreviewMode(staticTree)).toBe('static');
  });

  it('detects a dev-server project (has package.json)', () => {
    expect(isStaticProject(viteTree)).toBe(false);
    expect(describePreviewMode(viteTree)).toBe('dev-server');
  });

  it('finds the static entry path', () => {
    expect(previewEntry(staticTree)).toBe('index.html');
    expect(previewEntry([{ name: 'src', path: 'src', type: 'directory' }])).toBeNull();
  });

  it('flags an npm project (needs install) by its root package.json', () => {
    expect(isNpmProject(viteTree)).toBe(true);
    expect(isNpmProject(staticTree)).toBe(false);
    expect(isNpmProject([])).toBe(false);
  });
});

describe('staticServePlan', () => {
  it('builds a loopback python http.server command with a path-stable port', () => {
    const a = staticServePlan('/tmp/e2e-meteo5', 'linux');
    expect(a.command).toMatch(/^python3 -m http\.server 8[7-8]\d\d --bind 127\.0\.0\.1$/);
    expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:8[7-8]\d\d\/$/);
    // Stable for the same path, different for another path (usually)
    expect(staticServePlan('/tmp/e2e-meteo5', 'linux')).toEqual(a);
    expect(staticServePlan('/tmp/autre-projet', 'linux').url).not.toBe(a.url);
  });

  it('uses python (not python3) on Windows', () => {
    expect(staticServePlan('C:/apps/site', 'win32').command).toMatch(/^python -m http\.server/);
  });
});
