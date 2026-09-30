import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function testFilesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return testFilesIn(entryPath);
    return entry.isFile() && /\.(test|spec)\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

describe('Codebase hygiene', () => {
  it('should not contain any test files in the src directory', () => {
    expect(testFilesIn('src')).toEqual([]);
  });
});
