/**
 * Security audit of the @ file autocomplete (PR #103): the index never lists
 * anything outside the project (symlinks are not followed), honours the root
 * .gitignore, and hides dotfiles unless the user explicitly types the dot.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearFileSuggestionCache, getFileSuggestions } from '../../src/ui/components/FileAutocomplete.js';

const isWindows = process.platform === 'win32';

describe('file autocomplete — security audit', () => {
  let sandbox: string;
  let projectRoot: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'codebuddy-autocomplete-sec-'));
    projectRoot = path.join(sandbox, 'project');
    await mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await mkdir(path.join(sandbox, 'outside-dir'), { recursive: true });
    await writeFile(path.join(sandbox, 'outside-dir', 'leaked-secret.ts'), 'export {};\n');
    await writeFile(path.join(sandbox, 'outside-file.ts'), 'export {};\n');
    await writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export {};\n');
    await writeFile(path.join(projectRoot, '.env'), 'TOKEN=x\n');
    await writeFile(path.join(projectRoot, '.env.local'), 'TOKEN=y\n');
    await writeFile(path.join(projectRoot, 'id_rsa'), 'not-a-key\n');
    await writeFile(path.join(projectRoot, '.gitignore'), '.env*\nid_rsa\n');
    if (!isWindows) {
      await symlink(path.join(sandbox, 'outside-dir'), path.join(projectRoot, 'linked-dir'), 'dir');
      await symlink(path.join(sandbox, 'outside-file.ts'), path.join(projectRoot, 'linked-file.ts'));
    }
    clearFileSuggestionCache(projectRoot);
  });

  afterEach(async () => {
    clearFileSuggestionCache(projectRoot);
    await rm(sandbox, { recursive: true, force: true });
  });

  it('never lists symlinks nor traverses a symlinked directory out of the project', () => {
    if (isWindows) return;
    const everything = getFileSuggestions('', projectRoot);
    const paths = everything.map((item) => item.path);

    expect(paths).toContain('src/index.ts');
    expect(paths.some((item) => item.includes('linked'))).toBe(false);
    expect(paths.some((item) => item.includes('leaked-secret'))).toBe(false);
    expect(getFileSuggestions('leaked', projectRoot)).toEqual([]);
    expect(getFileSuggestions('outside', projectRoot)).toEqual([]);
  });

  it('honours root .gitignore patterns (dotfile globs and plain names) even when the dot is typed', () => {
    expect(getFileSuggestions('.env', projectRoot)).toEqual([]);
    expect(getFileSuggestions('.env.local', projectRoot)).toEqual([]);
    expect(getFileSuggestions('id_rsa', projectRoot)).toEqual([]);
  });

  it('returns nothing for absolute, drive-letter, or parent-traversal queries', () => {
    expect(getFileSuggestions('/etc/pass', projectRoot)).toEqual([]);
    expect(getFileSuggestions('C:\\Users\\x', projectRoot)).toEqual([]);
    expect(getFileSuggestions('../outside', projectRoot)).toEqual([]);
    expect(getFileSuggestions('src/../../outside', projectRoot)).toEqual([]);
    expect(getFileSuggestions('~/.ssh/id', projectRoot)).toEqual([]);
  });
});
