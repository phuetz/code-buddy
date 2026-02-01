/**
 * Skill Eligibility Tests
 */

import {
  isBinaryAvailable,
  getBinaryPath,
  checkBinaries,
  clearBinaryCache,
  isEnvSet,
  checkEnvVars,
  isConfigPresent,
  checkConfigs,
  isPlatformSupported,
  getCurrentPlatform,
  compareVersions,
  isNodeVersionSufficient,
  checkEligibility,
  parseRequirements,
  type SkillRequirements,
} from '../../src/skills/eligibility.js';

describe('Skill Eligibility', () => {
  beforeEach(() => {
    clearBinaryCache();
  });

  describe('isBinaryAvailable', () => {
    it('should return true for common binaries', () => {
      // node should always be available in test environment
      expect(isBinaryAvailable('node')).toBe(true);
    });

    it('should return false for non-existent binaries', () => {
      expect(isBinaryAvailable('nonexistent-binary-xyz-123')).toBe(false);
    });

    it('should cache results', () => {
      // First call
      const result1 = isBinaryAvailable('node');
      // Second call should use cache
      const result2 = isBinaryAvailable('node');
      expect(result1).toBe(result2);
    });
  });

  describe('getBinaryPath', () => {
    it('should return path for existing binary', () => {
      const path = getBinaryPath('node');
      expect(path).toBeDefined();
      expect(path).toContain('node');
    });

    it('should return undefined for non-existent binary', () => {
      const path = getBinaryPath('nonexistent-binary-xyz-123');
      expect(path).toBeUndefined();
    });
  });

  describe('checkBinaries', () => {
    it('should check multiple binaries', () => {
      const results = checkBinaries(['node', 'nonexistent-xyz']);
      expect(results.get('node')).toBe(true);
      expect(results.get('nonexistent-xyz')).toBe(false);
    });
  });

  describe('isEnvSet', () => {
    it('should return true for set variables', () => {
      process.env.TEST_VAR = 'value';
      expect(isEnvSet('TEST_VAR')).toBe(true);
      delete process.env.TEST_VAR;
    });

    it('should return false for unset variables', () => {
      expect(isEnvSet('NONEXISTENT_VAR_XYZ_123')).toBe(false);
    });

    it('should return false for empty variables', () => {
      process.env.EMPTY_VAR = '';
      expect(isEnvSet('EMPTY_VAR')).toBe(false);
      delete process.env.EMPTY_VAR;
    });
  });

  describe('checkEnvVars', () => {
    it('should check multiple env vars', () => {
      process.env.TEST_VAR_1 = 'value';
      const results = checkEnvVars(['TEST_VAR_1', 'NONEXISTENT_VAR']);
      expect(results.get('TEST_VAR_1')).toBe(true);
      expect(results.get('NONEXISTENT_VAR')).toBe(false);
      delete process.env.TEST_VAR_1;
    });
  });

  describe('isConfigPresent', () => {
    it('should return true for existing files', () => {
      expect(isConfigPresent(__filename)).toBe(true);
    });

    it('should return false for non-existent files', () => {
      expect(isConfigPresent('/nonexistent/path/file.json')).toBe(false);
    });

    it('should expand ~ to home directory', () => {
      // This should not throw
      const result = isConfigPresent('~/.nonexistent-file-xyz');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('checkConfigs', () => {
    it('should check multiple config files', () => {
      const results = checkConfigs([__filename, '/nonexistent/file']);
      expect(results.get(__filename)).toBe(true);
      expect(results.get('/nonexistent/file')).toBe(false);
    });
  });

  describe('isPlatformSupported', () => {
    it('should return true for current platform', () => {
      expect(isPlatformSupported(process.platform)).toBe(true);
    });

    it('should return false for unsupported platform', () => {
      expect(isPlatformSupported('unsupported-os')).toBe(false);
    });

    it('should support array of platforms', () => {
      expect(isPlatformSupported(['linux', 'darwin', 'win32'])).toBe(true);
    });
  });

  describe('getCurrentPlatform', () => {
    it('should return current platform', () => {
      expect(getCurrentPlatform()).toBe(process.platform);
    });
  });

  describe('compareVersions', () => {
    it('should compare versions correctly', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
      expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    });

    it('should handle v prefix', () => {
      expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    });
  });

  describe('isNodeVersionSufficient', () => {
    it('should return true for lower versions', () => {
      expect(isNodeVersionSufficient('1.0.0')).toBe(true);
    });

    it('should return false for higher versions', () => {
      expect(isNodeVersionSufficient('999.0.0')).toBe(false);
    });
  });

  describe('checkEligibility', () => {
    it('should return eligible for empty requirements', () => {
      const result = checkEligibility({});
      expect(result.eligible).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('should check required binaries', () => {
      const result = checkEligibility({
        bins: ['node', 'nonexistent-binary-xyz'],
      });
      expect(result.eligible).toBe(false);
      expect(result.missingBins).toContain('nonexistent-binary-xyz');
    });

    it('should check anyBins (at least one)', () => {
      const resultPass = checkEligibility({
        anyBins: ['node', 'nonexistent-xyz'],
      });
      expect(resultPass.eligible).toBe(true);

      const resultFail = checkEligibility({
        anyBins: ['nonexistent-1', 'nonexistent-2'],
      });
      expect(resultFail.eligible).toBe(false);
    });

    it('should check environment variables', () => {
      process.env.TEST_ELIG_VAR = 'value';
      const result = checkEligibility({
        env: ['TEST_ELIG_VAR', 'NONEXISTENT_VAR'],
      });
      expect(result.eligible).toBe(false);
      expect(result.missingEnv).toContain('NONEXISTENT_VAR');
      delete process.env.TEST_ELIG_VAR;
    });

    it('should check platform', () => {
      const result = checkEligibility({
        platform: 'unsupported-os',
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons[0]).toContain('Unsupported platform');
    });

    it('should check Node.js version', () => {
      const result = checkEligibility({
        nodeVersion: '999.0.0',
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons[0]).toContain('Node.js version');
    });

    it('should combine multiple checks', () => {
      const result = checkEligibility({
        bins: ['nonexistent-1'],
        env: ['NONEXISTENT_ENV'],
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('parseRequirements', () => {
    it('should parse JSON format', () => {
      const result = parseRequirements('{"bins": ["git", "docker"], "env": ["HOME"]}');
      expect(result).toEqual({
        bins: ['git', 'docker'],
        env: ['HOME'],
      });
    });

    it('should parse simplified format', () => {
      const result = parseRequirements('bins=git,docker env=HOME');
      expect(result).toEqual({
        bins: ['git', 'docker'],
        env: ['HOME'],
      });
    });

    it('should parse anyBins', () => {
      const result = parseRequirements('anyBins=python,python3,node');
      expect(result?.anyBins).toEqual(['python', 'python3', 'node']);
    });

    it('should parse platform', () => {
      const result = parseRequirements('platform=linux,darwin');
      expect(result?.platform).toEqual(['linux', 'darwin']);
    });

    it('should return null for empty string', () => {
      const result = parseRequirements('');
      expect(result).toBeNull();
    });

    it('should return null for invalid format', () => {
      const result = parseRequirements('invalid');
      expect(result).toBeNull();
    });
  });
});
