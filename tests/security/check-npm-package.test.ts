/**
 * Garde du paquet npm — `scripts/check-npm-package.mjs`.
 *
 * Vérifie que la garde refuse un faux paquet contenant une carte des sources,
 * un fichier d'environnement, un secret ou un chemin personnel, qu'elle accepte
 * le vrai paquet du dépôt, et que chaque règle est bien porteuse (désactiver une
 * règle fait disparaître la violation correspondante).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { removeTestDir } from '../helpers/tmp.js';
import {
  auditPackageFiles,
  collectPackagedFiles,
  loadSecretPatterns,
  normalizePackPath,
  FILENAME_RULES,
  PERSONAL_PATH_PATTERNS,
} from '../../scripts/check-npm-package.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Faux paquet sur disque, hors du dépôt (jamais dans git). */
function makeFakePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cb-npmguard-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake', version: '0.0.0' }));
  writeFileSync(join(dir, 'dist', 'index.js'), 'export const hello = 1;\n');
  return dir;
}

const created: string[] = [];
function tracked(dir: string): string {
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) removeTestDir(dir);
});

describe('check-npm-package — chargement des motifs', () => {
  it('charge ≥ 20 motifs de secrets depuis src/security/secret-patterns.ts', () => {
    const patterns = loadSecretPatterns(PROJECT_ROOT);
    expect(patterns.length).toBeGreaterThanOrEqual(20);
    // Les motifs portent un type exploitable pour le message d'échec.
    expect(patterns.every((p) => typeof p.type === 'string' && p.type.length > 0)).toBe(true);
  });

  it('normalise les chemins (antislash → slash, préfixe ./ retiré)', () => {
    expect(normalizePackPath('.\\dist\\index.js')).toBe('dist/index.js');
    expect(normalizePackPath('dist\\index.js')).toBe('dist/index.js');
    expect(normalizePackPath('./dist/index.js')).toBe('dist/index.js');
  });
});

describe('check-npm-package — faux paquet refusé', () => {
  it('refuse un *.map, un .env, un auth.json, un *.private.json et un _qa/', () => {
    const result = auditPackageFiles(
      ['package.json', 'dist/index.js', 'dist/index.js.map', '.env', '.env.local', 'auth.json', 'cfg/x.private.json', '_qa/report.html'],
      { cwd: PROJECT_ROOT, scanContents: false, patternsRoot: PROJECT_ROOT },
    );

    expect(result.ok).toBe(false);
    const rules = result.violations.map((v) => `${v.file}::${v.rule}`);
    expect(rules).toContain('dist/index.js.map::forbidden-extension: *.map');
    expect(rules).toContain('.env::forbidden-pattern: .env*');
    expect(rules).toContain('.env.local::forbidden-pattern: .env*');
    expect(rules).toContain('auth.json::forbidden-file: auth.json');
    expect(rules).toContain('cfg/x.private.json::forbidden-file: *.private.json');
    expect(rules).toContain('_qa/report.html::forbidden-directory: _qa/');
  });

  it('refuse un chemin personnel dans le NOM du fichier', () => {
    const result = auditPackageFiles(
      ['docs/home/testuser/notes.md', 'docs/data/testuser/notes.md', 'docs/Users/testuser/notes.md'],
      { cwd: PROJECT_ROOT, scanContents: false, patternsRoot: PROJECT_ROOT },
    );
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.violations.every((v) => v.rule === 'forbidden-personal-path')).toBe(true);
  });

  it('refuse un chemin personnel dans le CONTENU d’un fichier empaqueté', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(join(dir, 'dist', 'leak.js'), 'const p = "/home/testuser/.ssh/id_rsa";\n');

    const result = auditPackageFiles(['dist/leak.js'], {
      cwd: dir,
      patternsRoot: PROJECT_ROOT,
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      file: 'dist/leak.js',
      rule: 'forbidden-personal-path: /home/<nom>',
    });
  });

  it('refuse un secret dans le CONTENU sans jamais afficher sa valeur', () => {
    const dir = tracked(makeFakePackage());
    // Clé d'exemple AWS publique (documentation), jamais une vraie clé.
    writeFileSync(join(dir, 'dist', 'cfg.js'), 'const key = "AKIAIOSFODNN7EXAMPLE";\n');

    const result = auditPackageFiles(['dist/cfg.js'], { cwd: dir, patternsRoot: PROJECT_ROOT });

    expect(result.ok).toBe(false);
    const secretViolation = result.violations.find((v) => v.rule.startsWith('forbidden-secret:'));
    expect(secretViolation).toBeDefined();
    expect(secretViolation!.rule).toBe('forbidden-secret: aws_key');
    // La valeur du secret n'apparaît nulle part dans la sortie.
    expect(JSON.stringify(result)).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('ne flague pas un chemin technique /home/.codebuddy (segment commençant par un point)', () => {
    const result = auditPackageFiles(['docs/preuves/trace.log'], {
      cwd: PROJECT_ROOT,
      scanContents: false,
      patternsRoot: PROJECT_ROOT,
    });
    expect(result.ok).toBe(true);
    // Le motif exige un nom d'utilisateur alphanumérique : /home/.codebuddy ne matche pas.
    expect(PERSONAL_PATH_PATTERNS[0].pattern.test('/home/.codebuddy/x')).toBe(false);
    expect(PERSONAL_PATH_PATTERNS[0].pattern.test('/home/testuser/x')).toBe(true);
  });
});

