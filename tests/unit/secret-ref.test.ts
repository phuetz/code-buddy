/**
 * Tests for SecretRef — resolves ${env:NAME}, ${file:/path}, ${exec:cmd}
 * references in config string values and walks nested objects/arrays.
 *
 * child_process.execSync is mocked so that ${exec:...} tests are hermetic.
 * fs.readFile is left real but pointed at temp files via os.tmpdir().
 * The logger is mocked to suppress warning output and to allow assertion.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
// ---------------------------------------------------------------------------
// Mock child_process before importing the module under test.
// We type execSync as returning `string` (the overload used when encoding is
// specified) so that mockReturnValue('...') does not trigger TS Buffer errors.
// ---------------------------------------------------------------------------

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

// Use a plain jest.Mock typed to return string to avoid the Buffer overload
// incompatibility in the strict TS type signature of execSync.
 
const mockExecSync = require('child_process').execSync as jest.MockedFunction<() => string>;

// ---------------------------------------------------------------------------
// Mock logger to silence warnings during tests
// ---------------------------------------------------------------------------

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { resolveSecretRef, resolveSecretRefs } from '../../src/config/secret-ref.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeTempFile(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secret-ref-test-'));
  const filePath = path.join(dir, 'secret.txt');
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

async function removeTempFile(filePath: string): Promise<void> {
  try {
    await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SecretRef', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore a fresh copy of env for each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // -------------------------------------------------------------------------
  // Strings with no references — pass through unchanged
  // -------------------------------------------------------------------------

  describe('plain strings without references', () => {
    it('returns the original string when no ${...} pattern is present', async () => {
      const result = await resolveSecretRef('hello world');
      expect(result).toBe('hello world');
    });

    it('returns empty string unchanged', async () => {
      expect(await resolveSecretRef('')).toBe('');
    });

    it('returns a string containing ${ but no recognized ref type unchanged', async () => {
      // The pattern only matches env/file/exec. An unknown type is not captured
      // by the regex so the original string is returned without modification.
      const result = await resolveSecretRef('${unknown:FOO}');
      expect(result).toBe('${unknown:FOO}');
    });
  });

  // -------------------------------------------------------------------------
  // ${env:NAME} — environment variable resolution
  // -------------------------------------------------------------------------

  describe('${env:NAME} resolution', () => {
    it('resolves an existing env var', async () => {
      process.env.MY_SECRET = 'super-secret-value';
      const result = await resolveSecretRef('${env:MY_SECRET}');
      expect(result).toBe('super-secret-value');
    });

    it('resolves env var embedded within surrounding text', async () => {
      process.env.GREETING = 'World';
      const result = await resolveSecretRef('Hello, ${env:GREETING}!');
      expect(result).toBe('Hello, World!');
    });

    it('returns empty string when the env var is not set', async () => {
      delete process.env.NONEXISTENT_VAR_XYZ;
      const result = await resolveSecretRef('${env:NONEXISTENT_VAR_XYZ}');
      expect(result).toBe('');
    });

    it('emits a warning when the env var is missing', async () => {
      const { logger } = jest.requireMock('../../src/utils/logger.js');
      delete process.env.MISSING_VAR;
      await resolveSecretRef('${env:MISSING_VAR}');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('MISSING_VAR'),
        expect.any(Object),
      );
    });

    it('resolves multiple env refs in a single string', async () => {
      process.env.FIRST = 'foo';
      process.env.SECOND = 'bar';
      const result = await resolveSecretRef('${env:FIRST}-${env:SECOND}');
      expect(result).toBe('foo-bar');
    });

    it('resolves env var with an empty string value', async () => {
      process.env.EMPTY_VAR = '';
      const result = await resolveSecretRef('prefix-${env:EMPTY_VAR}-suffix');
      expect(result).toBe('prefix--suffix');
    });
  });

  // -------------------------------------------------------------------------
  // ${file:/path/to/file} — file content resolution
  // -------------------------------------------------------------------------

  describe('${file:/path} resolution', () => {
    let tmpFile: string;

    afterEach(async () => {
      if (tmpFile) {
        await removeTempFile(tmpFile);
      }
    });

    it('resolves file content from a real temp file', async () => {
      tmpFile = await writeTempFile('my-api-key-123');
      const result = await resolveSecretRef(`\${file:${tmpFile}}`);
      expect(result).toBe('my-api-key-123');
    });

    it('trims leading/trailing whitespace from file content', async () => {
      tmpFile = await writeTempFile('  trimmed-value  \n');
      const result = await resolveSecretRef(`\${file:${tmpFile}}`);
      expect(result).toBe('trimmed-value');
    });

    it('resolves file ref embedded in a larger string', async () => {
      tmpFile = await writeTempFile('secret123');
      const result = await resolveSecretRef(`Bearer \${file:${tmpFile}}`);
      expect(result).toBe('Bearer secret123');
    });

    it('returns empty string when the file does not exist', async () => {
      const result = await resolveSecretRef('${file:/this/file/does/not/exist.txt}');
      expect(result).toBe('');
    });

    it('emits a warning when the file cannot be read', async () => {
      const { logger } = jest.requireMock('../../src/utils/logger.js');
      await resolveSecretRef('${file:/nonexistent/path/secret.txt}');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('/nonexistent/path/secret.txt'),
        expect.any(Object),
      );
    });

    it('handles multi-line file content and trims it', async () => {
      tmpFile = await writeTempFile('line1\nline2\nline3\n');
      const result = await resolveSecretRef(`\${file:${tmpFile}}`);
      expect(result).toBe('line1\nline2\nline3');
    });
  });

  // -------------------------------------------------------------------------
  // ${exec:command} — command stdout resolution
  // -------------------------------------------------------------------------

  describe('${exec:command} resolution', () => {
    it('resolves stdout from a mocked command', async () => {
      mockExecSync.mockReturnValue('command-output\n');
      const result = await resolveSecretRef('${exec:echo hello}');
      expect(result).toBe('command-output');
    });

    it('trims trailing newline from command output', async () => {
      mockExecSync.mockReturnValue('trimmed\n');
      const result = await resolveSecretRef('${exec:some-command}');
      expect(result).toBe('trimmed');
    });

    it('calls execSync with the correct command string', async () => {
      mockExecSync.mockReturnValue('');
      await resolveSecretRef('${exec:get-secret --name mykey}');
      expect(mockExecSync).toHaveBeenCalledWith(
        'get-secret --name mykey',
        expect.objectContaining({ timeout: 5000, encoding: 'utf-8' }),
      );
    });

    it('returns empty string when the command throws', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('command not found');
      });
      const result = await resolveSecretRef('${exec:nonexistent-command}');
      expect(result).toBe('');
    });

    it('emits a warning when the command fails', async () => {
      const { logger } = jest.requireMock('../../src/utils/logger.js');
      mockExecSync.mockImplementation(() => {
        throw new Error('exit code 1');
      });
      await resolveSecretRef('${exec:failing-cmd}');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failing-cmd'),
        expect.any(Object),
      );
    });

    it('resolves exec ref embedded alongside literal text', async () => {
      mockExecSync.mockReturnValue('secret');
      const result = await resolveSecretRef('token=${exec:get-token}');
      expect(result).toBe('token=secret');
    });
  });

  // -------------------------------------------------------------------------
  // Multiple references in one string
  // -------------------------------------------------------------------------

  describe('multiple references in one string', () => {
    it('resolves env and exec refs in the same string', async () => {
      process.env.API_HOST = 'https://api.example.com';
      mockExecSync.mockReturnValue('token-xyz');
      const result = await resolveSecretRef('${env:API_HOST}/endpoint?token=${exec:get-token}');
      expect(result).toBe('https://api.example.com/endpoint?token=token-xyz');
    });

    it('resolves three env refs in one string', async () => {
      process.env.A = 'alpha';
      process.env.B = 'beta';
      process.env.C = 'gamma';
      const result = await resolveSecretRef('${env:A}:${env:B}:${env:C}');
      expect(result).toBe('alpha:beta:gamma');
    });

    it('handles a mix of env and file refs', async () => {
      process.env.PREFIX = 'Bearer';
      const tmpFile = await writeTempFile('my-token');
      try {
        const result = await resolveSecretRef(`\${env:PREFIX} \${file:${tmpFile}}`);
        expect(result).toBe('Bearer my-token');
      } finally {
        await removeTempFile(tmpFile);
      }
    });
  });

  // -------------------------------------------------------------------------
  // resolveSecretRefs() — nested object/array walking
  // -------------------------------------------------------------------------

  describe('resolveSecretRefs() — deep object resolution', () => {
    it('resolves string values inside an object', async () => {
      process.env.DB_PASS = 'pass123';
      const config = { database: { password: '${env:DB_PASS}' } };
      const result = await resolveSecretRefs(config as Record<string, unknown>);
      expect((result.database as Record<string, unknown>).password).toBe('pass123');
    });

    it('resolves string values inside an array', async () => {
      process.env.ITEM_ONE = 'one';
      process.env.ITEM_TWO = 'two';
      const config = { items: ['${env:ITEM_ONE}', '${env:ITEM_TWO}'] };
      const result = await resolveSecretRefs(config as Record<string, unknown>);
      expect(result.items).toEqual(['one', 'two']);
    });

    it('passes through non-string primitives unchanged', async () => {
      const config = {
        count: 42,
        enabled: true,
        ratio: 3.14,
        nothing: null,
      };
      const result = await resolveSecretRefs(config as Record<string, unknown>);
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
      expect(result.ratio).toBeCloseTo(3.14);
      expect(result.nothing).toBeNull();
    });

    it('does not mutate the original object', async () => {
      process.env.ORIG_TEST = 'resolved';
      const original = { key: '${env:ORIG_TEST}' };
      await resolveSecretRefs(original as Record<string, unknown>);
      // Original should still hold the unresolved reference
      expect(original.key).toBe('${env:ORIG_TEST}');
    });

    it('resolves deeply nested values', async () => {
      process.env.DEEP_SECRET = 'deep-value';
      const config = { a: { b: { c: { d: '${env:DEEP_SECRET}' } } } };
      const result = await resolveSecretRefs(config as Record<string, unknown>);
      const d = (result as Record<string, unknown>);
      // Drill down
      const nested = ((d.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<string, unknown>;
      expect(nested.d).toBe('deep-value');
    });

    it('handles arrays of objects', async () => {
      process.env.HOST_A = 'host-a.example.com';
      process.env.HOST_B = 'host-b.example.com';
      const config = {
        hosts: [
          { host: '${env:HOST_A}', port: 5432 },
          { host: '${env:HOST_B}', port: 5433 },
        ],
      };
      const result = await resolveSecretRefs(config as Record<string, unknown>);
      const hosts = result.hosts as Array<Record<string, unknown>>;
      expect(hosts[0].host).toBe('host-a.example.com');
      expect(hosts[1].host).toBe('host-b.example.com');
      // Non-string values inside array objects are unchanged
      expect(hosts[0].port).toBe(5432);
    });

    it('handles an object with no secret refs (returns equivalent)', async () => {
      const config = { name: 'buddy', version: '1.0' };
      const result = await resolveSecretRefs(config as Record<string, unknown>);
      expect(result).toEqual(config);
    });

    it('handles mixed array types (strings and non-strings)', async () => {
      process.env.MIXED_STR = 'hello';
      const config = { mixed: ['${env:MIXED_STR}', 42, true, null] };
      const result = await resolveSecretRefs(config as Record<string, unknown>);
      const mixed = result.mixed as unknown[];
      expect(mixed[0]).toBe('hello');
      expect(mixed[1]).toBe(42);
      expect(mixed[2]).toBe(true);
      expect(mixed[3]).toBeNull();
    });

    it('resolves exec refs inside nested config', async () => {
      mockExecSync.mockReturnValue('exec-secret');
      const config = { auth: { token: '${exec:get-auth-token}' } };
      const result = await resolveSecretRefs(config as Record<string, unknown>);
      expect((result.auth as Record<string, unknown>).token).toBe('exec-secret');
    });
  });

  // -------------------------------------------------------------------------
  // resolveSecretRef() — edge cases
  // -------------------------------------------------------------------------

  describe('edge cases for resolveSecretRef()', () => {
    it('handles a string that is only whitespace', async () => {
      const result = await resolveSecretRef('   ');
      expect(result).toBe('   ');
    });

    it('handles adjacent refs without separators', async () => {
      process.env.PART1 = 'foo';
      process.env.PART2 = 'bar';
      const result = await resolveSecretRef('${env:PART1}${env:PART2}');
      expect(result).toBe('foobar');
    });

    it('handles a ref where env value itself contains special characters', async () => {
      process.env.SPECIAL = 'user:pass@host:5432/db?ssl=true';
      const result = await resolveSecretRef('${env:SPECIAL}');
      expect(result).toBe('user:pass@host:5432/db?ssl=true');
    });
  });
});
