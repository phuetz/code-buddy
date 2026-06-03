import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');
const viteConfigContent = readFileSync(viteConfigPath, 'utf8');

describe('vite watch ignores build artifacts', () => {
  it('ignores packaged and build output directories to avoid reload spam', () => {
    expect(viteConfigContent).toContain('const ignoredWatchPaths = [');
    expect(viteConfigContent).toContain("'**/release/**'");
    expect(viteConfigContent).toContain("'**/dist/**'");
    expect(viteConfigContent).toContain("'**/dist-electron/**'");
    expect(viteConfigContent).toContain('ignored: ignoredWatchPaths');
  });

  it('keeps renderer chunk warnings fixed by measured splitting, not by raising the limit', () => {
    expect(viteConfigContent).toContain('function rendererManualChunks');
    expect(viteConfigContent).toContain("return 'vendor-react';");
    expect(viteConfigContent).toContain("return 'vendor-icons';");
    expect(viteConfigContent).toContain("return 'vendor-highlight';");
    expect(viteConfigContent).toContain("return 'vendor-katex';");
    expect(viteConfigContent).toContain("return 'vendor-markdown';");
    expect(viteConfigContent).toContain('manualChunks: rendererManualChunks');
    expect(viteConfigContent).not.toContain('chunkSizeWarningLimit');
  });
});
