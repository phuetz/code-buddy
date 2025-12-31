/**
 * Comprehensive Unit Tests for Version Detector
 *
 * Tests cover:
 * 1. Initialization and configuration
 * 2. Package version detection
 * 3. Stored version detection
 * 4. Config version detection
 * 5. Version comparison
 * 6. Version validation
 * 7. Upgrade path calculation
 * 8. Caching and events
 */

import { EventEmitter } from 'events';

// Mock fs-extra before importing the module
const mockEnsureDir = jest.fn().mockResolvedValue(undefined);
const mockPathExists = jest.fn().mockResolvedValue(false);
const mockReadJson = jest.fn().mockResolvedValue({});
const mockWriteJson = jest.fn().mockResolvedValue(undefined);

jest.mock('fs-extra', () => ({
  ensureDir: mockEnsureDir,
  pathExists: mockPathExists,
  readJson: mockReadJson,
  writeJson: mockWriteJson,
}));

// Helper function to parse version
const parseVersion = (v: string): { major: number; minor: number; patch: number } => {
  const [major, minor, patch] = v.split('.').map((p) => parseInt(p, 10) || 0);
  return { major, minor, patch };
};

// Helper function to compare versions
const compareVersions = (a: string, b: string): number => {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
};

// Helper function to parse full version
const parseFullVersion = (v: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
} | null => {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)(-([a-zA-Z0-9.]+))?(\+([a-zA-Z0-9.]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[5] ? match[5].split('.') : [],
    build: match[7] ? match[7].split('.') : [],
  };
};

// Mock semver
jest.mock('semver', () => ({
  valid: jest.fn((v: string): string | null => {
    const regex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
    return regex.test(v) ? v : null;
  }),
  coerce: jest.fn((v: string): { version: string } | null => {
    const match = v.match(/(\d+)\.?(\d+)?\.?(\d+)?/);
    if (!match) return null;
    const version = `${match[1] || 0}.${match[2] || 0}.${match[3] || 0}`;
    return { version };
  }),
  compare: jest.fn((a: string, b: string): number => compareVersions(a, b)),
  parse: jest.fn((v: string) => parseFullVersion(v)),
  eq: jest.fn((a: string, b: string): boolean => a === b),
  lt: jest.fn((a: string, b: string): boolean => compareVersions(a, b) < 0),
  gt: jest.fn((a: string, b: string): boolean => compareVersions(a, b) > 0),
  lte: jest.fn((a: string, b: string): boolean => compareVersions(a, b) <= 0),
  gte: jest.fn((a: string, b: string): boolean => compareVersions(a, b) >= 0),
  satisfies: jest.fn((version: string, range: string): boolean => {
    // Simple implementation for testing
    if (range.startsWith('^')) {
      const rangeVersion = range.slice(1);
      const vParsed = parseFullVersion(version);
      const rParsed = parseFullVersion(rangeVersion);
      if (!vParsed || !rParsed) return false;
      return vParsed.major === rParsed.major && compareVersions(version, rangeVersion) >= 0;
    }
    if (range.startsWith('>=')) {
      return compareVersions(version, range.slice(2)) >= 0;
    }
    return version === range;
  }),
}));

import {
  VersionDetector,
  getVersionDetector,
  resetVersionDetector,
} from '../../src/versioning/version-detector';

