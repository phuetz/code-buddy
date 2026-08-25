/**
 * Régression de sécurité — le shell interactif ne doit pas transmettre les
 * variables d'environnement qui permettent de détourner un interpréteur.
 *
 * Les scénarios lancent le vrai `InteractiveBashTool`, qui lance ensuite un
 * vrai shell enfant (PTY ou repli `exec`), et vérifient qu'un marqueur injecté
 * par le processus enfant n'apparaît plus.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InteractiveBashTool } from '../../src/tools/interactive-bash.js';

const MARKER = 'CODEBUDDY_INTERACTIVE_ENV_INJECTION_MARKER';

const PYTHON = (() => {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
})();

let environmentSnapshot: NodeJS.ProcessEnv;
let workDir: string;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

function combinedOutput(result: { stdout?: string | null; stderr?: string | null }): string {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

async function runInteractive(command: string, forceFallback = false): Promise<string> {
  const tool = new InteractiveBashTool();
  try {
    if (forceFallback) {
      Object.defineProperty(tool, 'isPTYAvailable', { value: false, writable: true });
    }
    const result = await tool.executeInteractive(command, { cwd: workDir });
    return result.output;
  } finally {
    tool.dispose();
  }
}

beforeEach(() => {
  environmentSnapshot = { ...process.env };
  delete process.env.NODE_OPTIONS;
  delete process.env.NODE_PATH;
  delete process.env.PYTHONPATH;
  workDir = mkdtempSync(join(tmpdir(), 'cb-interactive-env-injection-'));
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in environmentSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, environmentSnapshot);
  rmSync(workDir, { recursive: true, force: true });
});

describe('InteractiveBashTool — environnement des sous-processus', () => {
  it('conserve les variables nécessaires au terminal interactif', async () => {
    process.env.PATH = '/usr/bin:/bin';
    process.env.HOME = workDir;
    process.env.SHELL = '/bin/bash';
    process.env.LANG = 'C.UTF-8';

    const output = await runInteractive(
      'printf "%s\\n" "$PATH" "$HOME" "$SHELL" "$LANG" "$TERM"',
    );
    expect(output).toContain('/usr/bin:/bin');
    expect(output).toContain(workDir);
    expect(output).toContain('/bin/bash');
    expect(output).toContain('C.UTF-8');
    expect(output).toContain('xterm-256color');
  });

  it.each([false, true])('ne transmet pas NODE_OPTIONS à un vrai node enfant (%s)', async (forceFallback) => {
    const evilScript = join(workDir, 'evil.cjs');
    writeFileSync(evilScript, `process.stdout.write('${MARKER}\\n');\n`);
    process.env.NODE_OPTIONS = `--require ${evilScript}`;

    const control = spawnSync(process.execPath, ['-e', 'void 0'], {
      cwd: workDir,
      env: { ...process.env },
      encoding: 'utf8',
    });
    expect(combinedOutput(control)).toContain(MARKER);

    const output = await runInteractive(
      `${shellQuote(process.execPath)} -e "process.stdout.write('child ok\\n')"`,
      forceFallback,
    );
    expect(output).not.toContain(MARKER);
    expect(output).toContain('child ok');
  });

  it.each([false, true])('ne transmet pas NODE_PATH à un vrai node enfant (%s)', async (forceFallback) => {
    const evilModules = join(workDir, 'evil-modules');
    mkdirSync(evilModules);
    writeFileSync(join(evilModules, 'interactive-evil.cjs'), `process.stdout.write('${MARKER}\\n');\n`);
    process.env.NODE_PATH = evilModules;

    const control = spawnSync(
      process.execPath,
      ['-e', "require('interactive-evil.cjs')"],
      { cwd: workDir, env: { ...process.env }, encoding: 'utf8' },
    );
    expect(combinedOutput(control)).toContain(MARKER);

    const output = await runInteractive(
      `${shellQuote(process.execPath)} -e "try { require('interactive-evil.cjs') } catch {}"`,
      forceFallback,
    );
    expect(output).not.toContain(MARKER);
  });

  it.skipIf(!PYTHON).each([false, true])(
    'ne transmet pas PYTHONPATH à un vrai python enfant (%s)',
    async (forceFallback) => {
      const evilModules = join(workDir, 'evil-python-modules');
      const script = join(workDir, 'victim.py');
      mkdirSync(evilModules);
      writeFileSync(join(evilModules, 'json.py'), `print('${MARKER}')\n`);
      writeFileSync(script, 'import json\nprint("child ok")\n');
      process.env.PYTHONPATH = evilModules;

      const control = spawnSync(PYTHON as string, [script], {
        cwd: workDir,
        env: { ...process.env },
        encoding: 'utf8',
      });
      expect(combinedOutput(control)).toContain(MARKER);

      const output = await runInteractive(`${shellQuote(PYTHON as string)} ${shellQuote(script)}`, forceFallback);
      expect(output).not.toContain(MARKER);
      expect(output).toContain('child ok');
    },
  );
});
