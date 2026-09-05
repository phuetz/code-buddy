import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const coworkRoot = process.cwd();
const mainSource = fs.readFileSync(path.join(coworkRoot, 'src/main/index.ts'), 'utf8');
const builderConfig = fs.readFileSync(path.join(coworkRoot, 'electron-builder.yml'), 'utf8');

describe('desktop window icon packaging', () => {
  it('uses a checked-in Linux icon in development and packaged builds', () => {
    expect(fs.existsSync(path.join(coworkRoot, 'public/logo.png'))).toBe(true);
    expect(fs.existsSync(path.join(coworkRoot, 'resources/icon.png'))).toBe(false);

    expect(mainSource).not.toContain("isWindows ? 'icon.ico' : 'icon.png'");
    expect(mainSource).toContain("join(__dirname, '../../public/logo.png')");
    expect(mainSource).toContain("join(app.getAppPath(), 'dist/logo.png')");
    expect(builderConfig).toMatch(/linux:\n[\s\S]*?icon: public\/logo\.png/);
  });
});
