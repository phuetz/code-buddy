import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const coworkDir = process.cwd();

describe('Cowork Linux doc links', () => {
  it('ARCHITECTURE.md points at DEV-LINUX.md in this folder, not docs/dev-linux.md', () => {
    const text = fs.readFileSync(path.join(coworkDir, 'ARCHITECTURE.md'), 'utf8');
    // Proven GK1: the Vite-only loop linked to docs/dev-linux.md, which does not exist.
    expect(text).toContain('DEV-LINUX.md');
    expect(text).not.toContain('docs/dev-linux.md');
    expect(fs.existsSync(path.join(coworkDir, 'DEV-LINUX.md'))).toBe(true);
  });

  it('DEV-LINUX.md points at ARCHITECTURE.md, not architecture.md', () => {
    const text = fs.readFileSync(path.join(coworkDir, 'DEV-LINUX.md'), 'utf8');
    // Proven GK1: the dual-mainWindow gotcha linked to architecture.md (missing on Linux).
    expect(text).toContain('ARCHITECTURE.md');
    expect(text).not.toContain('architecture.md');
    expect(fs.existsSync(path.join(coworkDir, 'ARCHITECTURE.md'))).toBe(true);
  });
});
