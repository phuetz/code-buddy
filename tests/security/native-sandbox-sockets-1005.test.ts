import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  buildBwrapArgv,
  buildDefaultPolicy,
  buildSeatbeltProfile,
  clearNativeSandboxCache,
  confineSpawn,
  runtimeSocketsToMask,
  agentSocketsToMask,
  sessionRuntimeDirs,
  detectNativeSandboxCapabilities,
} from '../../src/security/native-sandbox.js';

/**
 * CODEBUDDY_NATIVE_SANDBOX : les sockets de contrôle des moteurs de conteneurs de
 * l'hôte (docker, containerd, podman, cri-o) ne doivent pas être joignables, sans
 * masquer tout /run (la résolution DNS en dépend).
 */
const bwrapOk = process.platform === 'linux' && detectNativeSandboxCapabilities().bwrapUsable;
const hostSocket = ['/var/run/docker.sock', '/run/docker.sock', '/run/containerd/containerd.sock'].find((s) => fs.existsSync(s));
const tmp: string[] = [];
const mk = (prefix: string) => {
  // hors /tmp : bwrap ne peut pas créer de point de montage sous un /tmp en lecture seule
  const d = fs.realpathSync(fs.mkdtempSync(path.join('/var/tmp', prefix)));
  tmp.push(d);
  return d;
};
afterEach(() => {
  clearNativeSandboxCache();
  delete process.env.CODEBUDDY_NATIVE_SANDBOX;
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('masquage des sockets de moteurs de conteneurs', () => {
  it.skipIf(!bwrapOk || !hostSocket)('sous bwrap réel, le socket de l\'hôte n\'est plus un socket, /run reste visible', () => {
    process.env.CODEBUDDY_NATIVE_SANDBOX = 'bwrap';
    const ws = mk('sock-ws-');
    const res = confineSpawn(
      {
        file: '/bin/sh',
        args: ['-c', `if [ -S ${hostSocket} ]; then echo LEAK; else echo HIDDEN; fi; if [ -d /run/systemd ]; then echo RUN-VISIBLE; fi`],
        cwd: ws,
        env: { PATH: process.env.PATH },
        network: true,
      },
      { homedir: () => mk('sock-home-') },
    );
    if (!res.ok) throw new Error(res.error);
    const out = spawnSync(res.file, res.args, { env: res.env, encoding: 'utf8' }).stdout;
    // ÉCHOUE sur l'ancienne logique : « LEAK » (--ro-bind / / laissait le socket joignable).
    expect(out).toContain('HIDDEN');
    expect(out).not.toContain('LEAK');
    if (fs.existsSync('/run/systemd')) expect(out).toContain('RUN-VISIBLE');
  });

  it('buildBwrapArgv superpose /dev/null sur chaque socket à masquer, sans tmpfs sur /run', () => {
    const policy = buildDefaultPolicy('/var/tmp/proj', { existsSync: () => false, homedir: () => '/home/u' });
    if ('error' in policy) throw new Error(policy.error);
    const argv = buildBwrapArgv({ ...policy, maskSockets: ['/run/docker.sock'] }, ['true']);
    const i = argv.indexOf('/run/docker.sock');
    expect(argv.slice(i - 2, i + 1)).toEqual(['--ro-bind', '/dev/null', '/run/docker.sock']);
    expect(argv).not.toContain('/run');
  });

  it('les chemins /var/run et /run d\'un même socket sont fusionnés (realpath)', () => {
    const present = new Set(['/var/run/docker.sock', '/run/docker.sock', '/run/podman/podman.sock']);
    const masks = runtimeSocketsToMask({
      existsSync: (p: string) => present.has(p),
      realpathSync: (p: string) => p.replace('/var/run/', '/run/'),
      env: {},
    });
    expect(masks.sort()).toEqual(['/run/docker.sock', '/run/podman/podman.sock']);
  });

  it('couvre aussi les sockets rootless sous XDG_RUNTIME_DIR', () => {
    const sock = '/run/user/1000/podman/podman.sock';
    const masks = runtimeSocketsToMask({ existsSync: (p: string) => p === sock, realpathSync: (p: string) => p, env: { XDG_RUNTIME_DIR: '/run/user/1000' } });
    expect(masks).toEqual([sock]);
  });

  it('refuse de lancer la commande si la sonde voit encore un socket connu', () => {
    process.env.CODEBUDDY_NATIVE_SANDBOX = 'bwrap';
    const ws = mk('sock-ws-');
    const res = confineSpawn(
      { file: '/bin/true', args: [], cwd: ws, env: {} },
      {
        capabilities: { platform: 'linux', bwrapPath: '/usr/bin/bwrap', bwrapVersion: '0.9', bwrapUsable: true, bwrapUnusableReason: null, landlockAbi: null, pythonPath: null, sandboxExecPath: null, recommended: 'bwrap', reason: 'x' } as never,
        existsSync: (p: string) => p === '/var/run/docker.sock' || fs.existsSync(p),
        homedir: () => mk('sock-home-'),
        spawnSync: (() => ({ status: 0, stdout: '/var/run/docker.sock\n', stderr: '', error: undefined })) as never,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/container runtime socket is reachable/);
  });

  it('landlock : refuse quand un socket de moteur de conteneurs est écrivable, sans changer de backend', () => {
    const caps = { platform: 'linux', bwrapPath: null, bwrapVersion: null, bwrapUsable: false, bwrapUnusableReason: 'no', landlockAbi: 7, pythonPath: '/usr/bin/python3', sandboxExecPath: null, recommended: 'landlock', reason: 'landlock' } as never;
    const ws = mk('sock-ws-');
    const base = { capabilities: caps, helperPath: '/x/landlock-confine.py', homedir: () => mk('sock-home-'), env: { CODEBUDDY_NATIVE_SANDBOX: 'landlock' } };
    const open = confineSpawn({ file: '/bin/true', args: [], cwd: ws, env: {} }, { ...base, existsSync: (p: string) => p === '/var/run/docker.sock' || fs.existsSync(p), realpathSync: (p: string) => p, accessSync: () => undefined });
    // ÉCHOUE sur l'ancienne logique : ok:true avec le backend landlock.
    expect(open.ok).toBe(false);
    if (!open.ok) {
      expect(open.error).toMatch(/docker\.sock/);
      expect(open.error).toMatch(/CODEBUDDY_NATIVE_SANDBOX=bwrap/);
      expect(open.error).toMatch(/docker group/);
    }
    // socket présent mais non écrivable par l'utilisateur : Landlock reste utilisable
    const closed = confineSpawn({ file: '/bin/true', args: [], cwd: ws, env: {} }, { ...base, existsSync: (p: string) => p === '/var/run/docker.sock' || fs.existsSync(p), realpathSync: (p: string) => p, accessSync: () => { throw new Error('EACCES'); } });
    expect(closed.ok).toBe(true);
  });

  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const sessionBus = uid === null ? undefined : `/run/user/${uid}/bus`;

  it.skipIf(!bwrapOk || !sessionBus || !fs.existsSync(sessionBus))('sous bwrap réel, le bus de session et les agents (/run/user) sont masqués', () => {
    process.env.CODEBUDDY_NATIVE_SANDBOX = 'bwrap';
    const ws = mk('sock-ws-');
    const res = confineSpawn(
      {
        file: '/bin/sh',
        args: ['-c', `for s in ${sessionBus} /run/user/${uid}/keyring/ssh /run/user/${uid}/systemd/private; do if [ -S $s ]; then echo LEAK:$s; fi; done; [ -d /run/systemd ] && echo RUN-VISIBLE; echo done`],
        cwd: ws,
        env: { PATH: process.env.PATH },
        network: true,
      },
      { homedir: () => mk('sock-home-') },
    );
    if (!res.ok) throw new Error(res.error);
    const out = spawnSync(res.file, res.args, { env: res.env, encoding: 'utf8' }).stdout;
    // ÉCHOUE sur l'ancienne logique : « LEAK:/run/user/<uid>/bus » (systemd-run --user = évasion).
    expect(out).not.toContain('LEAK');
    if (fs.existsSync('/run/systemd')) expect(out).toContain('RUN-VISIBLE');
  });

  it.skipIf(!bwrapOk)('un HOME qui contient un FICHIER secret (.npmrc) ne fait plus échouer le masquage', () => {
    process.env.CODEBUDDY_NATIVE_SANDBOX = 'bwrap';
    const home = mk('sock-home-');
    fs.writeFileSync(path.join(home, '.npmrc'), '//registry/:_authToken=SECRET');
    fs.mkdirSync(path.join(home, '.ssh'));
    const ws = mk('sock-ws-');
    const res = confineSpawn(
      { file: '/bin/sh', args: ['-c', `cat ${path.join(home, '.npmrc')}; echo done`], cwd: ws, env: { PATH: process.env.PATH }, network: false },
      { homedir: () => home },
    );
    // ÉCHOUE sur l'ancienne logique : « bwrap: Can't mount tmpfs on a file », donc refus (sonde) ou échec.
    if (!res.ok) throw new Error(res.error);
    const run = spawnSync(res.file, res.args, { env: res.env, encoding: 'utf8' });
    expect(run.stdout).toBe('done\n');
    expect(run.stdout).not.toContain('SECRET');
  });

  it('agentSocketsToMask : SSH_AUTH_SOCK, bus de session nommé par l\'environnement, bus système', () => {
    const socks = agentSocketsToMask({ SSH_AUTH_SOCK: '/run/user/1000/keyring/ssh', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus,guid=abc' });
    expect(socks).toEqual(expect.arrayContaining(['/run/user/1000/keyring/ssh', '/run/user/1000/bus', '/run/dbus/system_bus_socket']));
  });

  it('sessionRuntimeDirs couvre /run/user, XDG_RUNTIME_DIR et /run/user/<uid>', () => {
    expect(sessionRuntimeDirs({ XDG_RUNTIME_DIR: '/run/user/7' }, 7)).toEqual(expect.arrayContaining(['/run/user', '/run/user/7']));
  });

  it('buildBwrapArgv : un fichier à cacher est recouvert par /dev/null, pas par un tmpfs', () => {
    const policy = buildDefaultPolicy('/var/tmp/proj', { existsSync: () => false, homedir: () => '/home/u' });
    if ('error' in policy) throw new Error(policy.error);
    const argv = buildBwrapArgv({ ...policy, hidePaths: ['/home/u/.npmrc', '/home/u/.ssh'], hideFiles: ['/home/u/.npmrc'] }, ['true']);
    const i = argv.indexOf('/home/u/.npmrc');
    expect(argv.slice(i - 2, i + 1)).toEqual(['--ro-bind', '/dev/null', '/home/u/.npmrc']);
    expect(argv.slice(argv.indexOf('/home/u/.ssh') - 1, argv.indexOf('/home/u/.ssh') + 1)).toEqual(['--tmpfs', '/home/u/.ssh']);
  });

  it('seatbelt : le profil interdit la connexion aux sockets même réseau ouvert', () => {
    const policy = buildDefaultPolicy('/Users/x/proj', { existsSync: () => false, homedir: () => '/Users/x' });
    if ('error' in policy) throw new Error(policy.error);
    const profile = buildSeatbeltProfile({ ...policy, network: true, maskSockets: ['/var/run/docker.sock'] });
    expect(profile).toContain('(deny network-outbound (remote unix-socket (path-literal "/var/run/docker.sock")))');
    expect(profile.indexOf('(allow network*)')).toBeLessThan(profile.indexOf('(deny network-outbound'));
  });
});
