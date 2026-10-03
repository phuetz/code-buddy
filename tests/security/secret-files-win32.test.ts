import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { checkSecretFileAccess, classifySecretPath, getHomeCredentialRoots } from '../../src/security/secret-files.js';

const shellHome = 'D:\\AgentHome';
const userProfile = 'C:\\Users\\Operator';
const win32 = { platform: 'win32' as const };

afterEach(() => vi.unstubAllEnvs());

describe('classification commune des lecteurs sous Windows', () => {
  it('protège HOME et USERPROFILE même lorsqu’ils désignent deux volumes différents', () => {
    vi.stubEnv('HOME', shellHome);
    vi.stubEnv('USERPROFILE', userProfile);

    expect(getHomeCredentialRoots(win32)).toContain(path.win32.join(shellHome, '.codebuddy'));
    expect(getHomeCredentialRoots(win32)).toContain(path.win32.join(userProfile, '.codebuddy'));
    expect(checkSecretFileAccess(path.win32.join(shellHome, '.codebuddy', 'auth.ts'), 'read', win32).secret).toBe(true);
    expect(checkSecretFileAccess(path.win32.join(userProfile, '.CodeBuddy', 'AUTH.ts'), 'read', win32).secret).toBe(true);
    expect(checkSecretFileAccess(path.win32.join(userProfile, '.CodeBuddy', 'AUTH.ts').replaceAll('\\', '/'), 'read', win32).secret).toBe(true);
  });

  it.each([
    ['bug_finder / LSP', path.win32.join(shellHome, '.codebuddy', 'auth.ts')],
    ['image_edit', path.win32.join(shellHome, '.codebuddy', 'credentials.png')],
    ['understand_video / document', path.win32.join(shellHome, '.codebuddy', 'codex-auth.json')],
    ['paper_qa', path.win32.join(shellHome, '.codebuddy', 'sessions', 'private.pdf')],
    ['OCR / markdown_convert / archive', path.win32.join(shellHome, '.codebuddy', 'skill-signing', 'key.pem')],
    ['configuration SSH', path.win32.join(shellHome, '.ssh', 'config')],
    ['configuration AWS', path.win32.join(shellHome, '.aws', 'credentials')],
    ['configuration Docker', path.win32.join(shellHome, '.docker', 'config.json')],
    ['configuration Google Cloud', path.win32.join(shellHome, '.config', 'gcloud', 'credentials.db')],
    ['fichier .env de projet', path.win32.join('E:\\workspace', '.env')],
  ])('refuse le chemin utilisé par %s', (_reader, file) => {
    vi.stubEnv('HOME', shellHome);
    vi.stubEnv('USERPROFILE', userProfile);
    expect(checkSecretFileAccess(file, 'read', win32).secret).toBe(true);
  });

  it('garde lisibles les fichiers de configuration publics', () => {
    vi.stubEnv('HOME', shellHome);
    vi.stubEnv('USERPROFILE', userProfile);
    expect(classifySecretPath(path.win32.join(shellHome, '.codebuddy', 'settings.json'), undefined, win32).secret).toBe(false);
    expect(classifySecretPath(path.win32.join(shellHome, '.codebuddy', 'provider-health.json'), undefined, win32).secret).toBe(false);
    expect(classifySecretPath(path.win32.join('E:\\workspace', '.env.example'), undefined, win32).secret).toBe(false);
    expect(checkSecretFileAccess(path.win32.join(shellHome, '.codebuddy', 'auth.ts'), 'write', win32).secret).toBe(true);
    expect(checkSecretFileAccess(path.win32.join('E:\\workspace', '.env'), 'write', win32).secret).toBe(false);
  });
});
