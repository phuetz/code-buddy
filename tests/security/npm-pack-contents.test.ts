import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  auditPackContents,
  DEFAULT_ALLOWED_PREFIXES,
  FORBIDDEN_PATTERNS,
  FORBIDDEN_PERSONAL_PATTERNS,
} from '../../src/security/pack-contents-policy.js';

const PROJECT_ROOT = join(__dirname, '..', '..');

describe('Pack Contents Policy - Unit Tests', () => {
  it('expose des constantes et règles par défaut cohérentes', () => {
    expect(DEFAULT_ALLOWED_PREFIXES).toContain('dist');
    expect(DEFAULT_ALLOWED_PREFIXES).toContain('package.json');
    expect(FORBIDDEN_PATTERNS.map.test('test.js.map')).toBe(true);
    expect(FORBIDDEN_PATTERNS.env.test('.env.local')).toBe(true);
    expect(FORBIDDEN_PERSONAL_PATTERNS.length).toBeGreaterThan(0);
  });

  it('accepte une liste nominale de fichiers autorisés', () => {
    const nominalFiles = [
      'package.json',
      'README.md',
      'LICENSE',
      'codebuddy-runtime.json',
      'examples/claude_desktop_config.json',
      'examples/README.md',
      'dist/index.js',
      'dist/index.d.ts',
      'dist/plugin-sdk/index.js',
      'dist/plugin-sdk/index.d.ts',
      'dist/shared/engine-types.js',
      'dist/shared/engine-types.d.ts',
    ];

    const result = auditPackContents(nominalFiles);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('détecte et interdit les fichiers de source map (*.map)', () => {
    const files = ['package.json', 'dist/index.js', 'dist/index.js.map', 'dist/bundle.map'];
    const result = auditPackContents(files);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        { file: 'dist/index.js.map', rule: 'forbidden-extension: *.map' },
        { file: 'dist/bundle.map', rule: 'forbidden-extension: *.map' },
      ])
    );
  });

  it('détecte et interdit les fichiers d’environnement (.env*)', () => {
    const files = ['package.json', '.env', '.env.local', 'dist/.env.production'];
    const result = auditPackContents(files);
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.file === '.env' && v.rule === 'forbidden-pattern: .env*')
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === '.env.local' && v.rule === 'forbidden-pattern: .env*'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'dist/.env.production' && v.rule === 'forbidden-pattern: .env*'
      )
    ).toBe(true);
  });

  it('détecte et interdit les répertoires sources et sensibles (src/, tests/, scripts/, etc.)', () => {
    const files = [
      'src/index.ts',
      'tests/security/secret.test.ts',
      'cowork/App.tsx',
      '.github/workflows/ci.yml',
      '_qa/report.html',
      'scripts/build.sh',
      '.codebuddy/history.json',
    ];
    const result = auditPackContents(files);
    expect(result.ok).toBe(false);

    expect(
      result.violations.some(
        (v) => v.file === 'src/index.ts' && v.rule === 'forbidden-directory: src/'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) =>
          v.file === 'tests/security/secret.test.ts' && v.rule === 'forbidden-directory: tests/'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'cowork/App.tsx' && v.rule === 'forbidden-directory: cowork/'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === '.github/workflows/ci.yml' && v.rule === 'forbidden-directory: .github/'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === '_qa/report.html' && v.rule === 'forbidden-directory: _qa/'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'scripts/build.sh' && v.rule === 'forbidden-directory: scripts/'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === '.codebuddy/history.json' && v.rule === 'forbidden-directory: .codebuddy/'
      )
    ).toBe(true);
  });

  it('détecte et interdit les clés privées, certificats, bases et journaux (*.pem, *.key, *.p12, id_rsa*, *.sqlite, *.jsonl)', () => {
    const files = [
      'dist/server.pem',
      'dist/private.key',
      'dist/cert.p12',
      'id_rsa',
      'id_rsa.pub',
      'dist/data.sqlite',
      'dist/events.jsonl',
    ];
    const result = auditPackContents(files);
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) => v.file === 'dist/server.pem' && v.rule === 'forbidden-extension: *.pem'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'dist/private.key' && v.rule === 'forbidden-extension: *.key'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'dist/cert.p12' && v.rule === 'forbidden-extension: *.p12'
      )
    ).toBe(true);
    expect(
      result.violations.some((v) => v.file === 'id_rsa' && v.rule === 'forbidden-pattern: id_rsa*')
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'id_rsa.pub' && v.rule === 'forbidden-pattern: id_rsa*'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'dist/data.sqlite' && v.rule === 'forbidden-extension: *.sqlite'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'dist/events.jsonl' && v.rule === 'forbidden-extension: *.jsonl'
      )
    ).toBe(true);
  });

  it('détecte et interdit les motifs de données personnelles dans les chemins', () => {
    const samplePersonalName = ['dist/', ['france', 'travail'].join('-'), '.js'].join('');
    const sampleMachineName = ['dist/', ['dark', 'star'].join(''), '.js'].join('');
    const sampleIp = ['dist/', ['100', '73', '1'].join('.'), '.js'].join('');

    const files = [samplePersonalName, sampleMachineName, sampleIp];
    const result = auditPackContents(files);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.violations.some((v) => v.rule.startsWith('forbidden-personal-pattern:'))).toBe(
      true
    );
  });

  it('rejette tout fichier hors préfixes autorisés', () => {
    const files = ['package.json', 'secret-directory/payload.js', 'random_config.json'];
    const result = auditPackContents(files);
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) => v.file === 'secret-directory/payload.js' && v.rule === 'unauthorized-prefix'
      )
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.file === 'random_config.json' && v.rule === 'unauthorized-prefix'
      )
    ).toBe(true);
  });
});

