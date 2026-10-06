/**
 * Public source name guard. Set CODEBUDDY_EXCLUDED_NAMES to a comma/newline-separated
 * list, or CODEBUDDY_EXCLUDED_NAMES_FILE to an untracked UTF-8 file with one name
 * per line. Without either, the local `git config user.name` supplies the names.
 * CI writes an untracked list derived from package.json's author metadata.
 * Missing names fail the test instead of silently disabling the guard.
 * The exclusion list itself must never be committed to the public repository.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function explicitNames(raw: string): string[] {
  return [...new Set(raw.split(/[,;\r\n]+/u).map((name) => name.trim()).filter(Boolean))];
}

function gitIdentityNames(raw: string): string[] {
  const identity = raw.trim();
  if (!identity) return [];
  const words = identity.split(/\s+/u);
  const first = words[0] ?? '';
  const generic = new Set(['code', 'buddy', 'dev', 'developer', 'bot', 'github', 'actions', 'test', 'user', 'utilisateur']);
  // Preserve the full identity. Add its first name only when it is not a
  // common account label, so identities such as "Le Dev" do not match prose.
  return words.length > 1 && first.length >= 4 && !generic.has(first.toLowerCase())
    ? [identity, first]
    : [identity];
}

function configuredNames(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.CODEBUDDY_EXCLUDED_NAMES;
  const file = env.CODEBUDDY_EXCLUDED_NAMES_FILE;
  if (explicit !== undefined || file !== undefined) {
    return explicitNames([explicit ?? '', file ? readFileSync(file, 'utf8') : ''].join('\n'));
  }
  try {
    return gitIdentityNames(execFileSync('git', ['config', '--get', 'user.name'], { cwd: root, encoding: 'utf8' }));
  } catch {
    return [];
  }
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function foundNames(content: string, names: string[]): string[] {
  return names.filter((name) =>
    new RegExp(`(?<![\\p{L}\\p{N}_])${escaped(name)}(?![\\p{L}\\p{N}_])`, 'iu').test(content)
  );
}

function sourceFiles(): string[] {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src/', 'cowork/src/'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  ).split('\0').filter((path) => /\.(?:ts|tsx|js|jsx|json|md)$/u.test(path));
}

describe('noms personnels hors du code public', () => {
  it('lit la liste explicite sans dépendre de l’identité Git', () => {
    expect(configuredNames({ CODEBUDDY_EXCLUDED_NAMES: 'NomTemoin, AutreNom' } as NodeJS.ProcessEnv))
      .toEqual(['NomTemoin', 'AutreNom']);
    expect(foundNames('Bonjour NomTemoin, bienvenue.', ['NomTemoin'])).toEqual(['NomTemoin']);
    expect(foundNames('prefixeNomTemoin', ['NomTemoin'])).toEqual([]);
    expect(gitIdentityNames('Le Dev')).toEqual(['Le Dev']);
    expect(gitIdentityNames('NomTemoin FAMILLE')).toEqual(['NomTemoin FAMILLE', 'NomTemoin']);
  });

  it('ne laisse aucun nom exclu dans src/ ou cowork/src/', () => {
    const names = configuredNames();
    expect(names.length, 'Configure CODEBUDDY_EXCLUDED_NAMES_FILE, CODEBUDDY_EXCLUDED_NAMES, or git user.name').toBeGreaterThan(0);
    const violations = sourceFiles().flatMap((path) => {
      const content = readFileSync(join(root, path), 'utf8');
      const matches = foundNames(content, names);
      return matches.length ? [`${path}: ${matches.join(', ')}`] : [];
    });
    expect(violations, 'Noms personnels dans le code public').toEqual([]);
  });
});
