import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { TrustFolderManager } from '../../src/security/trust-folders.js';

describe('TrustFolderManager', () => {
  let manager: TrustFolderManager;

  beforeEach(() => {
    manager = new TrustFolderManager();
    manager.setEnforcement(true);
  });

  it('should trust current working directory by default', () => {
    const cwd = process.cwd();
    expect(manager.isTrusted(cwd)).toBe(true);
    expect(manager.isTrusted(path.join(cwd, 'src', 'file.ts'))).toBe(true);
  });

  it('should not trust arbitrary directories', () => {
    expect(manager.isTrusted('/some/random/dir')).toBe(false);
  });

  it('should trust explicitly added folders', () => {
    const testDir = '/tmp/test-trusted';
    expect(manager.trustFolder(testDir)).toBe(true);
    expect(manager.isTrusted(testDir)).toBe(true);
    expect(manager.isTrusted(path.join(testDir, 'sub', 'file.txt'))).toBe(true);
  });

  it('should block always-blocked directories', () => {
    expect(manager.isBlocked('/')).toBe(true);
    expect(manager.isBlocked('/etc')).toBe(true);
    expect(manager.isBlocked(os.homedir())).toBe(true);
    expect(manager.isBlocked(path.join(os.homedir(), '.ssh'))).toBe(true);
  });

  it('should refuse to trust blocked directories', () => {
    expect(manager.trustFolder('/')).toBe(false);
    expect(manager.trustFolder(os.homedir())).toBe(false);
  });

  it('should untrust folders', () => {
    const testDir = '/tmp/test-untrust';
    manager.trustFolder(testDir);
    expect(manager.isTrusted(testDir)).toBe(true);

    expect(manager.untrustFolder(testDir)).toBe(true);
    expect(manager.isTrusted(testDir)).toBe(false);
  });

  it('should return false when untrusting non-existent folder', () => {
    expect(manager.untrustFolder('/never/added')).toBe(false);
  });

  it('should allow everything when enforcement is disabled', () => {
    manager.setEnforcement(false);
    expect(manager.isTrusted('/any/path')).toBe(true);
    expect(manager.isEnforcementEnabled()).toBe(false);
  });

  it('should list trusted folders', () => {
    manager.trustFolder('/tmp/a');
    manager.trustFolder('/tmp/b');
    const folders = manager.getTrustedFolders();
    expect(folders).toContain(path.resolve('/tmp/a'));
    expect(folders).toContain(path.resolve('/tmp/b'));
  });

  describe('isReadableSkillsPath (read-only skills exception)', () => {
    const skillsDir = path.join(os.homedir(), '.codebuddy', 'skills');

    it('recognizes the skills dir itself and paths beneath it', () => {
      expect(manager.isReadableSkillsPath(skillsDir)).toBe(true);
      expect(
        manager.isReadableSkillsPath(path.join(skillsDir, 'pdfcommander', 'SKILL.md')),
      ).toBe(true);
      expect(
        manager.isReadableSkillsPath(path.join(skillsDir, 'managed', 'x', 'scripts', 'y.sh')),
      ).toBe(true);
    });

    it('does NOT cover the rest of ~/.codebuddy (credentials stay protected)', () => {
      const configDir = path.join(os.homedir(), '.codebuddy');
      // Credential / config files that live in ~/.codebuddy but NOT in skills/.
      expect(manager.isReadableSkillsPath(path.join(configDir, 'codex-auth.json'))).toBe(false);
      expect(manager.isReadableSkillsPath(path.join(configDir, 'credentials.enc'))).toBe(false);
      expect(manager.isReadableSkillsPath(path.join(configDir, 'fleet.env'))).toBe(false);
      expect(manager.isReadableSkillsPath(path.join(configDir, 'trusted-folders.json'))).toBe(false);
      expect(manager.isReadableSkillsPath(path.join(configDir, 'auth', 'token.json'))).toBe(false);
      expect(manager.isReadableSkillsPath(configDir)).toBe(false);
    });

    it('does NOT cover arbitrary paths', () => {
      expect(manager.isReadableSkillsPath('/etc/passwd')).toBe(false);
      expect(manager.isReadableSkillsPath('/some/random/dir')).toBe(false);
    });

    it('is not fooled by a sibling dir sharing the prefix', () => {
      // "skills-secret" shares the "skills" prefix but is not inside skills/.
      expect(
        manager.isReadableSkillsPath(path.join(os.homedir(), '.codebuddy', 'skills-secret', 'k')),
      ).toBe(false);
    });

    it('blocks a symlink under skills/ that escapes to a sensitive target', () => {
      // Defense against the classic prefix-check bypass: a symlink living inside
      // skills/ but resolving outside it must NOT be treated as a skills read.
      const escapeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-escape-'));
      const target = path.join(escapeRoot, 'secret.txt');
      fs.writeFileSync(target, 'top secret');

      // Ensure skills/ exists so we can plant the symlink inside it.
      fs.mkdirSync(skillsDir, { recursive: true });
      const link = path.join(skillsDir, '__escape_link__');
      try {
        fs.symlinkSync(target, link);
        // The link path is lexically under skills/, but realpath resolves out.
        expect(manager.isReadableSkillsPath(link)).toBe(false);
      } finally {
        try {
          fs.unlinkSync(link);
        } catch {
          /* ignore */
        }
        fs.rmSync(escapeRoot, { recursive: true, force: true });
      }
    });
  });
});
