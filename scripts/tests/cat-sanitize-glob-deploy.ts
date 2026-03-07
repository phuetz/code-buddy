/**
 * Cat 81: Sanitize Utilities (8 tests, no API)
 * Cat 82: Glob Matcher (7 tests, no API)
 * Cat 83: Base URL (5 tests, no API)
 * Cat 84: Cloud Deploy Configs (6 tests, no API)
 * Cat 85: Nix Config (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 81: Sanitize Utilities
// ============================================================================

export function cat81Sanitize(): TestDef[] {
  return [
    {
      name: '81.1-sanitize-file-path',
      timeout: 5000,
      fn: async () => {
        const { sanitizeFilePath } = await import('../../src/utils/sanitize.js');
        const safe = sanitizeFilePath('src/index.ts');
        return {
          pass: safe === 'src/index.ts',
          metadata: { safe },
        };
      },
    },
    {
      name: '81.2-sanitize-path-traversal-blocked',
      timeout: 5000,
      fn: async () => {
        const { sanitizeFilePath } = await import('../../src/utils/sanitize.js');
        try {
          sanitizeFilePath('../../etc/passwd');
          return { pass: false, metadata: { reason: 'should throw' } };
        } catch (e: any) {
          return {
            pass: true,
            metadata: { error: e.message },
          };
        }
      },
    },
    {
      name: '81.3-escape-regex',
      timeout: 5000,
      fn: async () => {
        const { escapeRegex } = await import('../../src/utils/sanitize.js');
        const escaped = escapeRegex('hello.world[0]');
        const re = new RegExp(escaped);
        return {
          pass: re.test('hello.world[0]') && !re.test('helloXworld00]'),
        };
      },
    },
    {
      name: '81.4-sanitize-html',
      timeout: 5000,
      fn: async () => {
        const { sanitizeHTML } = await import('../../src/utils/sanitize.js');
        const result = sanitizeHTML('<script>alert("xss")</script><p>safe</p>');
        return {
          pass: !result.includes('<script>') && result.includes('safe'),
          metadata: { result: result.substring(0, 200) },
        };
      },
    },
    {
      name: '81.5-truncate-string',
      timeout: 5000,
      fn: async () => {
        const { truncateString } = await import('../../src/utils/sanitize.js');
        const short = truncateString('hello', 10);
        const long = truncateString('hello world this is long', 10);
        return {
          pass: short === 'hello' && long.length <= 13, // 10 + ellipsis
          metadata: { short, long },
        };
      },
    },
    {
      name: '81.6-remove-control-characters',
      timeout: 5000,
      fn: async () => {
        const { removeControlCharacters } = await import('../../src/utils/sanitize.js');
        const cleaned = removeControlCharacters('hello\x00world\x01test');
        return {
          pass: !cleaned.includes('\x00') && !cleaned.includes('\x01') && cleaned.includes('hello'),
          metadata: { cleaned },
        };
      },
    },
    {
      name: '81.7-sanitize-json-valid',
      timeout: 5000,
      fn: async () => {
        const { sanitizeJSON } = await import('../../src/utils/sanitize.js');
        const result = sanitizeJSON<{ name: string }>('{"name":"test"}');
        return {
          pass: result.name === 'test',
        };
      },
    },
    {
      name: '81.8-sanitize-port',
      timeout: 5000,
      fn: async () => {
        const { sanitizePort } = await import('../../src/utils/sanitize.js');
        const port = sanitizePort(3000);
        let threw = false;
        try { sanitizePort(99999); } catch { threw = true; }
        return {
          pass: port === 3000 && threw,
          metadata: { port },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 82: Glob Matcher
// ============================================================================

export function cat82GlobMatcher(): TestDef[] {
  return [
    {
      name: '82.1-glob-to-regex',
      timeout: 5000,
      fn: async () => {
        const { globToRegex } = await import('../../src/utils/glob-matcher.js');
        const re = globToRegex('*.ts');
        return {
          pass: re.test('index.ts') && !re.test('index.js'),
          metadata: { pattern: re.source },
        };
      },
    },
    {
      name: '82.2-match-glob-basic',
      timeout: 5000,
      fn: async () => {
        const { matchGlob } = await import('../../src/utils/glob-matcher.js');
        return {
          pass: matchGlob('hello.ts', '*.ts') === true &&
                matchGlob('hello.js', '*.ts') === false,
        };
      },
    },
    {
      name: '82.3-match-any-glob',
      timeout: 5000,
      fn: async () => {
        const { matchAnyGlob } = await import('../../src/utils/glob-matcher.js');
        return {
          pass: matchAnyGlob('style.css', ['*.ts', '*.css']) === true &&
                matchAnyGlob('style.css', ['*.ts', '*.js']) === false,
        };
      },
    },
    {
      name: '82.4-filter-by-glob',
      timeout: 5000,
      fn: async () => {
        const { filterByGlob } = await import('../../src/utils/glob-matcher.js');
        const items = ['a.ts', 'b.js', 'c.ts', 'd.css'];
        const result = filterByGlob(items, ['*.ts']);
        return {
          pass: result.length === 2 && result.includes('a.ts') && result.includes('c.ts'),
          metadata: { result },
        };
      },
    },
    {
      name: '82.5-exclude-by-glob',
      timeout: 5000,
      fn: async () => {
        const { excludeByGlob } = await import('../../src/utils/glob-matcher.js');
        const items = ['a.ts', 'b.js', 'c.ts', 'd.css'];
        const result = excludeByGlob(items, ['*.ts']);
        return {
          pass: result.length === 2 && result.includes('b.js') && result.includes('d.css'),
          metadata: { result },
        };
      },
    },
    {
      name: '82.6-filter-tools',
      timeout: 5000,
      fn: async () => {
        const { filterTools } = await import('../../src/utils/glob-matcher.js');
        const tools = ['bash', 'read_file', 'write_file', 'search', 'git_diff'];
        const result = filterTools(tools, { enabledTools: ['bash', 'read_*'] });
        return {
          pass: result.includes('bash') && result.includes('read_file'),
          metadata: { result },
        };
      },
    },
    {
      name: '82.7-is-tool-enabled',
      timeout: 5000,
      fn: async () => {
        const { isToolEnabled } = await import('../../src/utils/glob-matcher.js');
        return {
          pass: isToolEnabled('bash', { disabledTools: ['bash'] }) === false &&
                isToolEnabled('read_file', { disabledTools: ['bash'] }) === true,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 83: Base URL
// ============================================================================

export function cat83BaseURL(): TestDef[] {
  return [
    {
      name: '83.1-default-constant',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_BASE_URL } = await import('../../src/utils/base-url.js');
        return {
          pass: typeof DEFAULT_BASE_URL === 'string' && DEFAULT_BASE_URL.includes('x.ai'),
          metadata: { url: DEFAULT_BASE_URL },
        };
      },
    },
    {
      name: '83.2-normalize-strips-trailing-slash',
      timeout: 5000,
      fn: async () => {
        const { normalizeBaseURL } = await import('../../src/utils/base-url.js');
        const result = normalizeBaseURL('https://api.example.com/v1/');
        return {
          pass: !result.endsWith('/'),
          metadata: { result },
        };
      },
    },
    {
      name: '83.3-normalize-valid-url',
      timeout: 5000,
      fn: async () => {
        const { normalizeBaseURL } = await import('../../src/utils/base-url.js');
        const result = normalizeBaseURL('https://api.example.com/v1');
        return {
          pass: result === 'https://api.example.com/v1',
          metadata: { result },
        };
      },
    },
    {
      name: '83.4-normalize-invalid-throws',
      timeout: 5000,
      fn: async () => {
        const { normalizeBaseURL } = await import('../../src/utils/base-url.js');
        try {
          normalizeBaseURL('not-a-url');
          return { pass: false };
        } catch (e: any) {
          return {
            pass: true,
            metadata: { error: e.message },
          };
        }
      },
    },
    {
      name: '83.5-normalize-localhost',
      timeout: 5000,
      fn: async () => {
        const { normalizeBaseURL } = await import('../../src/utils/base-url.js');
        const result = normalizeBaseURL('http://localhost:1234/v1');
        return {
          pass: result.includes('localhost') && result.includes('1234'),
          metadata: { result },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 84: Cloud Deploy Configs
// ============================================================================

export function cat84CloudDeployConfigs(): TestDef[] {
  return [
    {
      name: '84.1-generate-fly-config',
      timeout: 5000,
      fn: async () => {
        const { generateFlyConfig } = await import('../../src/deploy/cloud-configs.js');
        const result = generateFlyConfig({ platform: 'fly', appName: 'test-app', port: 3000 });
        return {
          pass: result.success && result.files.length > 0 && result.instructions.length > 0,
          metadata: { fileCount: result.files.length },
        };
      },
    },
    {
      name: '84.2-generate-railway-config',
      timeout: 5000,
      fn: async () => {
        const { generateRailwayConfig } = await import('../../src/deploy/cloud-configs.js');
        const result = generateRailwayConfig({ platform: 'railway', appName: 'rail-app' });
        return {
          pass: result.success && result.files.length > 0,
          metadata: { files: result.files.map(f => f.path) },
        };
      },
    },
    {
      name: '84.3-generate-render-config',
      timeout: 5000,
      fn: async () => {
        const { generateRenderConfig } = await import('../../src/deploy/cloud-configs.js');
        const result = generateRenderConfig({ platform: 'render', appName: 'render-app' });
        return {
          pass: result.success && result.files.length > 0,
          metadata: { files: result.files.map(f => f.path) },
        };
      },
    },
    {
      name: '84.4-router-function',
      timeout: 5000,
      fn: async () => {
        const { generateDeployConfig } = await import('../../src/deploy/cloud-configs.js');
        const fly = generateDeployConfig({ platform: 'fly', appName: 'r1' });
        const gcp = generateDeployConfig({ platform: 'gcp', appName: 'r2' });
        return {
          pass: fly.success && gcp.success,
          metadata: { flyFiles: fly.files.length, gcpFiles: gcp.files.length },
        };
      },
    },
    {
      name: '84.5-config-has-env-vars',
      timeout: 5000,
      fn: async () => {
        const { generateFlyConfig } = await import('../../src/deploy/cloud-configs.js');
        const result = generateFlyConfig({
          platform: 'fly', appName: 'env-app',
          env: { NODE_ENV: 'production', PORT: '3000' },
        });
        const hasEnv = result.files.some(f => f.content.includes('NODE_ENV') || f.content.includes('production'));
        return {
          pass: result.success && hasEnv,
        };
      },
    },
    {
      name: '84.6-all-platforms-generate',
      timeout: 5000,
      fn: async () => {
        const { generateDeployConfig } = await import('../../src/deploy/cloud-configs.js');
        const platforms = ['fly', 'railway', 'render', 'hetzner', 'northflank', 'gcp'] as const;
        const results = platforms.map(p => ({
          platform: p,
          result: generateDeployConfig({ platform: p, appName: `test-${p}` }),
        }));
        const allSuccess = results.every(r => r.result.success);
        return {
          pass: allSuccess,
          metadata: { platforms: results.map(r => ({ p: r.platform, ok: r.result.success, files: r.result.files.length })) },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 85: Nix Config
// ============================================================================

export function cat85NixConfig(): TestDef[] {
  return [
    {
      name: '85.1-generate-flake-nix',
      timeout: 5000,
      fn: async () => {
        const { generateFlakeNix } = await import('../../src/deploy/nix-config.js');
        const flake = generateFlakeNix({ packageName: 'codebuddy', version: '1.0.0', description: 'Test' });
        return {
          pass: typeof flake === 'string' && flake.includes('codebuddy') && flake.includes('flake'),
          metadata: { len: flake.length },
        };
      },
    },
    {
      name: '85.2-generate-default-nix',
      timeout: 5000,
      fn: async () => {
        const { generateDefaultNix } = await import('../../src/deploy/nix-config.js');
        const result = generateDefaultNix({ packageName: 'codebuddy', version: '2.0.0', description: 'Test pkg' });
        return {
          pass: typeof result === 'string' && result.includes('codebuddy'),
          metadata: { len: result.length },
        };
      },
    },
    {
      name: '85.3-node-version-in-flake',
      timeout: 5000,
      fn: async () => {
        const { generateFlakeNix } = await import('../../src/deploy/nix-config.js');
        const flake = generateFlakeNix({ packageName: 'app', version: '1.0.0', description: 'x', nodeVersion: '20' });
        return {
          pass: flake.includes('20') || flake.includes('node'),
          metadata: { preview: flake.substring(0, 200) },
        };
      },
    },
    {
      name: '85.4-version-in-output',
      timeout: 5000,
      fn: async () => {
        const { generateFlakeNix } = await import('../../src/deploy/nix-config.js');
        const flake = generateFlakeNix({ packageName: 'myapp', version: '3.2.1', description: 'versioned' });
        return {
          pass: flake.includes('3.2.1'),
          metadata: { preview: flake.substring(0, 200) },
        };
      },
    },
    {
      name: '85.5-description-in-output',
      timeout: 5000,
      fn: async () => {
        const { generateDefaultNix } = await import('../../src/deploy/nix-config.js');
        const result = generateDefaultNix({ packageName: 'desc-test', version: '1.0.0', description: 'A great package' });
        return {
          pass: result.includes('A great package') || result.includes('desc-test'),
          metadata: { preview: result.substring(0, 200) },
        };
      },
    },
  ];
}
