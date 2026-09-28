/**
 * Public source name guard. Set CODEBUDDY_EXCLUDED_NAMES to a comma/newline-separated
 * list, or CODEBUDDY_EXCLUDED_NAMES_FILE to an untracked UTF-8 file with one name
 * per line. Without either, the local `git config user.name` supplies the names.
 * CI should set an explicit value: Git identity is optional and may be a bot.
 * The exclusion list itself must never be committed to the public repository.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function configuredNames(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.CODEBUDDY_EXCLUDED_NAMES;
  const file = env.CODEBUDDY_EXCLUDED_NAMES_FILE;
  let raw: string;
  if (explicit !== undefined || file !== undefined) {
    raw = [explicit ?? '', file ? readFileSync(file, 'utf8') : ''].join('\n');
  } else {
    try {
      raw = execFileSync('git', ['config', '--get', 'user.name'], { cwd: root, encoding: 'utf8' });
    } catch {
      raw = '';
    }
  }
  return [...new Set(raw.split(/[,;\r\n\s]+/u).map((name) => name.trim()).filter(Boolean))];
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
  });

  it('ne laisse aucun nom exclu dans src/ ou cowork/src/', () => {
    const names = configuredNames();
    if (names.length === 0) return;
    const violations = sourceFiles().flatMap((path) => {
      const content = readFileSync(join(root, path), 'utf8');
      const matches = foundNames(content, names);
      return matches.length ? [`${path}: ${matches.join(', ')}`] : [];
    });
    expect(violations, 'Noms personnels dans le code public').toEqual([]);
  });
});