describe('check-npm-package — le vrai paquet est accepté', () => {
  it('collecte la liste réelle via npm pack --dry-run et n’émet aucune violation', () => {
    const files = collectPackagedFiles(PROJECT_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const result = auditPackageFiles(files, { cwd: PROJECT_ROOT, patternsRoot: PROJECT_ROOT });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('check-npm-package — chaque règle est porteuse', () => {
  it('désactiver la règle *.map fait disparaître la violation (la règle compte)', () => {
    const files = ['package.json', 'dist/index.js.map'];
    const withRule = auditPackageFiles(files, { cwd: PROJECT_ROOT, scanContents: false, patternsRoot: PROJECT_ROOT });
    expect(withRule.ok).toBe(false);
    expect(withRule.violations).toContainEqual({
      file: 'dist/index.js.map',
      rule: 'forbidden-extension: *.map',
    });

    const withoutMapRule = FILENAME_RULES.filter((r) => r.rule !== 'forbidden-extension: *.map');
    const withoutRule = auditPackageFiles(files, {
      cwd: PROJECT_ROOT,
      scanContents: false,
      filenameRules: withoutMapRule,
      patternsRoot: PROJECT_ROOT,
    });
    expect(withoutRule.violations.some((v) => v.rule === 'forbidden-extension: *.map')).toBe(false);
    expect(withoutRule.ok).toBe(true);
  });

  it('désactiver la règle .env fait disparaître la violation (la règle compte)', () => {
    const files = ['package.json', '.env'];
    const withoutEnvRule = FILENAME_RULES.filter((r) => r.rule !== 'forbidden-pattern: .env*');
    const result = auditPackageFiles(files, {
      cwd: PROJECT_ROOT,
      scanContents: false,
      filenameRules: withoutEnvRule,
      patternsRoot: PROJECT_ROOT,
    });
    expect(result.violations.some((v) => v.rule === 'forbidden-pattern: .env*')).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('sans analyse de contenu, un secret dans le contenu n’est pas détecté (preuve que scanContents compte)', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(join(dir, 'dist', 'cfg.js'), 'const key = "AKIAIOSFODNN7EXAMPLE";\n');

    const scanned = auditPackageFiles(['dist/cfg.js'], { cwd: dir, patternsRoot: PROJECT_ROOT });
    expect(scanned.ok).toBe(false);

    const notScanned = auditPackageFiles(['dist/cfg.js'], {
      cwd: dir,
      scanContents: false,
      patternsRoot: PROJECT_ROOT,
    });
    expect(notScanned.ok).toBe(true);
  });
});

describe('check-npm-package — contournements fermés', () => {
  it('refuse un _qa/ quelle que soit la casse', () => {
    const result = auditPackageFiles(
      ['package.json', '_QA/report.html', 'foo/_Qa/bar.html'],
      { cwd: PROJECT_ROOT, scanContents: false, patternsRoot: PROJECT_ROOT },
    );
    expect(result.ok).toBe(false);
    const rules = result.violations.map((v) => `${v.file}::${v.rule}`);
    expect(rules).toContain('_QA/report.html::forbidden-directory: _qa/');
    expect(rules).toContain('foo/_Qa/bar.html::forbidden-directory: _qa/');
  });

  it('refuse .auth.json (fichier caché)', () => {
    const result = auditPackageFiles(['package.json', '.auth.json'], {
      cwd: PROJECT_ROOT,
      scanContents: false,
      patternsRoot: PROJECT_ROOT,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => `${v.file}::${v.rule}`)).toContain(
      '.auth.json::forbidden-file: auth.json',
    );
  });

  it('refuse .envrc et *.env (extensions voisines de .env)', () => {
    const result = auditPackageFiles(['package.json', 'dist/.envrc', 'dist/my.env'], {
      cwd: PROJECT_ROOT,
      scanContents: false,
      patternsRoot: PROJECT_ROOT,
    });
    expect(result.ok).toBe(false);
    const rules = result.violations.map((v) => `${v.file}::${v.rule}`);
    expect(rules).toContain('dist/.envrc::forbidden-pattern: .env*');
    expect(rules).toContain('dist/my.env::forbidden-pattern: .env*');
  });

  it('refuse /HOME/<nom> et les chemins Windows quelle que soit la casse', () => {
    const result = auditPackageFiles(
      [
        'docs/HOME/testuser/x.md',
        'C:\\Users\\testuser\\x.txt',
        'c:/users/testuser/x.txt',
        'c:\\users\\testuser\\y.txt',
      ],
      { cwd: PROJECT_ROOT, scanContents: false, patternsRoot: PROJECT_ROOT },
    );
    expect(result.ok).toBe(false);
    expect(result.violations.filter((v) => v.rule === 'forbidden-personal-path').length).toBe(4);
  });

  it('refuse /home/./<nom> et /home//<nom> (segments normalisés) dans le CONTENU', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(
      join(dir, 'dist', 'p.js'),
      'const a = "/home/./testuser/x";\nconst b = "/home//testuser/x";\n',
    );
    const result = auditPackageFiles(['dist/p.js'], { cwd: dir, patternsRoot: PROJECT_ROOT });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      file: 'dist/p.js',
      rule: 'forbidden-personal-path: /home/<nom>',
    });
  });

  it('refuse C:\\\\Users\\\\<nom> (double antislash) dans le CONTENU', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(join(dir, 'dist', 'w.js'), 'const p = "C:\\\\Users\\\\testuser\\\\x";\n');
    const result = auditPackageFiles(['dist/w.js'], { cwd: dir, patternsRoot: PROJECT_ROOT });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      file: 'dist/w.js',
      rule: 'forbidden-personal-path: C:\\Users\\<nom>',
    });
  });

  it('refuse un secret caché derrière un octet NUL ou une grande taille', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(join(dir, 'dist', 'nul.js'), 'const x = 1;\u0000\nconst key = "AKIAIOSFODNN7EXAMPLE";\n');
    writeFileSync(
      join(dir, 'dist', 'big.js'),
      'x'.repeat(5 * 1024 * 1024 + 1) + '\nconst key = "AKIAIOSFODNN7EXAMPLE";\n',
    );
    const result = auditPackageFiles(['dist/nul.js', 'dist/big.js'], {
      cwd: dir,
      patternsRoot: PROJECT_ROOT,
    });
    expect(result.ok).toBe(false);
    const rules = result.violations.map((v) => `${v.file}::${v.rule}`);
    expect(rules).toContain('dist/nul.js::forbidden-secret: aws_key');
    expect(rules).toContain('dist/big.js::forbidden-secret: aws_key');
  });
});

