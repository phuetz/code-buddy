import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { handleWorktree } from '../../src/commands/handlers/worktree-handlers';

jest.mock('child_process', () => ({
  execFileSync: jest.fn((command: string, args: string[]) => {
    if (command === 'git') {
      if (args[0] === 'rev-parse') {
        throw new Error('fatal: Needed a single revision');
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        return 'worktree /path/to/repo\nHEAD 1234567890abcdef\nbranch refs/heads/main\n\n';
      }
      if (args[0] === 'worktree' && args[1] === 'prune' && args[2] === '--dry-run') {
        return '';
      }
    }
    return Buffer.from('');
  }),
}));

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn(() => false),
  };
});

describe('Worktree Handlers', () => {
  describe('handleWorktree', () => {
    it('should return help when no args provided', () => {
      const result = handleWorktree([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Git Worktrees');
      expect(result.entry?.content).toContain('/worktree');
    });

    it('should return help with "help" arg', () => {
      const result = handleWorktree(['help']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Git Worktrees');
    });
  });

  describe('list worktrees', () => {
    it('should list worktrees with "list" command', () => {
      const result = handleWorktree(['list']);

      expect(result.handled).toBe(true);
      // May show worktrees or "not a git repository" depending on context
      expect(result.entry?.content).toBeDefined();
    });

    it('should accept "ls" as alias', () => {
      const result = handleWorktree(['ls']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBeDefined();
    });
  });

  describe('add worktree', () => {
    it('should add worktree with branch name', () => {
      const result = handleWorktree(['add', 'feature-branch']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('feature-branch');
    });

    it('should accept "create" as alias', () => {
      const result = handleWorktree(['create', 'feature-branch']);

      expect(result.handled).toBe(true);
    });

    it('should show error when no branch specified', () => {
      const result = handleWorktree(['add']);

      expect(result.entry?.content).toContain('Usage:');
    });

    it('should support custom path', () => {
      const result = handleWorktree(['add', 'feature', '../my-worktree']);

      expect(result.handled).toBe(true);
    });
  });

  // Les cas ci-dessus n'affirment que `handled === true` et la présence de la
  // chaîne qu'ils ont eux-mêmes passée en argument : dévier l'argv, falsifier la
  // branche rapportée ou masquer chemin et branche dans la réponse les laissait
  // verts. Ici on lit les VRAIS arguments remis à git et ce que l'utilisateur
  // reçoit en retour. `execFileSync` et `fs.existsSync` restent bouchonnés :
  // aucun worktree n'est créé sur le disque.
  describe('add worktree — arguments réellement passés à git', () => {
    const appelsGit = (): string[][] =>
      ((execFileSync as unknown as jest.Mock).mock.calls as unknown[][])
        .filter((call) => call[0] === 'git')
        .map((call) => call[1] as string[]);

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('creates a branch named after the directory when none is given', () => {
      const cheminResolu = path.resolve('feature-branch');

      const result = handleWorktree(['add', 'feature-branch']);

      expect(appelsGit()).toEqual([
        ['worktree', 'add', '-b', 'feature-branch', cheminResolu],
      ]);
      expect(result.entry?.content).toContain(`📁 Path: ${cheminResolu}`);
      expect(result.entry?.content).toContain('🌿 Branch: feature-branch');
    });

    it('creates the requested branch when git says it does not exist yet', () => {
      const cheminResolu = path.resolve('../wt-nouvelle');

      const result = handleWorktree(['add', '../wt-nouvelle', 'sujet/nouvelle']);

      expect(appelsGit()).toEqual([
        ['rev-parse', '--verify', 'sujet/nouvelle'],
        ['rev-parse', '--verify', 'sujet/nouvelle'],
        ['worktree', 'add', '-b', 'sujet/nouvelle', cheminResolu],
      ]);
      expect(result.entry?.content).toContain(`📁 Path: ${cheminResolu}`);
      expect(result.entry?.content).toContain('🌿 Branch: sujet/nouvelle');
    });

    it('checks out an existing branch without -b, keeping it as the worktree base', () => {
      const cheminResolu = path.resolve('../wt-existante');
      const mock = execFileSync as unknown as jest.Mock;
      // Les deux sondes `rev-parse` réussissent : la branche existe déjà.
      mock.mockImplementationOnce(() => Buffer.from(''));
      mock.mockImplementationOnce(() => Buffer.from(''));

      const result = handleWorktree(['add', '../wt-existante', 'sujet/existante']);

      expect(appelsGit()).toEqual([
        ['rev-parse', '--verify', 'sujet/existante'],
        ['rev-parse', '--verify', 'sujet/existante'],
        ['worktree', 'add', cheminResolu, 'sujet/existante'],
      ]);
      expect(result.entry?.content).toContain(`📁 Path: ${cheminResolu}`);
      expect(result.entry?.content).toContain('🌿 Branch: sujet/existante');
    });

    it('refuses to touch an existing path and runs no git command at all', () => {
      (existsSync as unknown as jest.Mock).mockReturnValueOnce(true);

      const result = handleWorktree(['add', '../wt-deja-la']);

      expect(appelsGit()).toEqual([]);
      expect(result.entry?.content).toContain('Path already exists');
    });
  });

  describe('remove worktree', () => {
    it('should remove worktree', () => {
      const result = handleWorktree(['remove', '/home/user/project-feature']);

      expect(result.handled).toBe(true);
    });

    it('should accept "rm" as alias', () => {
      const result = handleWorktree(['rm', '/home/user/project-feature']);

      expect(result.handled).toBe(true);
    });

    it('should show error when no path specified', () => {
      const result = handleWorktree(['remove']);

      expect(result.entry?.content).toContain('Usage:');
    });
  });

  describe('prune worktrees', () => {
    it('should handle prune command', () => {
      const result = handleWorktree(['prune']);

      expect(result.handled).toBe(true);
      // May succeed or show error depending on git state
      expect(result.entry?.content).toBeDefined();
    });
  });

  describe('entry structure', () => {
    it('should return proper entry type', () => {
      const result = handleWorktree(['list']);

      expect(result.entry?.type).toBe('assistant');
      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });

    it('should always set handled to true', () => {
      const results = [
        handleWorktree([]),
        handleWorktree(['list']),
        handleWorktree(['add', 'branch']),
        handleWorktree(['remove', 'path']),
        handleWorktree(['prune']),
        handleWorktree(['help']),
      ];

      results.forEach(result => {
        expect(result.handled).toBe(true);
      });
    });
  });

  describe('help content', () => {
    it('should include all commands in help', () => {
      const result = handleWorktree(['help']);

      expect(result.entry?.content).toContain('list');
      expect(result.entry?.content).toContain('add');
      expect(result.entry?.content).toContain('remove');
      expect(result.entry?.content).toContain('prune');
    });

    it('should include examples in help', () => {
      const result = handleWorktree(['help']);

      expect(result.entry?.content).toContain('Examples');
    });
  });
});

describe('Worktree Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle git not available', () => {
    (execFileSync as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error('git not available');
    });
    const result = handleWorktree(['list']);

    expect(result.handled).toBe(true);
    expect(result.entry).toBeDefined();
    expect(result.entry?.content).toContain('No worktrees found');
  });
});
