import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  NATIVE_SANDBOX_ENV,
  buildBwrapArgv,
  buildLandlockArgv,
  buildSeatbeltArgv,
  buildSeatbeltProfile,
  clearNativeSandboxCache,
  confineSpawn,
  formatDoctorLine,
  isNativeSandboxEnabled,
  requestedNativeSandboxBackend,
  type NativeSandboxCapabilities,
  type NativeSandboxPolicy,
} from '../../src/security/native-sandbox.js';

const PROJECT = '/home/me/work/my project';
const TMP = '/home/me/work/my project/.codebuddy/native-sandbox-tmp';
const HOME = '/home/me';

function policy(overrides: Partial<NativeSandboxPolicy> = {}): NativeSandboxPolicy {
  return {
    projectRoot: PROJECT,
    tmpDir: TMP,
    homeDir: HOME,
    chdir: PROJECT,
    network: false,
    hidePaths: [
      '/etc',
      `${HOME}/.ssh`,
      `${HOME}/.codebuddy`,
      `${HOME}/.gnupg`,
    ],
    readOnlyRoots: ['/usr', '/bin', '/lib', '/proc', '/dev'],
    ...overrides,
  };
}

function linuxCaps(overrides: Partial<NativeSandboxCapabilities> = {}): NativeSandboxCapabilities {
  return {
    platform: 'linux',
    bwrapPath: null,
    bwrapVersion: null,
    bwrapUsable: false,
    bwrapUnusableReason: 'injected: bwrap absent',
    landlockAbi: null,
    sandboxExecPath: null,
    pythonPath: null,
    recommended: 'none',
    reason: 'injected: no backend',
    ...overrides,
  };
}

afterEach(() => {
  clearNativeSandboxCache();
  delete process.env[NATIVE_SANDBOX_ENV];
});

describe('CODEBUDDY_NATIVE_SANDBOX flag', () => {
  it('is disabled when the variable is absent, empty, or an explicit off token', () => {
    expect(isNativeSandboxEnabled({})).toBe(false);
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: '' })).toBe(false);
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: '0' })).toBe(false);
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: 'false' })).toBe(false);
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: 'off' })).toBe(false);
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: 'no' })).toBe(false);
  });

  it('is enabled for true/1 and for an explicit backend name', () => {
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: 'true' })).toBe(true);
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: '1' })).toBe(true);
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: 'bwrap' })).toBe(true);
    expect(isNativeSandboxEnabled({ [NATIVE_SANDBOX_ENV]: 'landlock' })).toBe(true);
    expect(requestedNativeSandboxBackend({ [NATIVE_SANDBOX_ENV]: 'bwrap' })).toBe('bwrap');
    expect(requestedNativeSandboxBackend({ [NATIVE_SANDBOX_ENV]: 'true' })).toBe('auto');
  });
});

describe('buildBwrapArgv', () => {
  it('emits the expected argv for a given policy, keeping spaced paths as single tokens', () => {
    const argv = buildBwrapArgv(policy(), ['bash', '-c', 'echo ok']);
    expect(argv[0]).toBe('--die-with-parent');
    expect(argv).toContain('--unshare-net');
    expect(argv).toContain('--ro-bind');
    expect(argv).toContain('--bind');
    expect(argv).toContain(PROJECT);
    expect(argv).toContain(TMP);
    expect(argv).toContain('--');
    expect(argv.slice(-3)).toEqual(['bash', '-c', 'echo ok']);
    expect(argv.filter((token) => token === PROJECT)).toHaveLength(3); // bind src+dest + chdir
    expect(argv.some((token) => token.includes('my project') && token.includes(' '))).toBe(true);
  });

  it('never mounts sensitive paths as writable binds', () => {
    const argv = buildBwrapArgv(policy(), ['/bin/echo', 'ok']);
    const binds: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--bind' || argv[i] === '--bind-try' || argv[i] === '--dev-bind') {
        const src = argv[i + 1];
        const dest = argv[i + 2];
        if (src) binds.push(src);
        if (dest) binds.push(dest);
      }
    }
    expect(binds).toEqual([PROJECT, PROJECT, TMP, TMP]);
    expect(binds.some((p) => p === '/etc' || p.endsWith('/.ssh') || p.endsWith('/.codebuddy'))).toBe(
      false,
    );
    expect(argv).toContain('--tmpfs');
    expect(argv).toContain('/etc');
    expect(argv).toContain(`${HOME}/.ssh`);
    expect(argv).toContain(`${HOME}/.codebuddy`);
  });

  it('does not unshare the network when the policy allows it', () => {
    const argv = buildBwrapArgv(policy({ network: true }), ['true']);
    expect(argv).not.toContain('--unshare-net');
  });
});

describe('buildLandlockArgv', () => {
  it('prefixes the helper and keeps spaced project paths intact', () => {
    const helper = '/opt/codebuddy/landlock-confine.py';
    const argv = buildLandlockArgv(policy(), ['bash', '-c', 'echo ok'], helper);
    expect(argv[0]).toBe(helper);
    expect(argv).toContain('--project');
    expect(argv).toContain(PROJECT);
    expect(argv).toContain('--tmp');
    expect(argv).toContain(TMP);
    expect(argv).toContain('--');
    expect(argv.slice(-3)).toEqual(['bash', '-c', 'echo ok']);
    expect(argv).not.toContain('--network');
    expect(argv.includes(`${HOME}/.ssh`)).toBe(false);
    expect(argv.includes('/etc')).toBe(false);
  });
});

