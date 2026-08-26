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
import { delimiter, join } from 'node:path';

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

function parseJsonOutput(output: string): Record<string, string> {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error(`Sortie JSON enfant introuvable dans : ${output}`);
  }
  return JSON.parse(output.slice(start, end + 1)) as Record<string, string>;
}

function normalizePortablePath(value: string): string {
  const withSlashes = value.replaceAll('\\', '/');
  return (process.platform === 'win32'
    ? withSlashes.replace(/(^|;)([A-Za-z]):\//g, '$1/$2/')
    : withSlashes
  ).toLowerCase();
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
    const pathMarker = join(workDir, 'path-marker');
    const envProbe = join(workDir, 'env-probe.cjs');
    process.env.PATH = [pathMarker, process.env.PATH].filter(Boolean).join(delimiter);
    process.env.HOME = workDir;
    process.env.SHELL = 'codebuddy-test-shell';
    process.env.LANG = 'C.UTF-8';
    writeFileSync(
      envProbe,
      `process.stdout.write(JSON.stringify({\n` +
        `  PATH: process.env.PATH,\n` +
        `  HOME: process.env.HOME,\n` +
        `  SHELL: process.env.SHELL,\n` +
        `  LANG: process.env.LANG,\n` +
        `  TERM: process.env.TERM,\n` +
        `}) + '\\n');\n`,
    );

    const environment = parseJsonOutput(
      await runInteractive(`${shellQuote(process.execPath)} ${shellQuote(envProbe)}`),
    );
    expect(normalizePortablePath(environment.PATH)).toContain(
      normalizePortablePath(pathMarker),
    );
    expect(environment.HOME).toBe(workDir);
    expect(environment.SHELL).toBe('codebuddy-test-shell');
    expect(environment.LANG).toBe('C.UTF-8');
    expect(environment.TERM).toBe('xterm-256color');
  });

  it.each([false, true])('ne transmet pas NODE_OPTIONS à un vrai node enfant (%s)', async (forceFallback) => {
    const evilScript = join(workDir, 'evil.cjs');
    const victimScript = join(workDir, 'node-options-victim.cjs');
    writeFileSync(evilScript, `process.stdout.write('${MARKER}\\n');\n`);
    writeFileSync(victimScript, `process.stdout.write('child ok\\n');\n`);
    process.env.NODE_OPTIONS = `--require ${evilScript}`;

    const control = spawnSync(process.execPath, ['-e', 'void 0'], {
      cwd: workDir,
      env: { ...process.env },
      encoding: 'utf8',
    });
    expect(combinedOutput(control)).toContain(MARKER);

    const output = await runInteractive(
      `${shellQuote(process.execPath)} ${shellQuote(victimScript)}`,
      forceFallback,
    );
    expect(output).not.toContain(MARKER);
    expect(output).toContain('child ok');
  });

  it.each([false, true])('ne transmet pas NODE_PATH à un vrai node enfant (%s)', async (forceFallback) => {
    const evilModules = join(workDir, 'evil-modules');
    const victimScript = join(workDir, 'node-path-victim.cjs');
    mkdirSync(evilModules);
    writeFileSync(join(evilModules, 'interactive-evil.cjs'), `process.stdout.write('${MARKER}\\n');\n`);
    writeFileSync(victimScript, "try { require('interactive-evil.cjs'); } catch {}\n");
    process.env.NODE_PATH = evilModules;

    const control = spawnSync(
      process.execPath,
      ['-e', "require('interactive-evil.cjs')"],
      { cwd: workDir, env: { ...process.env }, encoding: 'utf8' },
    );
    expect(combinedOutput(control)).toContain(MARKER);

    const output = await runInteractive(
      `${shellQuote(process.execPath)} ${shellQuote(victimScript)}`,
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
