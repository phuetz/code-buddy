import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');

describe('App browser-mode config save', () => {
  it('does not simulate a successful config save outside Electron', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).not.toContain('config save simulated');
    expect(source).toContain('Configuration saving is unavailable outside Electron');
  });
});
