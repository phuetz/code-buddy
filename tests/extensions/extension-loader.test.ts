import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExtensionLoader, ExtensionManifest } from '../../src/extensions/extension-loader.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ext-test-'));
}

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(dir, 'extension.json'), JSON.stringify(manifest));
}

function validManifest(overrides: Partial<ExtensionManifest> = {}): Record<string, unknown> {
  return {
    name: 'test-ext',
    version: '1.0.0',
    description: 'A test extension',
    type: 'tool',
    entryPoint: 'index.js',
    ...overrides,
  };
}

describe('ExtensionLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseManifest', () => {
    it('should parse a valid manifest', () => {
      writeManifest(tempDir, validManifest());
      const result = ExtensionLoader.parseManifest(tempDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('test-ext');
      expect(result!.version).toBe('1.0.0');
      expect(result!.type).toBe('tool');
    });

    it('should return null for missing extension.json', () => {
      const result = ExtensionLoader.parseManifest(tempDir);
      expect(result).toBeNull();
    });

    it('should return null for missing required fields', () => {
      writeManifest(tempDir, { name: 'incomplete' });
      const result = ExtensionLoader.parseManifest(tempDir);
      expect(result).toBeNull();
    });

    it('should return null for invalid type', () => {
      writeManifest(tempDir, validManifest({ type: 'bogus' as ExtensionManifest['type'] }));
      const result = ExtensionLoader.parseManifest(tempDir);
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      writeFileSync(join(tempDir, 'extension.json'), 'not json');
      const result = ExtensionLoader.parseManifest(tempDir);
      expect(result).toBeNull();
    });
  });

  describe('discover', () => {
    it('should find extensions in search paths', () => {
      const extDir = join(tempDir, 'my-ext');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({ name: 'my-ext' }));

      const loader = new ExtensionLoader([tempDir]);
      const manifests = loader.discover();
      expect(manifests).toHaveLength(1);
      expect(manifests[0].name).toBe('my-ext');
    });

    it('should return empty array for non-existent search paths', () => {
      const loader = new ExtensionLoader(['/nonexistent/path']);
      const manifests = loader.discover();
      expect(manifests).toHaveLength(0);
    });

    it('should skip directories without valid manifests', () => {
      const extDir = join(tempDir, 'bad-ext');
      mkdirSync(extDir);
      // no extension.json

      const loader = new ExtensionLoader([tempDir]);
      const manifests = loader.discover();
      expect(manifests).toHaveLength(0);
    });
  });

  describe('load', () => {
    it('should create instance with status loaded', () => {
      const extDir = join(tempDir, 'my-ext');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({ name: 'my-ext' }));

      const loader = new ExtensionLoader([tempDir]);
      const result = loader.load('my-ext');
      expect('status' in result).toBe(true);
      if ('status' in result) {
        expect(result.status).toBe('loaded');
        expect(result.manifest.name).toBe('my-ext');
        expect(result.loadedAt).toBeDefined();
      }
    });

    it('should return error for unknown extension', () => {
      const loader = new ExtensionLoader([tempDir]);
      const result = loader.load('nonexistent');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('not found');
      }
    });
  });

  describe('list', () => {
    it('should return all extensions', () => {
      const ext1 = join(tempDir, 'ext1');
      const ext2 = join(tempDir, 'ext2');
      mkdirSync(ext1);
      mkdirSync(ext2);
      writeManifest(ext1, validManifest({ name: 'ext1', type: 'tool' }));
      writeManifest(ext2, validManifest({ name: 'ext2', type: 'channel' }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('ext1');
      loader.load('ext2');

      expect(loader.list()).toHaveLength(2);
    });

    it('should filter by type', () => {
      const ext1 = join(tempDir, 'ext1');
      const ext2 = join(tempDir, 'ext2');
      mkdirSync(ext1);
      mkdirSync(ext2);
      writeManifest(ext1, validManifest({ name: 'ext1', type: 'tool' }));
      writeManifest(ext2, validManifest({ name: 'ext2', type: 'channel' }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('ext1');
      loader.load('ext2');

      expect(loader.list('tool')).toHaveLength(1);
      expect(loader.list('tool')[0].manifest.name).toBe('ext1');
      expect(loader.list('channel')).toHaveLength(1);
      expect(loader.list('provider')).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('should return extension by name', () => {
      const extDir = join(tempDir, 'my-ext');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({ name: 'my-ext' }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('my-ext');

      const ext = loader.get('my-ext');
      expect(ext).toBeDefined();
      expect(ext!.manifest.name).toBe('my-ext');
    });

    it('should return undefined for unknown extension', () => {
      const loader = new ExtensionLoader([tempDir]);
      expect(loader.get('nonexistent')).toBeUndefined();
    });
  });

  describe('validateConfig', () => {
    it('should validate required fields', () => {
      const extDir = join(tempDir, 'cfg-ext');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({
        name: 'cfg-ext',
        configSchema: {
          apiKey: { type: 'string', required: true, description: 'API key' },
          port: { type: 'number', required: false, default: 3000 },
        },
      }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('cfg-ext');

      const missing = loader.validateConfig('cfg-ext', { port: 8080 });
      expect(missing.valid).toBe(false);
      expect(missing.errors).toContain('Missing required config field: apiKey');

      const ok = loader.validateConfig('cfg-ext', { apiKey: 'abc', port: 8080 });
      expect(ok.valid).toBe(true);
      expect(ok.errors).toHaveLength(0);
    });

    it('should report type mismatches', () => {
      const extDir = join(tempDir, 'cfg-ext');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({
        name: 'cfg-ext',
        configSchema: {
          port: { type: 'number', required: true },
        },
      }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('cfg-ext');

      const result = loader.validateConfig('cfg-ext', { port: 'not-a-number' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('expected type "number"');
    });

    it('should return invalid for unknown extension', () => {
      const loader = new ExtensionLoader([tempDir]);
      const result = loader.validateConfig('nonexistent', {});
      expect(result.valid).toBe(false);
    });

    it('should accept any config when no schema defined', () => {
      const extDir = join(tempDir, 'no-schema');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({ name: 'no-schema' }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('no-schema');

      const result = loader.validateConfig('no-schema', { anything: 'goes' });
      expect(result.valid).toBe(true);
    });
  });

  describe('checkDependencies', () => {
    it('should return satisfied when all deps are loaded', () => {
      const dep = join(tempDir, 'dep-ext');
      const main = join(tempDir, 'main-ext');
      mkdirSync(dep);
      mkdirSync(main);
      writeManifest(dep, validManifest({ name: 'dep-ext' }));
      writeManifest(main, validManifest({ name: 'main-ext', dependencies: ['dep-ext'] }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('dep-ext');
      loader.load('main-ext');

      const result = loader.checkDependencies('main-ext');
      expect(result.satisfied).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should report missing deps', () => {
      const main = join(tempDir, 'main-ext');
      mkdirSync(main);
      writeManifest(main, validManifest({ name: 'main-ext', dependencies: ['missing-dep'] }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('main-ext');

      const result = loader.checkDependencies('main-ext');
      expect(result.satisfied).toBe(false);
      expect(result.missing).toContain('missing-dep');
    });

    it('should return satisfied when no dependencies', () => {
      const extDir = join(tempDir, 'no-deps');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({ name: 'no-deps' }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('no-deps');

      const result = loader.checkDependencies('no-deps');
      expect(result.satisfied).toBe(true);
    });
  });

  describe('activate and deactivate', () => {
    it('should activate a loaded extension', async () => {
      const extDir = join(tempDir, 'act-ext');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({ name: 'act-ext' }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('act-ext');

      const result = await loader.activate('act-ext');
      expect(result).toBe(true);
      expect(loader.get('act-ext')!.status).toBe('active');
    });

    it('should return false for unknown extension', async () => {
      const loader = new ExtensionLoader([tempDir]);
      expect(await loader.activate('nope')).toBe(false);
    });

    it('should deactivate an active extension', async () => {
      const extDir = join(tempDir, 'act-ext');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({ name: 'act-ext' }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('act-ext');
      await loader.activate('act-ext');
      const result = await loader.deactivate('act-ext');
      expect(result).toBe(true);
      expect(loader.get('act-ext')!.status).toBe('disabled');
    });
  });

  describe('dispose', () => {
    it('should clear all extensions', async () => {
      const extDir = join(tempDir, 'disp-ext');
      mkdirSync(extDir);
      writeManifest(extDir, validManifest({ name: 'disp-ext' }));

      const loader = new ExtensionLoader([tempDir]);
      loader.load('disp-ext');
      expect(loader.list()).toHaveLength(1);

      await loader.dispose();
      expect(loader.list()).toHaveLength(0);
    });
  });
});
