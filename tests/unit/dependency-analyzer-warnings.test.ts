import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  exists: vi.fn(),
  readFile: vi.fn(),
  readDirectory: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mocks.execSync,
}));

vi.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      exists: mocks.exists,
      readFile: mocks.readFile,
      readDirectory: mocks.readDirectory,
    },
  },
}));

import { analyzeDependencies, formatDependencyReport } from '../../src/tools/dependency-analyzer.js';

describe('Dependency analyzer partial checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exists.mockImplementation((filePath: string) => filePath.endsWith('package.json'));
    mocks.readFile.mockResolvedValue(JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: {},
    }));
    mocks.readDirectory.mockResolvedValue([]);
  });

  it('should warn when optional dependency checks cannot run', async () => {
    mocks.execSync.mockImplementation((command: string) => {
      if (command.startsWith('npm outdated')) {
        throw new Error('npm unavailable');
      }
      if (command.startsWith('npx madge')) {
        throw new Error('madge unavailable');
      }
      return '{}';
    });

    const analysis = await analyzeDependencies({
      rootDir: '/project',
      checkOutdated: true,
      checkUnused: false,
      checkCircular: true,
      buildGraph: false,
    });

    expect(analysis.outdatedCount).toBe(0);
    expect(analysis.circular).toEqual([]);
    expect(analysis.warnings).toEqual([
      'npm outdated did not return output; outdated dependency check is incomplete.',
      'madge circular dependency check did not run; circular dependency results are incomplete.',
    ]);

    const formatted = formatDependencyReport(analysis);
    expect(formatted).toContain('Warnings:');
    expect(formatted).toContain('outdated dependency check is incomplete');
    expect(formatted).toContain('circular dependency results are incomplete');
  });
});
