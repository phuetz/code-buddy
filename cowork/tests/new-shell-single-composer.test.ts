import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const newShellPath = path.resolve(process.cwd(), 'src/renderer/components/NewShell.tsx');

describe('NewShell empty-chat composer', () => {
  it('does not mount DockWorkspace until a session exists', () => {
    const source = fs.readFileSync(newShellPath, 'utf8');

    expect(source).toMatch(/\{activeSessionId\s*&&\s*\(\s*<div[\s\S]*?<DockWorkspace\s*\/>/);
  });
});
