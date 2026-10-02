/**
 * Tests for legacy skill system deprecation warnings
 */

// Mock logger to capture deprecation warnings
// SkillManager uses logger.debug, SkillLoader uses logger.warn
const mockLoggerWarn = jest.fn();
const mockLoggerDebug = jest.fn();
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
    info: jest.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: jest.fn(),
  },
}));

import { vi } from 'vitest';

let SkillManager: typeof import('../../src/skills/skill-manager.js').SkillManager;
let SkillLoader: typeof import('../../src/skills/skill-loader.js').SkillLoader;

describe('Legacy Skill System Deprecation', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ SkillManager } = await import('../../src/skills/skill-manager.js'));
    ({ SkillLoader } = await import('../../src/skills/skill-loader.js'));
    mockLoggerWarn.mockClear();
    mockLoggerDebug.mockClear();
  });

  describe('SkillManager deprecation', () => {
    it('should emit deprecation warning on construction', () => {
      new SkillManager('/tmp/test');
      // SkillManager deprecation uses logger.debug (not logger.warn) with [DEPRECATED] prefix
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        expect.stringContaining('DEPRECATED')
      );
    });

    it('should still work (backwards compatible)', () => {
      const manager = new SkillManager('/tmp/test');
      const skills = manager.getAvailableSkills();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);
    });

    it('should still match skills', () => {
      const manager = new SkillManager('/tmp/test');
      const matches = manager.matchSkills('typescript type error');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skill.name).toBe('typescript-expert');
    });
  });

  describe('SkillLoader deprecation', () => {
    it('should emit deprecation warning on construction', () => {
      new SkillLoader({});
      // The deprecation warning uses logger.warn with [DEPRECATED] prefix
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('DEPRECATED')
      );
    });

    it('should still be constructable with config', () => {
      const loader = new SkillLoader({
        loadGlobal: false,
        loadProject: false,
      });
      expect(loader).toBeDefined();
    });
  });

  describe('Deprecated exports accessibility', () => {
    it('should still export SkillManager', () => {
      expect(SkillManager).toBeDefined();
      expect(typeof SkillManager).toBe('function');
    });

    it('should still export SkillLoader', () => {
      expect(SkillLoader).toBeDefined();
      expect(typeof SkillLoader).toBe('function');
    });
  });
});
