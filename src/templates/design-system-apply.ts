/**
 * Brand a freshly-scaffolded project with a chosen design system.
 *
 * Reads the vendored design system (tokens.css + DESIGN.md) via the registry
 * and writes them into the generated project so the app takes the brand's
 * colors/typography/geometry. No-op on an unknown id; never throws.
 *
 * @module templates/design-system-apply
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDesignSystem } from '../design/design-system-registry.js';

export interface ApplyDesignSystemResult {
  applied: boolean;
  files: string[];
  warning?: string;
}

/**
 * Apply `designSystemId` to the project at `projectDir`:
 *  - writes its tokens.css as `<src|root>/design-system.css` and wires the
 *    import AFTER the template's own stylesheet so the brand wins the cascade,
 *  - writes the brand's DESIGN.md at the project root (a reference for the
 *    agent and the future AI-generation mode).
 * Returns a result the caller can log; never throws.
 */
export function applyDesignSystem(projectDir: string, designSystemId: string): ApplyDesignSystemResult {
  try {
    const id = designSystemId?.trim();
    if (!id) return { applied: false, files: [] };

    const system = getDesignSystem(id);
    if (!system) return { applied: false, files: [], warning: `Unknown design system: ${id}` };

    const files: string[] = [];
    const srcDir = path.join(projectDir, 'src');
    const hasSrc = safeIsDir(srcDir);
    const cssDir = hasSrc ? srcDir : projectDir;

    const tokens = (system.tokensCss ?? '').trim();
    if (tokens) {
      const cssPath = path.join(cssDir, 'design-system.css');
      fs.writeFileSync(cssPath, `/* Design system: ${system.name} (${system.category}) — via Code Buddy App Studio */\n${tokens}\n`, 'utf8');
      files.push(path.relative(projectDir, cssPath));
      ensureCssImport(cssDir);
    }

    // DESIGN.md at project root — brand contract reference.
    if (system.design?.trim()) {
      const designMdPath = path.join(projectDir, 'DESIGN.md');
      fs.writeFileSync(designMdPath, system.design, 'utf8');
      files.push('DESIGN.md');
    }

    return { applied: files.length > 0, files };
  } catch (error) {
    return { applied: false, files: [], warning: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Wire `import './design-system.css'` into the project's entry point, placed
 * AFTER the template's own `./index.css` import so the brand tokens override
 * the template defaults. Falls back to prepending when there's no such entry.
 */
function ensureCssImport(cssDir: string): void {
  const candidates = ['main.tsx', 'main.ts', 'index.tsx', 'index.ts'];
  for (const name of candidates) {
    const entry = path.join(cssDir, name);
    if (!safeIsFile(entry)) continue;
    let content = fs.readFileSync(entry, 'utf8');
    if (content.includes('design-system.css')) return;
    if (content.includes("import './index.css'")) {
      content = content.replace("import './index.css';", "import './index.css';\nimport './design-system.css';");
    } else {
      content = `import './design-system.css';\n${content}`;
    }
    fs.writeFileSync(entry, content, 'utf8');
    return;
  }
  // Fallback: prepend an @import to an existing index.css (must be first in the file).
  const indexCss = path.join(cssDir, 'index.css');
  if (safeIsFile(indexCss)) {
    const content = fs.readFileSync(indexCss, 'utf8');
    if (!content.includes('design-system.css')) {
      fs.writeFileSync(indexCss, `@import './design-system.css';\n${content}`, 'utf8');
    }
  }
}

function safeIsDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeIsFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
