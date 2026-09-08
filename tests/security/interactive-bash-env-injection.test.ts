/**
 * Régression de sécurité — le shell interactif ne doit pas transmettre les
 * variables d'environnement qui permettent de détourner un interpréteur.
 *
 * Les scénarios lancent le vrai `InteractiveBashTool`, qui lance ensuite un
 * vrai shell enfant (PTY ou repli `exec`), et vérifient qu'un marqueur injecté
 * par le processus enfant n'apparaît plus.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { getShellConfiguration, type ShellConfiguration } from '../../src/utils/shell-configuration.js';
import type { PTYModule } from '../../src/tools/interactive-bash.js';
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

function posixShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

function powershellShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

interface ShellFixture {
  quote(value: string): string;
}

const POSIX_FIXTURE: ShellFixture = { quote: posixShellQuote };
const POWERSHELL_FIXTURE: ShellFixture = { quote: powershellShellQuote };

function fixtureForShell(configuration: ShellConfiguration = getShellConfiguration()): ShellFixture {
  return configuration.shell === 'powershell' ? POWERSHELL_FIXTURE : POSIX_FIXTURE;
}

function commandForExecutable(
  executable: string,
  script: string,
  configuration: ShellConfiguration = getShellConfiguration(),
): string {
  const fixture = fixtureForShell(configuration);
  return `${configuration.shell === 'powershell' ? '& ' : ''}${fixture.quote(executable)} ${fixture.quote(script)}`;
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

async function runInteractive(command: string, backend: boolean | 'spawn-failure' = false): Promise<string> {
  const tool = backend === 'spawn-failure'
    ? new InteractiveBashTool({ spawn() { throw new Error('posix_spawnp failed'); } })
    : backend ? new InteractiveBashTool(null) : new InteractiveBashTool();
  try {
    const result = await tool.executeInteractive(command, { cwd: workDir });
    return stripVTControlCharacters(result.output);
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
  rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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
      await runInteractive(commandForExecutable(process.execPath, envProbe)),
    );
    expect(normalizePortablePath(environment.PATH)).toContain(
      normalizePortablePath(pathMarker),
    );
    expect(environment.HOME).toBe(workDir);
    expect(environment.SHELL).toBe('codebuddy-test-shell');
    expect(environment.LANG).toBe('C.UTF-8');
    expect(environment.TERM).toBe('xterm-256color');
  });

  it.each([false, true, 'spawn-failure'] as const)('ne transmet pas NODE_OPTIONS à un vrai node enfant (%s)', async (forceFallback) => {
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
      commandForExecutable(process.execPath, victimScript),
      forceFallback,
    );
    expect(output).not.toContain(MARKER);
    expect(output).toContain('child ok');
  });

  it.each([false, true, 'spawn-failure'] as const)('ne transmet pas NODE_PATH à un vrai node enfant (%s)', async (forceFallback) => {
    const evilModules = join(workDir, 'evil-modules');
    const victimScript = join(workDir, 'node-path-victim.cjs');
    mkdirSync(evilModules);
    writeFileSync(join(evilModules, 'interactive-evil.cjs'), `process.stdout.write('${MARKER}\\n');\n`);
    writeFileSync(victimScript, "try { require('interactive-evil.cjs'); } catch {}\nprocess.stdout.write('child ok\\n');\n");
    process.env.NODE_PATH = evilModules;

    const control = spawnSync(
      process.execPath,
      ['-e', "require('interactive-evil.cjs')"],
      { cwd: workDir, env: { ...process.env }, encoding: 'utf8' },
    );
    expect(combinedOutput(control)).toContain(MARKER);

    const output = await runInteractive(
      commandForExecutable(process.execPath, victimScript),
      forceFallback,
    );
    expect(output).not.toContain(MARKER);
    expect(output).toContain('child ok');
  });

  it.skipIf(!PYTHON).each([false, true, 'spawn-failure'] as const)(
    'ne transmet pas PYTHONPATH à un vrai python enfant (%s ; sauté si Python absent)',
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

      const output = await runInteractive(
        commandForExecutable(PYTHON as string, script),
        forceFallback,
      );
      expect(output).not.toContain(MARKER);
      expect(output).toContain('child ok');
    },
  );

  it.each([null, { spawn() { throw new Error('posix_spawnp failed'); } }])(
    'préserve cwd et les overrides sûrs sans PTY (%s)',
    async (backend) => {
      const script = join(workDir, 'cwd-probe.cjs');
      writeFileSync(script, "process.stdout.write(JSON.stringify({ cwd: process.cwd(), LANG: process.env.LANG, NODE_OPTIONS: process.env.NODE_OPTIONS }));");
      const tool = new InteractiveBashTool(backend);
      try {
        const result = await tool.executeInteractive(commandForExecutable(process.execPath, script), {
          cwd: workDir,
          env: { LANG: 'C', NODE_OPTIONS: '--require missing-injection.cjs' },
        });
        expect(parseJsonOutput(result.output)).toEqual({ cwd: workDir, LANG: 'C' });
        expect(result.sessionId).toMatch(/^exec-/);
        expect(tool.isPTYSupported()).toBe(false);
      } finally {
        tool.dispose();
      }
    },
  );

  it('exerce la fixture PowerShell quand getShellConfiguration() est mockée en win32', async () => {
    const powerShellConfiguration: ShellConfiguration = {
      executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      argsPrefix: ['-NoProfile', '-NonInteractive', '-Command'],
      shell: 'powershell',
    };
    const getShellConfigurationMock = vi.fn(() => powerShellConfiguration);
    const spawnCalls: Array<{
      executable: string;
      args: string[];
      env: Record<string, string | undefined>;
    }> = [];

    vi.resetModules();
    vi.doMock('../../src/utils/shell-configuration.js', () => ({
      getShellConfiguration: getShellConfigurationMock,
    }));

    try {
      const { InteractiveBashTool: MockedInteractiveBashTool } =
        await import('../../src/tools/interactive-bash.js');
      const fakePty: PTYModule = {
        spawn(executable, args, options) {
          spawnCalls.push({ executable, args, env: options.env });
          return {
            onData(callback) {
              callback(options.env.NODE_OPTIONS ? `${MARKER}\n` : '\x1b[?25l\x1b[32mchild ok\x1b[0m\r\n');
            },
            onExit(callback) {
              queueMicrotask(() => callback({ exitCode: 0 }));
            },
            write() {},
            resize() {},
            kill() {},
          };
        },
      };
      const victimScript = join(workDir, 'powershell-fixture-victim.cjs');
      const evilScript = join(workDir, 'powershell-fixture-evil.cjs');
      writeFileSync(evilScript, `process.stdout.write('${MARKER}\\n');\n`);
      writeFileSync(victimScript, "process.stdout.write('child ok\\n');\n");
      process.env.NODE_OPTIONS = `--require ${evilScript}`;
      const configuration = getShellConfigurationMock();
      const command = commandForExecutable(process.execPath, victimScript, configuration);
      expect(
        commandForExecutable(
          "C:\\Program Files\\O'Brien\\node.exe",
          "C:\\work\\victim's.cjs",
          configuration,
        ),
      ).toBe("& 'C:\\Program Files\\O''Brien\\node.exe' 'C:\\work\\victim''s.cjs'");
      const tool = new MockedInteractiveBashTool(fakePty);
      const result = await tool.executeInteractive(command, { cwd: workDir });
      tool.dispose();

      expect(getShellConfigurationMock).toHaveBeenCalled();
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.executable).toBe(powerShellConfiguration.executable);
      expect(spawnCalls[0]?.args).toEqual([
        ...powerShellConfiguration.argsPrefix,
        command,
      ]);
      expect(spawnCalls[0]?.env.NODE_OPTIONS).toBeUndefined();
      // Même contrat de sécurité que les deux scénarios réels ci-dessus : le
      // marqueur injecté ne doit jamais atteindre la sortie de la session.
      expect(result.output).not.toContain(MARKER);
      expect(stripVTControlCharacters(result.output)).toContain('child ok');
    } finally {
      vi.doUnmock('../../src/utils/shell-configuration.js');
      vi.resetModules();
    }
  });
});
