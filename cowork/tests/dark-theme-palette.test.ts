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

  it('keeps the warm charcoal palette available as the open-cowork theme override', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('.open-cowork {');
    expect(source).toContain('--color-background: #171614;');
    expect(source).toContain('--color-surface: rgba(34, 32, 29, 0.7);');
    expect(source).toContain('--color-text-primary: #f8f4ed;');
  });

  it('keeps the accent within the warm orange family', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #d67a52;');
    expect(source).toContain('--color-accent-hover: #c56c46;');
  });
});
