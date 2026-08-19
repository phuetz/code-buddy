/**
 * Detect whether a generated project is a static site (index.html, no build) or
 * a dev-server project (package.json). App Studio's generator often writes
 * static HTML/CSS/JS — the preview must be served differently. Pure.
 */
import type { TreeNode } from './utils/file-tree-model.js';

export type PreviewMode = 'static' | 'dev-server';

function rootFiles(tree: readonly TreeNode[]): string[] {
  return tree.filter((n) => n.type === 'file').map((n) => n.name.toLowerCase());
}

/** A static project has a root index.html and no package.json. */
export function isStaticProject(tree: readonly TreeNode[]): boolean {
  const files = rootFiles(tree);
  return files.includes('index.html') && !files.includes('package.json');
}

/**
 * An npm project has a root package.json — it needs `npm install` before its
 * dev server can start (App Studio G1). Vite/Vue/Next/Expo scaffolds all match.
 */
export function isNpmProject(tree: readonly TreeNode[]): boolean {
  return rootFiles(tree).includes('package.json');
}

/** Path to the static entry (root index.html), or null. */
export function previewEntry(tree: readonly TreeNode[]): string | null {
  const entry = tree.find((n) => n.type === 'file' && n.name.toLowerCase() === 'index.html');
  return entry?.path ?? null;
}

export function describePreviewMode(tree: readonly TreeNode[]): PreviewMode {
  return isStaticProject(tree) ? 'static' : 'dev-server';
}

export interface StaticServePlan {
  command: string;
  url: string;
}

/**
 * Shell plan to serve a STATIC project ("Lancer" on a generated HTML/CSS/JS
 * app): a loopback python http.server on a port derived from the project
 * path (stable per project, avoids collisions between two open projects).
 * Without this, startDev falls back to `npm run dev` and dies on
 * ENOENT package.json — seen live on /tmp/e2e-meteo5.
 */
export function staticServePlan(projectRoot: string, platform: string): StaticServePlan {
  let hash = 0;
  for (let i = 0; i < projectRoot.length; i++) {
    hash = (hash * 31 + projectRoot.charCodeAt(i)) | 0;
  }
  const port = 8700 + (Math.abs(hash) % 200);
  const python = platform === 'win32' ? 'python' : 'python3';
  return {
    command: `${python} -m http.server ${port} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${port}/`,
  };
}