describe('VersionDetector', () => {
  let detector: VersionDetector;

  beforeEach(() => {
    jest.clearAllMocks();
    resetVersionDetector();

    mockPathExists.mockResolvedValue(false);
    mockReadJson.mockResolvedValue({});

    detector = new VersionDetector({
      dataDir: '/test/data',
      configDir: '/test/config',
      packageJsonPath: '/test/package.json',
      versionFile: 'version.json',
    });
  });

  afterEach(() => {
    detector.dispose();
  });

  describe('Constructor and Initialization', () => {
    it('should create detector with default config', () => {
      const defaultDetector = new VersionDetector();
      expect(defaultDetector).toBeDefined();
      expect(defaultDetector).toBeInstanceOf(VersionDetector);
      expect(defaultDetector).toBeInstanceOf(EventEmitter);
      defaultDetector.dispose();
    });

    it('should create detector with custom config', () => {
      expect(detector).toBeDefined();
      expect(detector.isInitialized()).toBe(false);
    });

    it('should initialize correctly', async () => {
      await detector.initialize();
      expect(detector.isInitialized()).toBe(true);
    });

    it('should emit initialized event', async () => {
      const handler = jest.fn();
      detector.on('initialized', handler);
      await detector.initialize();
      expect(handler).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await detector.initialize();
      const spy = jest.spyOn(detector, 'detectAllVersions');
      await detector.initialize();
      expect(spy).not.toHaveBeenCalled();
    });

    it('should detect all versions on initialization', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockImplementation((path: string) => {
        if (path.includes('package.json')) {
          return Promise.resolve({ version: '1.0.0', name: 'test-app' });
        }
        return Promise.resolve({});
      });
      await detector.initialize();
      const versions = detector.getAllVersions();
      expect(versions.size).toBeGreaterThan(0);
    });
  });

  describe('Package Version Detection', () => {
    it('should detect package.json version', async () => {
      mockPathExists.mockImplementation((path: string) =>
        Promise.resolve(path.includes('package.json'))
      );
      mockReadJson.mockResolvedValue({
        version: '1.2.3',
        name: 'test-app',
        description: 'Test application',
      });
      const versionInfo = await detector.detectPackageVersion();
      expect(versionInfo).not.toBeNull();
      expect(versionInfo!.version).toBe('1.2.3');
      expect(versionInfo!.source).toBe('package.json');
      expect(versionInfo!.metadata?.name).toBe('test-app');
    });

    it('should return null when package.json does not exist', async () => {
      mockPathExists.mockResolvedValue(false);
      const versionInfo = await detector.detectPackageVersion();
      expect(versionInfo).toBeNull();
    });

    it('should return null for invalid version in package.json', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ version: 'invalid' });
      const versionInfo = await detector.detectPackageVersion();
      expect(versionInfo).toBeNull();
    });

    it('should return null when version is missing', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ name: 'test-app' });
      const versionInfo = await detector.detectPackageVersion();
      expect(versionInfo).toBeNull();
    });

    it('should handle package.json read errors', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockRejectedValue(new Error('Read error'));
      const versionInfo = await detector.detectPackageVersion();
      expect(versionInfo).toBeNull();
    });
  });

  describe('Stored Version Detection', () => {
    it('should detect stored version', async () => {
      mockPathExists.mockImplementation((path: string) =>
        Promise.resolve(path.includes('version.json'))
      );
      mockReadJson.mockResolvedValue({
        version: '2.0.0',
        detectedAt: new Date().toISOString(),
        metadata: { upgraded: true },
      });
      const versionInfo = await detector.detectStoredVersion();
      expect(versionInfo).not.toBeNull();
      expect(versionInfo!.version).toBe('2.0.0');
      expect(versionInfo!.source).toBe('version.json');
    });

    it('should return null when version file does not exist', async () => {
      mockPathExists.mockResolvedValue(false);
      const versionInfo = await detector.detectStoredVersion();
      expect(versionInfo).toBeNull();
    });

    it('should return null for invalid stored version', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ version: 'not-valid' });
      const versionInfo = await detector.detectStoredVersion();
      expect(versionInfo).toBeNull();
    });

    it('should handle version file read errors', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockRejectedValue(new Error('Read error'));
      const versionInfo = await detector.detectStoredVersion();
      expect(versionInfo).toBeNull();
    });
  });

  describe('Config Version Detection', () => {
    it('should detect config version from _version field', async () => {
      mockPathExists.mockImplementation((path: string) =>
        Promise.resolve(path.includes('settings.json'))
      );
      mockReadJson.mockResolvedValue({
        _version: '3.0.0',
        _format: 'json',
        setting1: 'value1',
      });
      const versionInfo = await detector.detectConfigVersion();
      expect(versionInfo).not.toBeNull();
      expect(versionInfo!.version).toBe('3.0.0');
      expect(versionInfo!.source).toBe('config');
    });

    it('should detect config version from version field', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        version: '2.5.0',
        setting1: 'value1',
      });
      const versionInfo = await detector.detectConfigVersion();
      expect(versionInfo).not.toBeNull();
      expect(versionInfo!.version).toBe('2.5.0');
    });

    it('should detect config version from configVersion field', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        configVersion: '1.5.0',
        setting1: 'value1',
      });
      const versionInfo = await detector.detectConfigVersion();
      expect(versionInfo).not.toBeNull();
      expect(versionInfo!.version).toBe('1.5.0');
    });

    it('should coerce non-semver versions', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        version: '1.0',
        setting1: 'value1',
      });
      const versionInfo = await detector.detectConfigVersion();
      expect(versionInfo).not.toBeNull();
      expect(versionInfo!.version).toBe('1.0.0');
    });

    it('should return null when config does not exist', async () => {
      mockPathExists.mockResolvedValue(false);
      const versionInfo = await detector.detectConfigVersion();
      expect(versionInfo).toBeNull();
    });

    it('should return null when no version in config', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        setting1: 'value1',
      });
      const versionInfo = await detector.detectConfigVersion();
      expect(versionInfo).toBeNull();
    });
  });

  describe('Version Getters', () => {
    beforeEach(async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        if (path.includes('version.json')) return Promise.resolve(true);
        if (path.includes('settings.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockImplementation((path: string) => {
        if (path.includes('package.json')) {
          return Promise.resolve({ version: '1.0.0', name: 'test' });
        }
        if (path.includes('version.json')) {
          return Promise.resolve({ version: '1.1.0' });
        }
        if (path.includes('settings.json')) {
          return Promise.resolve({ _version: '1.2.0' });
        }
        return Promise.resolve({});
      });
      await detector.initialize();
    });

    it('should get package version', () => {
      expect(detector.getPackageVersion()).toBe('1.0.0');
    });

    it('should get stored version', () => {
      expect(detector.getStoredVersion()).toBe('1.1.0');
    });

    it('should get config version', () => {
      expect(detector.getConfigVersion()).toBe('1.2.0');
    });

    it('should get current version prioritizing package', () => {
      expect(detector.getCurrentVersion()).toBe('1.0.0');
    });

    it('should fallback to stored version when no package version', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('version.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockImplementation((path: string) => {
        if (path.includes('version.json')) {
          return Promise.resolve({ version: '2.0.0' });
        }
        return Promise.resolve({});
      });
      const newDetector = new VersionDetector({
        dataDir: '/test/data',
        configDir: '/test/config',
        packageJsonPath: '/test/package.json',
      });
      await newDetector.initialize();
      expect(newDetector.getCurrentVersion()).toBe('2.0.0');
      newDetector.dispose();
    });

    it('should return 0.0.0 when no versions detected', async () => {
      mockPathExists.mockResolvedValue(false);
      const newDetector = new VersionDetector({
        dataDir: '/test/data',
        configDir: '/test/config',
        packageJsonPath: '/test/package.json',
      });
      await newDetector.initialize();
      expect(newDetector.getCurrentVersion()).toBe('0.0.0');
      newDetector.dispose();
    });
  });

  describe('Store Version', () => {
    beforeEach(async () => {
      await detector.initialize();
    });

    it('should store version to file', async () => {
      await detector.storeVersion('2.0.0', { reason: 'upgrade' });
      expect(mockEnsureDir).toHaveBeenCalledWith('/test/data');
      expect(mockWriteJson).toHaveBeenCalled();
      const writeCall = mockWriteJson.mock.calls[0];
      expect(writeCall[0]).toContain('version.json');
      expect(writeCall[1].version).toBe('2.0.0');
    });

    it('should update cached version', async () => {
      await detector.storeVersion('2.0.0');
      expect(detector.getStoredVersion()).toBe('2.0.0');
    });

    it('should emit version:stored event', async () => {
      const handler = jest.fn();
      detector.on('version:stored', handler);
      await detector.storeVersion('2.0.0');
      expect(handler).toHaveBeenCalledWith('2.0.0');
    });

    it('should throw for invalid version', async () => {
      await expect(detector.storeVersion('invalid')).rejects.toThrow(
        'Invalid version'
      );
    });
  });

  describe('Version Comparison', () => {
    it('should compare equal versions', () => {
      const result = detector.compareVersions('1.0.0', '1.0.0');
      expect(result.relation).toBe('equal');
      expect(result.needsUpgrade).toBe(false);
      expect(result.majorDiff).toBe(0);
      expect(result.minorDiff).toBe(0);
      expect(result.patchDiff).toBe(0);
    });

    it('should identify older version', () => {
      const result = detector.compareVersions('1.0.0', '2.0.0');
      expect(result.relation).toBe('older');
      expect(result.needsUpgrade).toBe(true);
      expect(result.majorDiff).toBe(1);
    });

    it('should identify newer version', () => {
      const result = detector.compareVersions('2.0.0', '1.0.0');
      expect(result.relation).toBe('newer');
      expect(result.needsUpgrade).toBe(false);
      expect(result.majorDiff).toBe(-1);
    });

    it('should handle invalid versions', () => {
      const result = detector.compareVersions('invalid', '1.0.0');
      expect(result.relation).toBe('invalid');
      expect(result.needsUpgrade).toBe(false);
    });

    it('should calculate version diffs correctly', () => {
      const result = detector.compareVersions('1.2.3', '2.4.6');
      expect(result.majorDiff).toBe(1);
      expect(result.minorDiff).toBe(2);
      expect(result.patchDiff).toBe(3);
    });
  });

  describe('Needs Upgrade', () => {
    it('should return true when stored version is older', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        if (path.includes('version.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockImplementation((path: string) => {
        if (path.includes('package.json')) {
          return Promise.resolve({ version: '2.0.0' });
        }
        if (path.includes('version.json')) {
          return Promise.resolve({ version: '1.0.0' });
        }
        return Promise.resolve({});
      });
      await detector.initialize();
      expect(detector.needsUpgrade()).toBe(true);
    });

    it('should return false when versions are equal', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockImplementation((path: string) => {
        if (path.includes('package.json')) {
          return Promise.resolve({ version: '1.0.0' });
        }
        if (path.includes('version.json')) {
          return Promise.resolve({ version: '1.0.0' });
        }
        return Promise.resolve({});
      });
      await detector.initialize();
      expect(detector.needsUpgrade()).toBe(false);
    });

    it('should return false when no package version', async () => {
      mockPathExists.mockResolvedValue(false);
      await detector.initialize();
      expect(detector.needsUpgrade()).toBe(false);
    });
  });

  describe('Upgrade Path', () => {
    it('should return empty path when already at target', () => {
      const path = detector.getUpgradePath('2.0.0', '1.0.0');
      expect(path).toEqual([]);
    });

    it('should return empty path for invalid versions', () => {
      const path = detector.getUpgradePath('invalid', '1.0.0');
      expect(path).toEqual([]);
    });

    it('should return upgrade path for major versions', () => {
      const path = detector.getUpgradePath('1.0.0', '3.0.0');
      expect(path).toContain('2.0.0');
      expect(path).toContain('3.0.0');
    });

    it('should return upgrade path for minor versions', () => {
      const path = detector.getUpgradePath('1.0.0', '1.2.0');
      expect(path).toContain('1.1.0');
      expect(path).toContain('1.2.0');
    });

    it('should include target version at end', () => {
      const path = detector.getUpgradePath('1.0.0', '1.0.5');
      expect(path[path.length - 1]).toBe('1.0.5');
    });
  });

  describe('Version Validation', () => {
    it('should validate correct semver', () => {
      expect(detector.isValidVersion('1.0.0')).toBe(true);
      expect(detector.isValidVersion('1.2.3')).toBe(true);
      expect(detector.isValidVersion('0.0.1')).toBe(true);
    });

    it('should reject invalid versions', () => {
      expect(detector.isValidVersion('invalid')).toBe(false);
      expect(detector.isValidVersion('1.0')).toBe(false);
      expect(detector.isValidVersion('')).toBe(false);
    });

    it('should accept prerelease versions', () => {
      expect(detector.isValidVersion('1.0.0-alpha')).toBe(true);
      expect(detector.isValidVersion('1.0.0-beta.1')).toBe(true);
    });
  });

  describe('Version Coercion', () => {
    it('should coerce partial versions', () => {
      expect(detector.coerceVersion('1')).toBe('1.0.0');
      expect(detector.coerceVersion('1.2')).toBe('1.2.0');
    });

    it('should handle full versions', () => {
      expect(detector.coerceVersion('1.2.3')).toBe('1.2.3');
    });

    it('should return null for non-coercible strings', () => {
      const semver = require('semver');
      semver.coerce.mockReturnValueOnce(null);
      expect(detector.coerceVersion('not-a-version')).toBeNull();
    });
  });

  describe('Parse Version', () => {
    it('should parse valid version', () => {
      const parsed = detector.parseVersion('1.2.3');
      expect(parsed).not.toBeNull();
      expect(parsed!.major).toBe(1);
      expect(parsed!.minor).toBe(2);
      expect(parsed!.patch).toBe(3);
    });

    it('should parse prerelease version', () => {
      const parsed = detector.parseVersion('1.0.0-alpha.1');
      expect(parsed).not.toBeNull();
      expect(parsed!.prerelease).toContain('alpha');
    });

    it('should return null for invalid version', () => {
      const semver = require('semver');
      semver.parse.mockReturnValueOnce(null);
      const parsed = detector.parseVersion('invalid');
      expect(parsed).toBeNull();
    });
  });

  describe('Satisfies Range', () => {
    it('should check caret range', () => {
      expect(detector.satisfiesRange('1.2.3', '^1.0.0')).toBe(true);
      expect(detector.satisfiesRange('2.0.0', '^1.0.0')).toBe(false);
    });

    it('should check gte range', () => {
      expect(detector.satisfiesRange('2.0.0', '>=1.0.0')).toBe(true);
      expect(detector.satisfiesRange('0.9.0', '>=1.0.0')).toBe(false);
    });

    it('should check exact version', () => {
      expect(detector.satisfiesRange('1.0.0', '1.0.0')).toBe(true);
      expect(detector.satisfiesRange('1.0.1', '1.0.0')).toBe(false);
    });
  });

  describe('Cache Management', () => {
    beforeEach(async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ version: '1.0.0' });
      await detector.initialize();
    });

    it('should return all cached versions', () => {
      const versions = detector.getAllVersions();
      expect(versions).toBeInstanceOf(Map);
    });

    it('should get version by source', () => {
      const version = detector.getVersion('package');
      expect(version).toBeDefined();
    });

    it('should return undefined for unknown source', () => {
      const version = detector.getVersion('unknown');
      expect(version).toBeUndefined();
    });

    it('should clear cache', () => {
      const handler = jest.fn();
      detector.on('cache:cleared', handler);
      detector.clearCache();
      expect(detector.getAllVersions().size).toBe(0);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Detect All Versions', () => {
    it('should emit versions:detected event', async () => {
      const handler = jest.fn();
      detector.on('versions:detected', handler);
      await detector.detectAllVersions();
      expect(handler).toHaveBeenCalled();
    });

    it('should clear previous cache', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ version: '1.0.0' });
      await detector.detectAllVersions();
      const firstSize = detector.getAllVersions().size;
      mockPathExists.mockResolvedValue(false);
      await detector.detectAllVersions();
      expect(detector.getAllVersions().size).toBeLessThanOrEqual(firstSize);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getVersionDetector', () => {
      const instance1 = getVersionDetector();
      const instance2 = getVersionDetector();
      expect(instance1).toBe(instance2);
      resetVersionDetector();
    });

    it('should reset singleton', () => {
      const instance1 = getVersionDetector();
      resetVersionDetector();
      const instance2 = getVersionDetector();
      expect(instance1).not.toBe(instance2);
      resetVersionDetector();
    });
  });

  describe('Dispose', () => {
    it('should clean up resources on dispose', async () => {
      await detector.initialize();
      detector.dispose();
      expect(detector.getAllVersions().size).toBe(0);
      expect(detector.isInitialized()).toBe(false);
    });

    it('should remove all event listeners on dispose', () => {
      const handler = jest.fn();
      detector.on('initialized', handler);
      detector.dispose();
      expect(detector.listenerCount('initialized')).toBe(0);
    });
  });
});
