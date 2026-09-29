import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { checkSecretFileAccess, classifySecretPath } from '../../src/security/secret-files.js';
import { findCredentialPathInCommand } from '../../src/tools/bash/command-validator.js';
import { isPathInside } from '../../src/security/path-comparison.js';

const darwin = { platform: 'darwin' as const };
const linux = { platform: 'linux' as const };
const home = path.join(process.cwd(), '_qa', 'casse-macos', 'home');

afterEach(() => vi.unstubAllEnvs());

describe('garde des chemins sur un volume macOS insensible à la casse', () => {
  it('classe les variantes de casse de la racine, des sessions et des chemins privés', () => {
    vi.stubEnv('HOME', home);

    expect(classifySecretPath(path.join(home, '.CodeBuddy', 'skill-signing', 'key.pem'), undefined, darwin).secret).toBe(true);
    expect(checkSecretFileAccess(path.join(home, '.CodeBuddy', 'AUTH.ts'), 'read', darwin).secret).toBe(true);
    expect(checkSecretFileAccess(path.join(home, '.CodeBuddy', 'AUTH.ts'), 'write', darwin).secret).toBe(true);
    expect(classifySecretPath(path.join(home, '.CodeBuddy', 'Sessions', 'private.txt'), undefined, darwin).secret).toBe(true);
    expect(classifySecretPath(path.join(home, '.SSH', 'config'), undefined, darwin).secret).toBe(true);
    expect(classifySecretPath('/ETC/SHADOW', undefined, darwin).secret).toBe(true);
    expect(classifySecretPath(path.join(home, '.CodeBuddy', 'settings.json'), undefined, darwin).secret).toBe(false);
  });

  it('refuse les lectures récursives et les chemins dynamiques même sans symlink Linux', () => {
    vi.stubEnv('HOME', home);

    expect(findCredentialPathInCommand('grep -r FAKE ~/.CodeBuddy/skill-signing', 'darwin')).not.toBeNull();
    expect(findCredentialPathInCommand('cat ~/.CodeBuddy/skill-signing/key-$NAME.pem', 'darwin')).not.toBeNull();
    expect(findCredentialPathInCommand('cat ~/.CodeBuddy/settings.json', 'darwin')).toBeNull();
  });

  it('conserve la distinction de casse sous Linux', () => {
    vi.stubEnv('HOME', home);

    expect(classifySecretPath(path.join(home, '.CodeBuddy', 'AUTH.ts'), undefined, linux).secret).toBe(false);
    expect(classifySecretPath(path.join(home, '.codebuddy', 'AUTH.ts'), undefined, linux).secret).toBe(true);
  });

  it('respecte les frontières de répertoire sur les trois plateformes', () => {
    expect(isPathInside('/Users/runner/.CodeBuddy/key.pem', '/Users/runner/.codebuddy', 'darwin')).toBe(true);
    expect(isPathInside('/Users/runner/.CodeBuddy-other/key.pem', '/Users/runner/.codebuddy', 'darwin')).toBe(false);
    expect(isPathInside('/home/runner/.CodeBuddy/key.pem', '/home/runner/.codebuddy', 'linux')).toBe(false);
    expect(isPathInside('C:\\Users\\runner\\.CodeBuddy\\key.pem', 'c:\\users\\runner\\.codebuddy', 'win32')).toBe(true);
  });
});