describe('buildSeatbeltArgv', () => {
  it('passes the profile as one -p argument so spaced paths stay quoted inside it', () => {
    const profile = buildSeatbeltProfile(policy());
    const argv = buildSeatbeltArgv(profile, ['bash', '-c', 'echo ok']);
    expect(argv[0]).toBe('-p');
    expect(argv[1]).toBe(profile);
    expect(argv.slice(2)).toEqual(['bash', '-c', 'echo ok']);
    expect(profile).toContain(`(subpath "${PROJECT}")`);
    expect(profile).toContain('(deny file-read* file-write* (subpath "/etc"))');
    expect(profile).toContain(`(subpath "${HOME}/.ssh")`);
    expect(profile).not.toContain('(allow network*)');
  });
});

describe('confineSpawn', () => {
  const command = { file: 'bash', args: ['-c', 'echo ok'], cwd: PROJECT, env: { PATH: '/bin' } };

  it('returns the original argv unchanged when the variable is absent (no host probe)', () => {
    const spawnSync = (): never => {
      throw new Error('must not probe when native sandbox is off');
    };
    const result = confineSpawn(command, { env: {}, spawnSync });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backend).toBe('none');
    expect(result.file).toBe('bash');
    expect(result.args).toEqual(['-c', 'echo ok']);
    expect(result.env).toEqual({ PATH: '/bin' });
  });

  it('refuses the command when the variable is set and no backend can confine', () => {
    const result = confineSpawn(command, {
      env: { [NATIVE_SANDBOX_ENV]: 'true' },
      capabilities: linuxCaps(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/CODEBUDDY_NATIVE_SANDBOX is set/);
    expect(result.error).toMatch(/was not executed/i);
  });

  it('refuses rather than falling back when bwrap is requested but unusable', () => {
    const result = confineSpawn(command, {
      env: { [NATIVE_SANDBOX_ENV]: 'bwrap' },
      capabilities: linuxCaps({
        bwrapPath: '/usr/bin/bwrap',
        bwrapUsable: false,
        bwrapUnusableReason: 'setting up uid map: Permission denied',
        landlockAbi: 7,
        pythonPath: '/usr/bin/python3',
        recommended: 'landlock',
        reason: 'landlock ABI 7',
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/bubblewrap|bwrap/i);
    expect(result.error).toMatch(/was not executed/i);
  });

  it('wraps with bwrap argv when that backend is usable', () => {
    const result = confineSpawn(command, {
      env: { [NATIVE_SANDBOX_ENV]: 'bwrap' },
      capabilities: linuxCaps({
        bwrapPath: '/usr/bin/bwrap',
        bwrapUsable: true,
        bwrapUnusableReason: null,
        recommended: 'bwrap',
        reason: 'bwrap usable',
      }),
      existsSync: () => true,
      mkdirSync: () => undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backend).toBe('bwrap');
    expect(result.file).toBe('/usr/bin/bwrap');
    expect(result.args[0]).toBe('--die-with-parent');
    expect(result.args).toContain('--unshare-net');
    expect(result.args.slice(-3)).toEqual(['bash', '-c', 'echo ok']);
    expect(result.env.TMPDIR).toBeDefined();
  });

  it('wraps with the Landlock helper when bwrap is unusable but Landlock is present', () => {
    const helper = '/repo/src/security/landlock-confine.py';
    const result = confineSpawn(command, {
      env: { [NATIVE_SANDBOX_ENV]: 'true' },
      capabilities: linuxCaps({
        bwrapPath: '/usr/bin/bwrap',
        bwrapUsable: false,
        bwrapUnusableReason: 'loopback: Failed RTM_NEWADDR',
        landlockAbi: 7,
        pythonPath: '/usr/bin/python3',
        recommended: 'landlock',
        reason: 'landlock ABI 7',
      }),
      helperPath: helper,
      existsSync: () => true,
      mkdirSync: () => undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backend).toBe('landlock');
    expect(result.file).toBe('/usr/bin/python3');
    expect(result.args[0]).toBe(helper);
    expect(result.args).toContain('--project');
    // `confineSpawn` construit sa politique avec `path.resolve(cwd)` : la racine qui
    // atteint le helper est le chemin ABSOLU de l'hôte. Sur POSIX c'est PROJECT
    // inchangé ; sous le `path` win32 le même littéral devient `<lecteur>:\home\...`.
    // On vérifie donc la valeur que le code calcule, toujours en UN seul jeton argv
    // La racine reste UN seul jeton argv : l'espace de « my project » ne la scinde pas.
    expect(result.args).toContain(path.resolve(PROJECT));
    expect(result.args.slice(-3)).toEqual(['bash', '-c', 'echo ok']);
  });
});

describe('formatDoctorLine', () => {
  it('states why a backend is unavailable', () => {
    const line = formatDoctorLine(
      linuxCaps({
        bwrapPath: '/usr/bin/bwrap',
        bwrapUsable: false,
        bwrapUnusableReason: 'setting up uid map: Permission denied',
        landlockAbi: 7,
        pythonPath: '/usr/bin/python3',
        recommended: 'landlock',
        reason: 'Landlock ABI 7 usable; bubblewrap present but cannot create a user namespace',
      }),
    );
    expect(line).toMatch(/landlock/i);
    expect(line).toMatch(/bubblewrap/i);
    expect(line).toMatch(/user namespace|uid map/i);
  });
});