describe('check-npm-package — précision sur du code compilé (aucun faux positif)', () => {
  it('accepte un littéral de regex /home, un exemple /home/user et une liste /data/mot', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(
      join(dir, 'dist', 'code.js'),
      [
        'const re = /_qa\\/\\S+\\/home/i;',
        '/** files, e.g. `file:///home/user/.aws/credentials` */',
        'const msg = "leads/prospects/data/items/results";',
        'const agents = "(pdf/excel/data/sql/archive)";',
        '',
      ].join('\n'),
    );
    const result = auditPackageFiles(['dist/code.js'], { cwd: dir, patternsRoot: PROJECT_ROOT });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepte les expressions modèles (GitHub Actions, URL interpolée)', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(
      join(dir, 'dist', 'ci.js'),
      [
        "password: '${{ secrets.GITHUB_TOKEN }}',",
        'const uri = `PGRST_DB_URI=postgres://app:${encodeURIComponent(password)}@postgres:5432/app`;',
        '',
      ].join('\n'),
    );
    const result = auditPackageFiles(['dist/ci.js'], { cwd: dir, patternsRoot: PROJECT_ROOT });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepte la source d’un motif de clé privée (pas une clé)', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(
      join(dir, 'dist', 'redact.js'),
      'pattern: /-----BEGIN RSA PRIVATE KEY-----[\\s\\S]*?-----END RSA PRIVATE KEY-----/g,\n',
    );
    const result = auditPackageFiles(['dist/redact.js'], { cwd: dir, patternsRoot: PROJECT_ROOT });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('refuse quand même une vraie clé privée PEM dans un fichier empaqueté', () => {
    const dir = tracked(makeFakePackage());
    writeFileSync(
      join(dir, 'dist', 'key.js'),
      'const k = "-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA...";\n',
    );
    const result = auditPackageFiles(['dist/key.js'], { cwd: dir, patternsRoot: PROJECT_ROOT });
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      file: 'dist/key.js',
      rule: 'forbidden-secret: private_key',
    });
  });

  it('accepte l’arbre RÉELLEMENT compilé (dist/ présent) s’il existe', () => {
    const distDir = join(PROJECT_ROOT, 'dist');
    if (!existsSync(distDir)) return; // pas de build dans cet environnement
    const files = collectPackagedFiles(PROJECT_ROOT);
    expect(files.some((f) => f.startsWith('dist/'))).toBe(true);
    const result = auditPackageFiles(files, { cwd: PROJECT_ROOT, patternsRoot: PROJECT_ROOT });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});