import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  PathValidator,
  getPathValidator,
  initializePathValidator,
  validatePath,
  isPathSafe,
} from '../../src/utils/path-validator';

describe('PathValidator', () => {
  let validator: PathValidator;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'path-validator-test-'));
    validator = new PathValidator({ baseDirectory: tempDir });
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('constructor', () => {
    it('should create with base directory', () => {
      const v = new PathValidator({ baseDirectory: '/some/path' });
      expect(v).toBeInstanceOf(PathValidator);
    });

    it('should use cwd as default base directory', () => {
      const v = new PathValidator();
      expect(v.getBaseDirectory()).toBe(process.cwd());
    });

    it('should accept checkSymlinks option', () => {
      const v = new PathValidator({ checkSymlinks: false });
      expect(v).toBeInstanceOf(PathValidator);
    });

    it('should accept additionalAllowedPaths option', () => {
      const v = new PathValidator({
        baseDirectory: tempDir,
        additionalAllowedPaths: ['/tmp'],
      });
      expect(v).toBeInstanceOf(PathValidator);
    });
  });

  describe('setBaseDirectory', () => {
    it('should update base directory', () => {
      const newPath = path.resolve('/new/path');
      validator.setBaseDirectory(newPath);
      expect(validator.getBaseDirectory()).toBe(newPath);
    });
  });

  describe('getBaseDirectory', () => {
    it('should return current base directory', () => {
      expect(validator.getBaseDirectory()).toBe(tempDir);
    });
  });

  describe('validate', () => {
    it('should accept valid paths within base directory', () => {
      const filePath = path.join(tempDir, 'test.txt');
      const result = validator.validate(filePath);
      expect(result.valid).toBe(true);
      expect(result.resolved).toBe(filePath);
    });

    it('should reject empty path', () => {
      const result = validator.validate('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non-empty string');
    });

    it('should reject paths outside base directory', () => {
      const outsidePath = path.join(tempDir, '..', 'outside.txt');
      const result = validator.validate(outsidePath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('outside');
    });

    it('should reject path traversal attempts with ..', () => {
      const traversalPath = path.join(tempDir, 'subdir', '..', '..', 'etc', 'passwd');
      const result = validator.validate(traversalPath);
      expect(result.valid).toBe(false);
    });

    it('should reject absolute paths outside base', () => {
      const result = validator.validate('/etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('outside');
    });

    it('should handle nested subdirectories correctly', () => {
      const nestedPath = path.join(tempDir, 'a', 'b', 'c', 'file.txt');
      const result = validator.validate(nestedPath);
      expect(result.valid).toBe(true);
      expect(result.resolved).toBe(nestedPath);
    });

    it('should normalize paths with dots', () => {
      const messyPath = path.join(tempDir, 'subdir', '.', 'file.txt');
      const result = validator.validate(messyPath);
      expect(result.valid).toBe(true);
    });

    it('should allow paths in additional allowed directories', () => {
      const validatorWithExtra = new PathValidator({
        baseDirectory: tempDir,
        additionalAllowedPaths: ['/tmp'],
      });
      const result = validatorWithExtra.validate('/tmp/test.txt');
      expect(result.valid).toBe(true);
    });

    it('should allow paths when allowOutsideBase is true', () => {
      const permissiveValidator = new PathValidator({
        baseDirectory: tempDir,
        allowOutsideBase: true,
      });
      const result = permissiveValidator.validate('/etc/passwd');
      expect(result.valid).toBe(true);
    });
  });

  describe('symlink validation', () => {
    it('should reject symlinks pointing outside base directory', async () => {
      // Create a symlink that points outside
      const linkPath = path.join(tempDir, 'evil-link');
      const targetPath = '/tmp';

      await fs.ensureSymlink(targetPath, linkPath);

      const validatorWithSymlinkCheck = new PathValidator({
        baseDirectory: tempDir,
        checkSymlinks: true,
      });
      const result = validatorWithSymlinkCheck.validate(linkPath);

      // Should be invalid because symlink points outside base
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ymlink');
    });

    it('should accept symlinks within base directory', async () => {
      // Create a file and a symlink to it
      const targetPath = path.join(tempDir, 'target.txt');
      const linkPath = path.join(tempDir, 'link.txt');

      await fs.writeFile(targetPath, 'content');
      await fs.ensureSymlink(targetPath, linkPath);

      const validatorWithSymlinkCheck = new PathValidator({
        baseDirectory: tempDir,
        checkSymlinks: true,
      });
      const result = validatorWithSymlinkCheck.validate(linkPath);

      expect(result.valid).toBe(true);
    });

    it('should skip symlink check when checkSymlinks is false', async () => {
      const linkPath = path.join(tempDir, 'some-link');
      const targetPath = '/tmp';

      await fs.ensureSymlink(targetPath, linkPath);

      const validatorNoSymlinkCheck = new PathValidator({
        baseDirectory: tempDir,
        checkSymlinks: false,
      });
      const result = validatorNoSymlinkCheck.validate(linkPath);

      // Should be valid because symlink check is disabled
      expect(result.valid).toBe(true);
    });
  });

  describe('validateMany', () => {
    it('should validate multiple paths', () => {
      const paths = [
        path.join(tempDir, 'file1.txt'),
        path.join(tempDir, 'file2.txt'),
      ];
      const result = validator.validateMany(paths);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.results.size).toBe(2);
    });

    it('should collect all errors', () => {
      const paths = [
        path.join(tempDir, 'valid.txt'),
        '/etc/passwd',
        '/etc/shadow',
      ];
      const result = validator.validateMany(paths);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('isSafe', () => {
    it('should return true for safe paths', () => {
      const filePath = path.join(tempDir, 'test.txt');
      expect(validator.isSafe(filePath)).toBe(true);
    });

    it('should return false for unsafe paths', () => {
      expect(validator.isSafe('/etc/passwd')).toBe(false);
    });
  });

  describe('resolveOrThrow', () => {
    it('should return resolved path for valid paths', () => {
      const filePath = path.join(tempDir, 'test.txt');
      const result = validator.resolveOrThrow(filePath);
      expect(result).toBe(filePath);
    });

    it('should throw for invalid paths', () => {
      expect(() => {
        validator.resolveOrThrow('/etc/passwd');
      }).toThrow();
    });

    it('should include path info in error message', () => {
      expect(() => {
        validator.resolveOrThrow('/etc/passwd');
      }).toThrow(/outside/i);
    });
  });

  describe('edge cases', () => {
    it('should handle path equal to base directory', () => {
      const result = validator.validate(tempDir);
      expect(result.valid).toBe(true);
    });

    it('should handle unicode in paths', () => {
      const unicodePath = path.join(tempDir, 'тест', '文件.txt');
      const result = validator.validate(unicodePath);
      expect(result.valid).toBe(true);
    });

    it('should handle very long paths', () => {
      const longName = 'a'.repeat(200);
      const longPath = path.join(tempDir, longName, 'file.txt');
      const result = validator.validate(longPath);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Singleton and utility functions', () => {
  it('getPathValidator should return a PathValidator instance', () => {
    const validator = getPathValidator();
    expect(validator).toBeInstanceOf(PathValidator);
  });

  it('initializePathValidator should create new instance with options', () => {
    const tmpDir = path.resolve(os.tmpdir());
    const validator = initializePathValidator({ baseDirectory: tmpDir });
    expect(validator.getBaseDirectory()).toBe(tmpDir);
  });

  it('validatePath should validate using default validator', () => {
    initializePathValidator({ baseDirectory: process.cwd() });
    const result = validatePath(path.join(process.cwd(), 'test.txt'));
    expect(result.valid).toBe(true);
  });

  it('isPathSafe should return boolean', () => {
    initializePathValidator({ baseDirectory: process.cwd() });
    expect(typeof isPathSafe('/etc/passwd')).toBe('boolean');
  });
});
