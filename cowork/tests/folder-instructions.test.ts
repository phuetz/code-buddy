import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findProjectRoot,
  getAcceptedFileNames,
  resolveProjectContext,
  STARTUP_PROJECT_CONTEXT_FILES,
} from '@codebuddy/context/project-context.js';
import { clearContextConfigCache, clearExcludesCache } from '@codebuddy/context/instruction-excludes.js';
import {
  classifyInstructionOrigin,
  confineFolderInstructionCwd,
  inspectFolderInstructions,
  resolveFolderInstructionFile,
  writeFolderInstructionFile,
  type FolderInstructionKernel,
} from '../src/main/project/folder-instructions';

const kernel: FolderInstructionKernel = {
  findProjectRoot,
  getAcceptedFileNames,
  resolveProjectContext,
  startupFileNames: STARTUP_PROJECT_CONTEXT_FILES,
  clearCaches: () => {
    clearContextConfigCache();
    clearExcludesCache();
  },
};

const scratch: string[] = [];

afterEach(() => {
  delete process.env.CODEBUDDY_INCLUDE_INTEROP_CONTEXT;
  clearContextConfigCache();
  clearExcludesCache();
  for (const path of scratch.splice(0)) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function makeTree(): { root: string; home: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), 'cowork-folder-instr-'));
  scratch.push(root);
  const home = join(root, 'home');
  const project = join(root, 'projet');
  mkdirSync(join(home, '.codebuddy'), { recursive: true });
  mkdirSync(join(project, '.git'), { recursive: true });
  return { root, home, project };
}

describe('classifyInstructionOrigin', () => {
  it('maps global / project root / nested folder without inventing extra ranks', () => {
    const project = '/tmp/workspace';
    expect(
      classifyInstructionOrigin({
        tier: 'global',
        filePath: '/home/user/.codebuddy/AGENTS.md',
        projectRoot: project,
        cwd: project,
      }),
    ).toBe('global');
    expect(
      classifyInstructionOrigin({
        tier: 'hierarchy',
        filePath: join(project, 'AGENTS.md'),
        projectRoot: project,
        cwd: join(project, 'pkg'),
      }),
    ).toBe('folder');
    expect(
      classifyInstructionOrigin({
        tier: 'hierarchy',
        filePath: join(project, '.codebuddy', 'AGENTS.md'),
        projectRoot: project,
        cwd: project,
      }),
    ).toBe('folder');
    expect(
      classifyInstructionOrigin({
        tier: 'hierarchy',
        filePath: join(project, 'pkg', 'AGENTS.md'),
        projectRoot: project,
        cwd: join(project, 'pkg'),
      }),
    ).toBe('subdirectory');
  });
});

