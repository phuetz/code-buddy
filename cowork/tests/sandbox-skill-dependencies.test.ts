import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sandboxDir = path.resolve(process.cwd(), 'src/main/sandbox');
const wslBridgeSrc = fs.readFileSync(path.join(sandboxDir, 'wsl-bridge.ts'), 'utf8');
const limaBridgeSrc = fs.readFileSync(path.join(sandboxDir, 'lima-bridge.ts'), 'utf8');
const sandboxBootstrapSrc = fs.readFileSync(path.join(sandboxDir, 'sandbox-bootstrap.ts'), 'utf8');

describe('sandbox skill dependencies', () => {
  it('preinstalls spreadsheet generation libraries in WSL and Lima sandboxes', () => {
    for (const source of [wslBridgeSrc, limaBridgeSrc]) {
      expect(source).toContain("'python-pptx'");
      expect(source).toContain("'openpyxl'");
      expect(source).toContain("'xlsxwriter'");
    }
  });

  it('reports XLSX skill setup during sandbox bootstrap', () => {
    expect(sandboxBootstrapSrc).toContain('PDF/PPTX/XLSX skills');
    expect(sandboxBootstrapSrc).toContain('openpyxl');
  });
});
