import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { spawnBashScript } from '../setup/platform-fixtures.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const installerPath = path.join(repoRoot, 'install.sh');
const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// The installer is a Bash script; Windows requires a working Git Bash.
// install.sh refuses MINGW/MSYS by design (Windows users install via WSL2 or npm), so even with
// Git Bash present the installer cannot be exercised on a Windows runner.
describe.skipIf(process.platform === 'win32')('one-command installer launcher', () => {
  it.each([false, true])('creates a package-relative launcher over a stale wrapper (Windows Node paths=%s)', (windowsNodePaths) => {
    const scratchRoot = fs.mkdtempSync(
      path.join(process.env.TMPDIR || os.tmpdir(), 'e17-installer-')
    );
    scratchRoots.push(scratchRoot);
    const fakeBin = path.join(scratchRoot, 'fake-bin');
    const home = path.join(scratchRoot, 'home');
    const prefix = path.join(scratchRoot, 'npm-prefix');
    const packageRoot = path.join(prefix, 'lib', 'node_modules', '@phuetz', 'code-buddy');
    const packageEntry = path.join(packageRoot, 'dist', 'index.js');
    const npmLauncher = path.join(prefix, 'bin', 'buddy');

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(path.dirname(packageEntry), { recursive: true });
    fs.mkdirSync(path.dirname(npmLauncher), { recursive: true });
    fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(
      packageEntry,
      "#!/usr/bin/env node\nprocess.stdout.write('2.0.0-test\\n');\n",
      { mode: 0o755 }
    );
    fs.symlinkSync('../lib/node_modules/@phuetz/code-buddy/dist/index.js', npmLauncher);
    fs.writeFileSync(
      path.join(home, '.local', 'bin', 'buddy'),
      '#!/bin/sh\nCODEBUDDY_ROOT=/old/checkout\nexit 99\n',
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(home, '.profile'),
      'export PATH="$HOME/.local/bin:$PATH"\n'
    );

    const fakeNpm = path.join(fakeBin, 'npm');
    fs.writeFileSync(
      fakeNpm,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '11.17.0'
  exit 0
fi
if [ "$1" = "config" ] && [ "$2" = "get" ] && [ "$3" = "prefix" ]; then
  printf '%s\\n' "$FAKE_NPM_PREFIX"
  exit 0
fi
if [ "$1" = "install" ]; then
  exit 0
fi
exit 1
`,
      { mode: 0o755 }
    );

    // Exercise the real installer with Node's Windows-style path outputs even
    // on Linux. Only its two path-printing subprocesses are affected.
    const pathProbe = path.join(scratchRoot, 'windows-node-paths.cjs');
    fs.writeFileSync(pathProbe, `
if (process._eval?.includes('fs.realpathSync')) {
  if (process._eval.includes('path.relative')) {
    const path = require('node:path');
    const relative = path.relative;
    path.relative = (...args) => relative(...args).replace(/\\//g, '\\\\');
  } else {
    const fs = require('node:fs');
    const realpath = fs.realpathSync;
    fs.realpathSync = (...args) => realpath(...args).replace(/\\//g, '\\\\');
  }
}
`);

    const runInstaller = () =>
      spawnBashScript(installerPath, [], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          ...(windowsNodePaths ? { NODE_OPTIONS: `--require "${pathProbe.replace(/\\/g, '/')}"` } : {}),
          HOME: home.replace(/\\/g, '/'),
          CODEBUDDY_HOME: path.join(home, '.codebuddy').replace(/\\/g, '/'),
          FAKE_NPM_PREFIX: prefix.replace(/\\/g, '/'),
          MSYS: 'winsymlinks:nativestrict',
          OLLAMA_HOST: 'http://127.0.0.1:1',
          PATH: [fakeBin, path.dirname(process.execPath), process.env.PATH ?? ''].join(path.delimiter),
        },
      });

    const result = runInstaller();

    expect(result.status, result.stderr).toBe(0);
    const managedBin = path.join(home, '.codebuddy', 'bin');
    const managedLauncher = path.join(managedBin, 'buddy');
    const packageLink = path.join(managedBin, '.code-buddy-package');
    expect(fs.existsSync(managedLauncher)).toBe(true);
    expect(fs.lstatSync(packageLink).isSymbolicLink()).toBe(true);
    expect(path.isAbsolute(fs.readlinkSync(packageLink))).toBe(false);

    const launcherSource = fs.readFileSync(managedLauncher, 'utf8');
    expect(launcherSource).toContain('$BUDDY_BIN_DIR/.code-buddy-package/dist/index.js');
    expect(launcherSource).not.toContain(scratchRoot);
    expect(launcherSource).not.toContain('CODEBUDDY_ROOT');

    const version = spawnBashScript(managedLauncher, ['--version'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: [path.dirname(process.execPath), process.env.PATH ?? ''].join(path.delimiter) },
    });
    expect(version.status, version.stderr).toBe(0);
    expect(version.stdout).toBe('2.0.0-test\n');
    const profileEntry = `export PATH="${managedBin.replace(/\\/g, '/')}:$PATH"`;
    expect(fs.readFileSync(path.join(home, '.profile'), 'utf8')).toContain(profileEntry);

    const secondRun = runInstaller();
    expect(secondRun.status, secondRun.stderr).toBe(0);
    expect(fs.readFileSync(path.join(home, '.profile'), 'utf8').split(profileEntry)).toHaveLength(2);
  });
});
