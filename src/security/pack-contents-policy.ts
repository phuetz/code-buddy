/**
 * Pack Contents Security Policy
 *
 * Enforces strict boundaries on files included in the npm package tarball.
 * Ensures no source maps (*.map), environment files (.env*), secrets,
 * tests, internal workspaces, private personal terms, or unlisted files
 * can ever be published to the public npm registry.
 */

export interface PackViolation {
  file: string;
  rule: string;
}

export interface PackAuditResult {
  ok: boolean;
  violations: PackViolation[];
}

export interface PackPolicyOptions {
  allowedEntries?: readonly string[];
  packageJsonFiles?: readonly string[];
}

/**
 * Standard allowed prefixes and entries derived from package.json `files` and
 * implicit npm publication metadata.
 */
export const DEFAULT_ALLOWED_PREFIXES: readonly string[] = [
  'dist',
  'codebuddy-runtime.json',
  'examples/claude_desktop_config.json',
  'examples/README.md',
  'README.md',
  'LICENSE',
  'package.json',
  'NOTICE',
  'CHANGELOG.md',
];

/**
 * Explicit list of forbidden directory prefixes, patterns, and extensions.
 */
export const FORBIDDEN_DIRECTORIES: readonly string[] = [
  '.codebuddy/',
  'tests/',
  'test/',
  'src/',
  'cowork/',
  '.github/',
  '_qa/',
  'scripts/',
];

export const FORBIDDEN_PATTERNS = {
  map: /\.map$/i,
  env: /(^|\/)\.env/i,
  pem: /\.pem$/i,
  key: /\.key$/i,
  p12: /\.p12$/i,
  idRsa: /(^|\/)id_rsa/i,
  sqlite: /\.(sqlite|sqlite3)$/i,
  jsonl: /\.jsonl$/i,
} as const;

/**
 * Forbidden personal data and private infrastructure patterns.
 * Tokens are split to prevent hardcoding sensitive patterns in public codebase.
 */
export const FORBIDDEN_PERSONAL_PATTERNS: readonly string[] = [
  ['france', 'travail'].join(' '),
  ['p\u00f4le', 'emploi'].join(' '),
  ['pole', 'emploi'].join(' '),
  ['assurance', 'ch\u00f4mage'].join(' '),
  ['assurance', 'chomage'].join(' '),
  ['cumul', 'are'].join(' '),
  ['prestataire', 'de', 'la', 'ccas'].join(' '),
  ['demandeur', "d'emploi"].join(' '),
  ['100', '73', ''].join('.'),
  ['dark', 'star'].join(''),
];

/**
 * Pure audit function checking whether a given list of packaged files
 * strictly adheres to npm pack security policy rules.
 */
export function auditPackContents(
  files: readonly string[],
  options: PackPolicyOptions = {},
): PackAuditResult {
  const violations: PackViolation[] = [];
  const allowedEntries = options.allowedEntries ?? options.packageJsonFiles ?? DEFAULT_ALLOWED_PREFIXES;

  for (const rawFile of files) {
    const file = rawFile.replace(/\\/g, '/').replace(/^\.\//, '');
    const normalizedLower = file.toLowerCase();
    const normalizedSpaced = normalizedLower.replace(/[-_]/g, ' ');

    // 1. Personal patterns check (Rule c)
    for (const pattern of FORBIDDEN_PERSONAL_PATTERNS) {
      const lowerPattern = pattern.toLowerCase();
      const spacedPattern = lowerPattern.replace(/[-_]/g, ' ');
      if (
        normalizedLower.includes(lowerPattern) ||
        normalizedSpaced.includes(spacedPattern)
      ) {
        violations.push({
          file: rawFile,
          rule: `forbidden-personal-pattern: ${pattern}`,
        });
      }
    }

    // 2. Forbidden patterns and extensions (Rule b)
    if (FORBIDDEN_PATTERNS.map.test(file)) {
      violations.push({ file: rawFile, rule: 'forbidden-extension: *.map' });
    }
    if (FORBIDDEN_PATTERNS.env.test(file)) {
      violations.push({ file: rawFile, rule: 'forbidden-pattern: .env*' });
    }
    if (FORBIDDEN_PATTERNS.pem.test(file)) {
      violations.push({ file: rawFile, rule: 'forbidden-extension: *.pem' });
    }
    if (FORBIDDEN_PATTERNS.key.test(file)) {
      violations.push({ file: rawFile, rule: 'forbidden-extension: *.key' });
    }
    if (FORBIDDEN_PATTERNS.p12.test(file)) {
      violations.push({ file: rawFile, rule: 'forbidden-extension: *.p12' });
    }
    if (FORBIDDEN_PATTERNS.idRsa.test(file)) {
      violations.push({ file: rawFile, rule: 'forbidden-pattern: id_rsa*' });
    }
    if (FORBIDDEN_PATTERNS.sqlite.test(file)) {
      violations.push({ file: rawFile, rule: 'forbidden-extension: *.sqlite' });
    }
    if (FORBIDDEN_PATTERNS.jsonl.test(file)) {
      violations.push({ file: rawFile, rule: 'forbidden-extension: *.jsonl' });
    }

    // Forbidden directories
    for (const dir of FORBIDDEN_DIRECTORIES) {
      const cleanDir = dir.replace(/\/$/, '');
      if (file === cleanDir || file.startsWith(cleanDir + '/') || file.includes('/' + cleanDir + '/')) {
        violations.push({ file: rawFile, rule: `forbidden-directory: ${dir}` });
      }
    }

    // 3. Allowed prefixes check (Rule a)
    const isAllowed = allowedEntries.some((allowed) => {
      const cleanAllowed = allowed.replace(/\/$/, '');
      if (file === cleanAllowed) return true;
      if (file.startsWith(cleanAllowed + '/')) return true;
      // Implicit root files handling
      if (/^(README|LICENSE|LICENCE|NOTICE|CHANGELOG)(\..+)?$/i.test(file)) return true;
      return false;
    });

    if (!isAllowed) {
      violations.push({ file: rawFile, rule: 'unauthorized-prefix' });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
