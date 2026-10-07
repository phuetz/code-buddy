import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('dark theme palette', () => {
  it('uses the premium slate palette for the default dark theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #1e1e1e;');
    expect(source).toContain('--color-surface: #2d2d2d;');
    expect(source).toContain('--color-text-primary: #e5e5e5;');
  });

  it('keeps the selectable theme overrides (genspark / codex / anthropic)', () => {
    // The old `.open-cowork` charcoal override was intentionally replaced by
    // the theme selector work (6c753ce0): three named overrides now live in
    // globals.css and the selector applies them as root classes.
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('.genspark {');
    expect(source).toContain('.codex {');
    expect(source).toContain('.anthropic {');
    expect(source).toContain('--color-background: #0d0b1f;'); // genspark deep violet
    expect(source).toContain('--color-background: #0d1117;'); // codex slate
  });

  it('keeps the accent within the warm orange family', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    const dark = source.split('  :root {')[1]?.split('  }')[0];
    const light = source.split('  .light {')[1]?.split('  }')[0];
    expect(dark).toContain('--color-accent: #e08a5f;');
    expect(dark).toContain('--color-on-accent: #1a0e08;');
    expect(light).toContain('--color-accent: #a8461f;');
    expect(light).toContain('--color-on-accent: #ffffff;');
  });
});
