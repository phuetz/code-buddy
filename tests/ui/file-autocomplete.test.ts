import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearFileSuggestionCache,
  extractFileReference,
  getFileSuggestions,
} from '../../src/ui/components/FileAutocomplete.js';

describe('file autocomplete', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'codebuddy-file-autocomplete-'));
    await mkdir(path.join(projectRoot, 'src', 'ui'), { recursive: true });
    await mkdir(path.join(projectRoot, 'src', 'context'), { recursive: true });
    await mkdir(path.join(projectRoot, 'ignored'), { recursive: true });
    await mkdir(path.join(projectRoot, 'node_modules', 'dep'), { recursive: true });
    await writeFile(path.join(projectRoot, 'src', 'ui', 'ChatInterface.tsx'), 'export {};\n');
    await writeFile(path.join(projectRoot, 'src', 'context', 'file-mentions.ts'), 'export {};\n');
    await writeFile(path.join(projectRoot, 'README.md'), '# Project\n');
    await writeFile(path.join(projectRoot, '.env'), 'TOKEN=not-indexed-by-default\n');
    await writeFile(path.join(projectRoot, 'ignored', 'secret.ts'), 'export {};\n');
    await writeFile(path.join(projectRoot, 'node_modules', 'dep', 'index.js'), '');
    await writeFile(path.join(projectRoot, '.gitignore'), 'ignored/\n');
    clearFileSuggestionCache(projectRoot);
  });

  afterEach(async () => {
    clearFileSuggestionCache(projectRoot);
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('fuzzy-matches project-wide relative file paths', () => {
    const suggestions = getFileSuggestions('cht', projectRoot);

    expect(suggestions.some((item) => item.path === 'src/ui/ChatInterface.tsx')).toBe(true);
  });

  it('opens only for a whitespace-delimited @ reference', () => {
    expect(extractFileReference('Review @src/ui/Chat')).toEqual({
      found: true,
      partial: 'src/ui/Chat',
      startPos: 7,
    });
    expect(extractFileReference('dev@example.com')).toEqual({
      found: false,
      partial: '',
      startPos: -1,
    });
  });

  it('keeps directory-qualified fuzzy matches in the requested subtree', () => {
    const suggestions = getFileSuggestions('src/ui/chti', projectRoot);

    expect(suggestions[0]?.path).toBe('src/ui/ChatInterface.tsx');
    expect(suggestions.every((item) => item.path.startsWith('src/ui/'))).toBe(true);
  });

  it('respects gitignore, generated-directory, and hidden-file boundaries', () => {
    expect(getFileSuggestions('secret', projectRoot)).toEqual([]);
    expect(getFileSuggestions('dep/index', projectRoot)).toEqual([]);
    expect(getFileSuggestions('env', projectRoot).some((item) => item.path === '.env')).toBe(false);
    expect(getFileSuggestions('.env', projectRoot).some((item) => item.path === '.env')).toBe(true);
  });

  it('does not offer absolute paths or traversal outside the project', () => {
    expect(getFileSuggestions('../secret', projectRoot)).toEqual([]);
    expect(getFileSuggestions(path.resolve(projectRoot, 'README.md'), projectRoot)).toEqual([]);
  });
});