describe('Pack Contents Policy - Intégration réelle npm pack & .npmignore', () => {
  it('la vraie liste npm pack du dépôt actuel respecte la politique sans aucune violation', () => {
    const packJsonOutput = execFileSync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts'],
      { cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );

    const packData = JSON.parse(packJsonOutput);
    expect(Array.isArray(packData)).toBe(true);
    expect(packData.length).toBeGreaterThan(0);

    const packedFiles: string[] = packData[0].files.map((f: { path: string }) => f.path);
    expect(packedFiles.length).toBeGreaterThan(0);

    const audit = auditPackContents(packedFiles);
    expect(audit.violations).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it('prouve que .npmignore exclut bien les .map et que leur présence fait échouer l’audit', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cb-npmignore-test-'));
    try {
      const realNpmIgnore = readFileSync(join(PROJECT_ROOT, '.npmignore'), 'utf8');

      // 1. Cas conforme : .npmignore avec **/*.js.map
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-pack-npmignore',
          version: '1.0.0',
        })
      );
      writeFileSync(join(tmpDir, '.npmignore'), realNpmIgnore);

      mkdirSync(join(tmpDir, 'dist'), { recursive: true });
      writeFileSync(join(tmpDir, 'dist', 'index.js'), 'export const hello = "world";');
      writeFileSync(join(tmpDir, 'dist', 'index.js.map'), '{"version":3,"sources":["index.ts"]}');

      const outWithIgnore = execFileSync(
        'npm',
        ['pack', '--dry-run', '--json', '--ignore-scripts'],
        { cwd: tmpDir, encoding: 'utf8' }
      );
      const packedWithIgnore: string[] = JSON.parse(outWithIgnore)[0].files.map(
        (f: { path: string }) => f.path
      );

      expect(packedWithIgnore).toContain('dist/index.js');
      expect(packedWithIgnore).not.toContain('dist/index.js.map');

      const auditWithIgnore = auditPackContents(packedWithIgnore);
      expect(auditWithIgnore.ok).toBe(true);
      expect(auditWithIgnore.violations).toEqual([]);

      // 2. Cas non-conforme : suppression de **/*.js.map dans .npmignore
      const modifiedNpmIgnore = realNpmIgnore.replace('**/*.js.map', '# removed map ignore');
      writeFileSync(join(tmpDir, '.npmignore'), modifiedNpmIgnore);

      const outWithoutIgnore = execFileSync(
        'npm',
        ['pack', '--dry-run', '--json', '--ignore-scripts'],
        { cwd: tmpDir, encoding: 'utf8' }
      );
      const packedWithoutIgnore: string[] = JSON.parse(outWithoutIgnore)[0].files.map(
        (f: { path: string }) => f.path
      );

      expect(packedWithoutIgnore).toContain('dist/index.js.map');

      const auditWithoutIgnore = auditPackContents(packedWithoutIgnore);
      expect(auditWithoutIgnore.ok).toBe(false);
      expect(auditWithoutIgnore.violations).toEqual(
        expect.arrayContaining([{ file: 'dist/index.js.map', rule: 'forbidden-extension: *.map' }])
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
