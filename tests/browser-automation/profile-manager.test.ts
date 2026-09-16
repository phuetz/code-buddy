import * as fs from 'fs/promises';
import * as path from 'path';
import { BrowserProfileManager } from '../../src/browser-automation/profile-manager.js';
import { readJsonAtomic, writeJsonAtomic } from '../../src/utils/atomic-write.js';

jest.mock('fs/promises');
jest.mock('../../src/utils/atomic-write.js', () => ({
  readJsonAtomic: jest.fn().mockResolvedValue(null),
  writeJsonAtomic: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockFs = jest.mocked(fs);
const mockReadJsonAtomic = jest.mocked(readJsonAtomic);
const mockWriteJsonAtomic = jest.mocked(writeJsonAtomic);

describe('BrowserProfileManager', () => {
  let manager: BrowserProfileManager;
  const testDir = '/tmp/test-profiles';

  const sampleProfileData = {
    cookies: [
      { name: 'session', value: 'abc123', domain: '.example.com', path: '/' },
      { name: 'pref', value: 'dark', secure: true },
    ],
    localStorage: {
      'https://example.com': { theme: 'dark', lang: 'en' },
    },
    sessionStorage: {
      'https://example.com': { tabId: '42' },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadJsonAtomic.mockResolvedValue(null);
    mockWriteJsonAtomic.mockResolvedValue(undefined);
    manager = new BrowserProfileManager(testDir);
  });

  describe('constructor', () => {
    it('should use provided profilesDir', async () => {
      const customManager = new BrowserProfileManager('/custom/dir');
      // Verify by saving and checking the path used
      mockFs.mkdir.mockResolvedValue(undefined);
      await customManager.save('test', sampleProfileData);
      expect(mockFs.mkdir).toHaveBeenCalledWith('/custom/dir', { recursive: true });
    });

    it('should use default directory when no profilesDir provided', async () => {
      const defaultManager = new BrowserProfileManager();
      mockFs.mkdir.mockResolvedValue(undefined);
      await defaultManager.save('test', sampleProfileData);
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('browser-profiles'),
        { recursive: true }
      );
    });
  });

  describe('save', () => {
    beforeEach(() => {
      mockFs.mkdir.mockResolvedValue(undefined);
    });

    it('should create the profiles directory recursively', async () => {
      await manager.save('my-profile', sampleProfileData);

      expect(mockFs.mkdir).toHaveBeenCalledWith(testDir, { recursive: true });
    });

    it('should write profile data through atomic JSON persistence', async () => {
      await manager.save('my-profile', sampleProfileData);

      expect(mockWriteJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, 'my-profile.json'),
        expect.objectContaining({
          name: 'my-profile',
          cookies: sampleProfileData.cookies,
          localStorage: sampleProfileData.localStorage,
          sessionStorage: sampleProfileData.sessionStorage,
          savedAt: expect.any(Date),
        }),
        { mode: 0o600 },
      );

      const writtenData = mockWriteJsonAtomic.mock.calls[0][1] as Record<string, unknown>;
      expect(writtenData.name).toBe('my-profile');
      expect(writtenData.cookies).toEqual(sampleProfileData.cookies);
      expect(writtenData.localStorage).toEqual(sampleProfileData.localStorage);
      expect(writtenData.sessionStorage).toEqual(sampleProfileData.sessionStorage);
      expect(writtenData.savedAt).toBeInstanceOf(Date);
    });

    it('should include savedAt timestamp in profile data', async () => {
      const before = new Date();
      await manager.save('timestamped', sampleProfileData);
      const after = new Date();

      expect(mockWriteJsonAtomic).toHaveBeenCalledTimes(1);
      const writtenData = mockWriteJsonAtomic.mock.calls[0][1] as { savedAt: Date };
      const savedAt = writtenData.savedAt;
      expect(savedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(savedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should sanitize profile name in filename', async () => {
      await manager.save('my profile/../../etc', sampleProfileData);

      expect(mockWriteJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, 'my_profile_______etc.json'),
        expect.objectContaining({ name: 'my profile/../../etc' }),
        { mode: 0o600 },
      );
    });

    it('should preserve the original name in the profile data', async () => {
      await manager.save('unsafe/name', sampleProfileData);

      expect(mockWriteJsonAtomic).toHaveBeenCalledTimes(1);
      const writtenData = mockWriteJsonAtomic.mock.calls[0][1] as { name: string };
      expect(writtenData.name).toBe('unsafe/name');
    });

    it('should save profile with empty data', async () => {
      await manager.save('empty', {
        cookies: [],
        localStorage: {},
        sessionStorage: {},
      });

      expect(mockWriteJsonAtomic).toHaveBeenCalledTimes(1);
      const writtenData = mockWriteJsonAtomic.mock.calls[0][1] as {
        cookies: unknown[];
        localStorage: Record<string, unknown>;
        sessionStorage: Record<string, unknown>;
      };
      expect(writtenData.cookies).toEqual([]);
      expect(writtenData.localStorage).toEqual({});
      expect(writtenData.sessionStorage).toEqual({});
    });
  });

  describe('load', () => {
    it('should load and parse profile from JSON file', async () => {
      const savedProfile = {
        name: 'test-profile',
        cookies: sampleProfileData.cookies,
        localStorage: sampleProfileData.localStorage,
        sessionStorage: sampleProfileData.sessionStorage,
        savedAt: '2025-01-15T10:30:00.000Z',
      };
      mockReadJsonAtomic.mockResolvedValue(savedProfile);

      const result = await manager.load('test-profile');

      expect(mockReadJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, 'test-profile.json'),
        null,
      );
      expect(result).not.toBeNull();
      expect(result!.name).toBe('test-profile');
      expect(result!.cookies).toEqual(sampleProfileData.cookies);
      expect(result!.localStorage).toEqual(sampleProfileData.localStorage);
      expect(result!.sessionStorage).toEqual(sampleProfileData.sessionStorage);
    });

    it('should convert savedAt string back to Date object', async () => {
      const savedProfile = {
        name: 'dated',
        cookies: [],
        localStorage: {},
        sessionStorage: {},
        savedAt: '2025-06-01T12:00:00.000Z',
      };
      mockReadJsonAtomic.mockResolvedValue(savedProfile);

      const result = await manager.load('dated');

      expect(result!.savedAt).toBeInstanceOf(Date);
      expect(result!.savedAt.toISOString()).toBe('2025-06-01T12:00:00.000Z');
    });

    it('should return null when atomic reader falls back for a missing profile', async () => {
      mockReadJsonAtomic.mockResolvedValue(null);

      const result = await manager.load('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when atomic reader falls back for invalid JSON', async () => {
      mockReadJsonAtomic.mockResolvedValue(null);

      const result = await manager.load('corrupted');

      expect(result).toBeNull();
    });

    it('should sanitize name when loading', async () => {
      mockReadJsonAtomic.mockResolvedValue(null);

      await manager.load('../../etc/passwd');

      expect(mockReadJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, '______etc_passwd.json'),
        null,
      );
    });
  });

  describe('save/load roundtrip', () => {
    it('should preserve data through save and load cycle', async () => {
      let savedProfile: Record<string, unknown> | null = null;
      mockFs.mkdir.mockResolvedValue(undefined);
      mockWriteJsonAtomic.mockImplementation(async (_path, data) => {
        savedProfile = data as Record<string, unknown>;
      });

      await manager.save('roundtrip', sampleProfileData);

      mockReadJsonAtomic.mockImplementation(async () => savedProfile);

      const loaded = await manager.load('roundtrip');

      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('roundtrip');
      expect(loaded!.cookies).toEqual(sampleProfileData.cookies);
      expect(loaded!.localStorage).toEqual(sampleProfileData.localStorage);
      expect(loaded!.sessionStorage).toEqual(sampleProfileData.sessionStorage);
      expect(loaded!.savedAt).toBeInstanceOf(Date);
    });
  });

  describe('list', () => {
    it('should return profile names from JSON files in directory', async () => {
      mockFs.readdir.mockResolvedValue([
        'profile-a.json',
        'profile-b.json',
        'work-profile.json',
      ] as string[]);

      const result = await manager.list();

      expect(mockFs.readdir).toHaveBeenCalledWith(testDir);
      expect(result).toEqual(['profile-a', 'profile-b', 'work-profile']);
    });

    it('should filter out non-JSON files', async () => {
      mockFs.readdir.mockResolvedValue([
        'valid.json',
        'readme.txt',
        'backup.json.bak',
        'another.json',
        '.hidden',
      ] as string[]);

      const result = await manager.list();

      expect(result).toEqual(['valid', 'another']);
    });

    it('should return empty array when directory does not exist', async () => {
      mockFs.readdir.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      const result = await manager.list();

      expect(result).toEqual([]);
    });

    it('should return empty array when directory is empty', async () => {
      mockFs.readdir.mockResolvedValue([]);

      const result = await manager.list();

      expect(result).toEqual([]);
    });

    it('should return empty array on permission error', async () => {
      mockFs.readdir.mockRejectedValue(
        Object.assign(new Error('EACCES'), { code: 'EACCES' })
      );

      const result = await manager.list();

      expect(result).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete the profile file and return true', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await manager.delete('old-profile');

      expect(mockFs.unlink).toHaveBeenCalledWith(
        path.join(testDir, 'old-profile.json')
      );
      expect(result).toBe(true);
    });

    it('should return false when profile does not exist', async () => {
      mockFs.unlink.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      const result = await manager.delete('nonexistent');

      expect(result).toBe(false);
    });

    it('should return false on permission error', async () => {
      mockFs.unlink.mockRejectedValue(
        Object.assign(new Error('EACCES'), { code: 'EACCES' })
      );

      const result = await manager.delete('protected');

      expect(result).toBe(false);
    });

    it('should sanitize name when deleting', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await manager.delete('../../etc/passwd');

      expect(mockFs.unlink).toHaveBeenCalledWith(
        path.join(testDir, '______etc_passwd.json')
      );
    });
  });

  describe('name sanitization', () => {
    beforeEach(() => {
      mockFs.mkdir.mockResolvedValue(undefined);
    });

    it('should allow alphanumeric characters, hyphens, and underscores', async () => {
      await manager.save('valid-name_123', sampleProfileData);

      expect(mockWriteJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, 'valid-name_123.json'),
        expect.objectContaining({ name: 'valid-name_123' }),
        { mode: 0o600 },
      );
    });

    it('should replace spaces with underscores', async () => {
      await manager.save('my profile name', sampleProfileData);

      expect(mockWriteJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, 'my_profile_name.json'),
        expect.objectContaining({ name: 'my profile name' }),
        { mode: 0o600 },
      );
    });

    it('should replace dots with underscores', async () => {
      await manager.save('profile.v2.backup', sampleProfileData);

      expect(mockWriteJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, 'profile_v2_backup.json'),
        expect.objectContaining({ name: 'profile.v2.backup' }),
        { mode: 0o600 },
      );
    });

    it('should replace path separators to prevent traversal', async () => {
      await manager.save('../../../etc/passwd', sampleProfileData);

      expect(mockWriteJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, '_________etc_passwd.json'),
        expect.objectContaining({ name: '../../../etc/passwd' }),
        { mode: 0o600 },
      );
    });

    it('should replace special characters', async () => {
      await manager.save('name@with#special$chars!', sampleProfileData);

      expect(mockWriteJsonAtomic).toHaveBeenCalledWith(
        path.join(testDir, 'name_with_special_chars_.json'),
        expect.objectContaining({ name: 'name@with#special$chars!' }),
        { mode: 0o600 },
      );
    });
  });
});