describe('inspectFolderInstructions', () => {
  it('resolves global then folder files in kernel order', () => {
    const { home, project } = makeTree();
    writeFileSync(join(home, '.codebuddy', 'AGENTS.md'), 'GLOBAL-RULE', 'utf-8');
    writeFileSync(join(project, 'AGENTS.md'), 'DOSSIER-RULE', 'utf-8');

    const snapshot = inspectFolderInstructions({
      cwd: project,
      projectRoot: project,
      homeDir: home,
      kernel,
    });

    expect(snapshot.applied.map((s) => s.origin)).toEqual(['global', 'folder']);
    expect(snapshot.applied[0]?.relPath).toBe('~/.codebuddy/AGENTS.md');
    expect(snapshot.applied[1]?.relPath).toBe('AGENTS.md');
    expect(snapshot.appliedText.indexOf('GLOBAL-RULE')).toBeLessThan(
      snapshot.appliedText.indexOf('DOSSIER-RULE'),
    );
    expect(snapshot.folderFile.exists).toBe(true);
    expect(snapshot.folderFile.fileName).toBe('AGENTS.md');
    expect(snapshot.startupFileNames).toEqual(['AGENTS.md', 'CODEBUDDY.md']);
  });

  it('marks a missing folder AGENTS.md clearly while still listing ancestors', () => {
    const { home, project } = makeTree();
    writeFileSync(join(project, 'AGENTS.md'), 'RACINE', 'utf-8');
    const nested = join(project, 'pkg');
    mkdirSync(nested);

    const snapshot = inspectFolderInstructions({ cwd: nested, projectRoot: project, homeDir: home, kernel });

    expect(snapshot.folderFile.exists).toBe(false);
    expect(snapshot.folderFile.path).toBe(join(nested, 'AGENTS.md'));
    expect(snapshot.applied.some((s) => s.origin === 'folder')).toBe(true);
    expect(snapshot.applied.some((s) => s.origin === 'subdirectory')).toBe(false);
  });

  it('loads a subdirectory file after the project-root file (later wins)', () => {
    const { home, project } = makeTree();
    writeFileSync(join(project, 'AGENTS.md'), 'RACINE', 'utf-8');
    const nested = join(project, 'pkg');
    mkdirSync(nested);
    writeFileSync(join(nested, 'AGENTS.md'), 'SOUS-DOSSIER', 'utf-8');

    const snapshot = inspectFolderInstructions({ cwd: nested, projectRoot: project, homeDir: home, kernel });

    expect(snapshot.applied.map((s) => s.origin)).toEqual(['folder', 'subdirectory']);
    expect(snapshot.appliedText.indexOf('RACINE')).toBeLessThan(
      snapshot.appliedText.indexOf('SOUS-DOSSIER'),
    );
    expect(snapshot.folderFile.exists).toBe(true);
    expect(snapshot.folderFile.content).toBe('SOUS-DOSSIER');
  });

  it('resolves instruction files under a directory whose name has accents', () => {
    const { home, project } = makeTree();
    const nested = join(project, 'café-données');
    mkdirSync(nested);
    writeFileSync(join(nested, 'AGENTS.md'), 'règle accentuée', 'utf-8');

    const snapshot = inspectFolderInstructions({ cwd: nested, projectRoot: project, homeDir: home, kernel });

    expect(snapshot.folderFile.exists).toBe(true);
    expect(snapshot.folderFile.content).toBe('règle accentuée');
    expect(snapshot.applied.some((s) => s.origin === 'subdirectory' && s.relPath.includes('café-données'))).toBe(
      true,
    );
    expect(snapshot.appliedText).toContain('règle accentuée');
  });

  it('lists CLAUDE.md as present-not-applied unless the interop env is on', () => {
    const { home, project } = makeTree();
    writeFileSync(join(project, 'AGENTS.md'), 'AGENTS', 'utf-8');
    writeFileSync(join(project, 'CLAUDE.md'), 'CLAUDE-ONLY', 'utf-8');

    const off = inspectFolderInstructions({ cwd: project, projectRoot: project, homeDir: home, kernel });
    expect(off.applied.map((s) => s.relPath)).toEqual(['AGENTS.md']);
    expect(off.presentNotApplied.some((s) => s.relPath === 'CLAUDE.md')).toBe(true);
    expect(off.notes[0]).toMatch(/CODEBUDDY_INCLUDE_INTEROP_CONTEXT/);

    process.env.CODEBUDDY_INCLUDE_INTEROP_CONTEXT = 'true';
    const on = inspectFolderInstructions({ cwd: project, projectRoot: project, homeDir: home, kernel });
    expect(on.applied.map((s) => s.relPath)).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(on.presentNotApplied).toEqual([]);
  });

  it('writes the folder AGENTS.md and re-inspects it as applied', () => {
    const { home, project } = makeTree();
    expect(resolveFolderInstructionFile(project).exists).toBe(false);

    writeFolderInstructionFile(project, 'AGENTS.md', '# Règle\nNe pas inventer.\n');
    const snapshot = inspectFolderInstructions({
      cwd: project,
      projectRoot: project,
      homeDir: home,
      kernel,
    });

    expect(snapshot.folderFile.exists).toBe(true);
    expect(snapshot.folderFile.content).toContain('Ne pas inventer.');
    expect(snapshot.applied.some((s) => s.relPath === 'AGENTS.md')).toBe(true);
  });

  it('refuses a path escape on save', () => {
    const { project } = makeTree();
    expect(() => writeFolderInstructionFile(project, '../AGENTS.md', 'nope')).toThrow(/Invalid/);
  });

  it.skipIf(process.platform === 'win32')('refuses to follow a symlink out of the working folder', () => {
    const { project, root } = makeTree();
    const outside = join(root, 'outside-secret.md');
    writeFileSync(outside, 'ORIGINAL', 'utf-8');
    const agents = join(project, 'AGENTS.md');
    symlinkSync(outside, agents);

    expect(() => writeFolderInstructionFile(project, 'AGENTS.md', 'PWNED')).toThrow(/symbolic link|symlink/i);
    expect(readFileSync(outside, 'utf-8')).toBe('ORIGINAL');
  });

  it('refuses a renderer cwd that leaves the open workspace', () => {
    const { project, root } = makeTree();
    const outside = join(root, 'other-user');
    mkdirSync(outside);
    expect(confineFolderInstructionCwd(outside, project)).toBeNull();
    expect(confineFolderInstructionCwd(join(project, '..', 'other-user'), project)).toBeNull();
    expect(confineFolderInstructionCwd(join(project, 'pkg'), project)).toBe(join(project, 'pkg'));
  });
});
