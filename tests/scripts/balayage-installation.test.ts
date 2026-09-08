/**
 * Le balayage d'installation est censé attraper les commandes qui plantent chez
 * un inconnu qui installe. Deux trous le rendaient AVEUGLE À SA PROPRE PANNE
 * (audit RAPPORT-DS-AUDIT) :
 *  - extraction vide → total=0 → « ✓ 0/0 commandes répondent », exit 0 (faux succès) ;
 *  - `timeout` sans `--kill-after` → un process qui ignore SIGTERM fait hangner le script.
 * Le point d'entrée est injecté via BALAYAGE_ENTREE pour exercer les gardes sans
 * build/pack/install réels.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { resolveBashExecutable } from '../../src/tools/interactive-bash.js';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/balayage-installation.sh', import.meta.url)).replaceAll('\\', '/');
const BASH = resolveBashExecutable();

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'balayage-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Écrit un faux CLI node dont le comportement dépend des arguments. */
function fakeCli(body: string): string {
  const p = join(dir, 'fake-cli.cjs');
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

function runBalayage(entree: string, extra: Record<string, string> = {}): {
  status: number;
  stdout: string;
} {
  const env = {
    ...process.env,
    BALAYAGE_ENTREE: entree,
    BALAYAGE_DIR: join(dir, 'work'),
    BALAYAGE_TIMEOUT: '3',
    ...extra,
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('BALAYAGE_')) {
      const values = env as Record<string, string | undefined>;
      values[key] = values[key]?.replaceAll('\\', '/');
    }
  }
  try {
    // Fusionne stderr dans stdout : les messages de garde vont sur stderr.
    const stdout = execFileSync(BASH, [SCRIPT], {
      env,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: err.status ?? -1,
      stdout: String(err.stdout ?? '') + String(err.stderr ?? ''),
    };
  }
}

function runRegenerer(
  sourceEntree: string,
  referencePath: string,
  extra: Record<string, string> = {},
  force = false,
): { status: number; stdout: string } {
  const env = {
    ...process.env,
    BALAYAGE_SOURCE_ENTREE: sourceEntree,
    BALAYAGE_REFERENCE: referencePath,
    BALAYAGE_TIMEOUT: '5',
    ...extra,
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('BALAYAGE_')) {
      const values = env as Record<string, string | undefined>;
      values[key] = values[key]?.replaceAll('\\', '/');
    }
  }
  const args = force ? [SCRIPT, '--regenerer', '--force'] : [SCRIPT, '--regenerer'];
  try {
    const stdout = execFileSync(BASH, args, {
      env,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { status: err.status ?? -1, stdout: String(err.stdout ?? '') + String(err.stderr ?? '') };
  }
}

describe('balayage-installation.sh — --regenerer (le chemin qui PRODUIT la référence)', () => {
  it('refuse d’écrire une référence vide depuis une source cassée (référence intacte)', () => {
    const source = fakeCli(`if (process.argv[2] === '--help') console.log('plus aucune commande');`);
    const ref = join(dir, 'ref.txt');
    writeFileSync(ref, 'alpha\nbeta\ngamma\n');
    const { status, stdout } = runRegenerer(source, ref);
    expect(status).not.toBe(0);
    expect(stdout).toMatch(/aucune commande|INCHANGÉE/i);
    // La référence existante n'a PAS été tronquée.
    expect(readFileSync(ref, 'utf8').trim().split(/\r?\n/).filter(Boolean)).toHaveLength(3);
  });

  it('refuse une chute brutale sans --force, en nommant les pertes (référence intacte)', () => {
    const source = fakeCli(`if (process.argv[2] === '--help') { console.log('  alpha  x'); }`);
    const ref = join(dir, 'ref.txt');
    writeFileSync(ref, 'alpha\nbeta\ngamma\n');
    const { status, stdout } = runRegenerer(source, ref);
    expect(status).not.toBe(0);
    expect(stdout).toMatch(/beta/);
    expect(stdout).toMatch(/gamma/);
    expect(readFileSync(ref, 'utf8').trim().split(/\r?\n/).filter(Boolean)).toHaveLength(3);
  });

  it('refuse une PERTE à compte constant (échange), pas seulement une chute d’amplitude', () => {
    // 5 → 5 mais delta/epsilon remplacés par zeta/eta : le décompte ne bouge pas,
    // pourtant deux commandes sortent de l'ancre. Une garde qui compte les rate.
    const source = fakeCli(
      `if (process.argv[2] === '--help') ['alpha','beta','gamma','zeta','eta'].forEach(c => console.log('  '+c+'  d'));`,
    );
    const ref = join(dir, 'ref.txt');
    writeFileSync(ref, 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
    const { status, stdout } = runRegenerer(source, ref);
    expect(status).not.toBe(0);
    expect(stdout).toMatch(/delta/);
    expect(stdout).toMatch(/epsilon/);
    // La référence n'a pas été écrasée : delta/epsilon toujours là.
    const apres = readFileSync(ref, 'utf8');
    expect(apres).toMatch(/delta/);
    expect(apres).toMatch(/epsilon/);
  });

  it('accepte une chute assumée avec --force', () => {
    const source = fakeCli(`if (process.argv[2] === '--help') { console.log('  alpha  x'); }`);
    const ref = join(dir, 'ref.txt');
    writeFileSync(ref, 'alpha\nbeta\ngamma\n');
    const { status, stdout } = runRegenerer(source, ref, {}, true);
    expect(status, stdout).toBe(0);
    expect(readFileSync(ref, 'utf8').trim().split(/\r?\n/).filter(Boolean)).toEqual(['alpha']);
  });

  it.each(['\n', '\r\n'])('accepte une croissance (ajouts) sans --force (%j)', (eol) => {
    const source = fakeCli(`if (process.argv[2] === '--help') { console.log('  alpha x'); console.log('  beta y'); console.log('  gamma z'); }`);
    const ref = join(dir, 'ref.txt');
    writeFileSync(ref, ['alpha', 'beta', ''].join(eol));
    const { status, stdout } = runRegenerer(source, ref);
    expect(status, stdout).toBe(0);
    expect(readFileSync(ref, 'utf8').trim().split(/\r?\n/).filter(Boolean)).toHaveLength(3);
  });
});

describe('balayage-installation.sh — gardes', () => {
  it('résout node avant env -i quand le PATH isolé ne contient pas node', () => {
    const isolatedPath = join(dir, 'path-sans-node');
    mkdirSync(isolatedPath);
    const expectedPath = JSON.stringify(isolatedPath);
    const cli = fakeCli(`
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        // Git Bash can pass /c/... to native Node instead of C:/....
        const canonical = value => require('node:fs').realpathSync.native(
          process.platform === 'win32' ? value.replace(/^\\/([a-z])\\//i, '$1:/') : value
        ).toLowerCase();
        if (canonical(process.env.PATH) !== canonical(${expectedPath})) process.exit(19);
        console.log('  alpha   ok');
      } else { process.exit(0); }
    `);
    const { status, stdout } = runBalayage(cli, { BALAYAGE_ISOLATED_PATH: isolatedPath });
    expect(status, stdout).toBe(0);
    expect(stdout).toMatch(/1\/\s*1\s+commandes répondent/);
  });

  it('fonctionne sans timeout dans le PATH isolé', () => {
    const isolatedPath = join(dir, 'path-sans-timeout');
    mkdirSync(isolatedPath);
    const cli = fakeCli(`
      const { spawnSync } = require('node:child_process');
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        // Windows may still find System32/timeout.exe despite an empty PATH.
        // Probe an explicitly absent path to avoid that implicit OS search.
        const probe = spawnSync(require('node:path').join(process.env.PATH, 'timeout'), ['--version'], { encoding: 'utf8' });
        if (probe.status === 0 || probe.error?.code !== 'ENOENT') process.exit(19);
        console.log('  alpha   ok');
      } else { process.exit(0); }
    `);
    const { status, stdout } = runBalayage(cli, { BALAYAGE_ISOLATED_PATH: isolatedPath });
    expect(status, stdout).toBe(0);
    expect(stdout).toMatch(/1\/\s*1\s+commandes répondent/);
  });

  it('une extraction vide N’EST PAS un succès (garde total>0)', () => {
    // --help ne liste aucune commande au motif attendu : le balayage n'a rien à tester.
    const cli = fakeCli(`console.log('Aucune commande au format attendu ici.');`);
    const { status, stdout } = runBalayage(cli);
    expect(status).not.toBe(0);
    expect(stdout).not.toMatch(/0\/0 commandes répondent/);
    expect(stdout).toMatch(/aucune commande/i);
  });

  it('balaie et réussit quand toutes les commandes répondent (exit 0)', () => {
    const cli = fakeCli(`
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        console.log('Usage: buddy [command]');
        console.log('  alpha   do alpha');
        console.log('  beta    do beta');
      } else {
        process.exit(0);
      }
    `);
    const { status, stdout } = runBalayage(cli);
    expect(status, stdout).toBe(0);
    expect(stdout).toMatch(/2\/\s*2\s+commandes répondent/);
  });

  it('signale une commande qui plante (exit 1)', () => {
    const cli = fakeCli(`
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        console.log('  alpha   ok');
        console.log('  beta    casse');
      } else if (arg === 'beta') {
        process.exit(7);
      } else {
        process.exit(0);
      }
    `);
    const { status, stdout } = runBalayage(cli);
    expect(status).toBe(1);
    expect(stdout).toMatch(/beta/);
  });

  it('une extraction PARTIELLE (moins de commandes qu’attendu) n’est pas un succès', () => {
    // Le --help ne liste que 2 commandes alors que 4 sont attendues (restructuration
    // partielle) : total>0 passe, mais la comparaison à l'attendu doit échouer.
    const attendu = join(dir, 'attendues.txt');
    writeFileSync(attendu, 'alpha\nbeta\ngamma\ndelta\n');
    const cli = fakeCli(`
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        console.log('  alpha   ok');
        console.log('  beta    ok');
      } else { process.exit(0); }
    `);
    const { status, stdout } = runBalayage(cli, { BALAYAGE_ATTENDU: attendu });
    expect(status).not.toBe(0);
    expect(stdout).toMatch(/gamma/);
    expect(stdout).toMatch(/delta/);
    expect(stdout).not.toMatch(/2\/\s*2\s+commandes répondent/);
  });

  it('compare les références CRLF aux commandes extraites', () => {
    const attendu = join(dir, 'reference-crlf.txt');
    writeFileSync(attendu, 'alpha\r\nbeta\r\n');
    const cli = fakeCli("console.log('  alpha  ok\\r\\n  beta  ok');");
    const { status, stdout } = runBalayage(cli, { BALAYAGE_ATTENDU: attendu });
    expect(status, stdout).toBe(0);
    expect(stdout).toMatch(/2\/\s*2\s+commandes répondent/);
  });

  it('accepte les comptes rembourrés de wc BSD', () => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const wc = join(bin, 'wc');
    writeFileSync(wc, '#!/usr/bin/env bash\nprintf "        "\nexec /usr/bin/wc "$@"\n');
    chmodSync(wc, 0o755);
    const cli = fakeCli("console.log('  alpha  ok\\n  beta  ok');");
    const { status, stdout } = runBalayage(cli, { PATH: [bin, process.env.PATH].join(delimiter) });
    expect(status, stdout).toBe(0);
    expect(stdout).toMatch(/2\/\s*2\s+commandes répondent/);
  });

  it('accepte quand toutes les commandes attendues sont présentes', () => {
    const attendu = join(dir, 'attendues.txt');
    writeFileSync(attendu, 'alpha\nbeta\n');
    const cli = fakeCli(`
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        console.log('  alpha   ok');
        console.log('  beta    ok');
      } else { process.exit(0); }
    `);
    const { status, stdout } = runBalayage(cli, { BALAYAGE_ATTENDU: attendu });
    expect(status, stdout).toBe(0);
    expect(stdout).toMatch(/2\/\s*2\s+commandes répondent/);
  });

  it('une référence ATTENDUE mais vide n’est pas sautée en silence (exploit du binôme)', () => {
    // Reproduction de la réfutation d'Opus : un attendu vide faisait sauter la
    // comparaison sans rien dire → « ✓ 3/3 » exit 0. La référence attendue mais
    // vide doit désormais échouer bruyamment.
    const vide = join(dir, 'attendu-vide.txt');
    writeFileSync(vide, '');
    const cli = fakeCli(`
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        console.log('  alpha   ok'); console.log('  beta    ok'); console.log('  gamma   ok');
      } else { process.exit(0); }
    `);
    const { status, stdout } = runBalayage(cli, { BALAYAGE_ATTENDU: vide });
    expect(status).not.toBe(0);
    expect(stdout).not.toMatch(/3\/\s*3\s+commandes répondent/);
    expect(stdout).toMatch(/référence.*(absente|vide)/i);
  });

  it('une référence figée plus longue que l’extraction est détectée (cécité de l’extracteur)', () => {
    // La référence connaît 5 commandes ; l'extracteur n'en lit plus que 2 (format
    // --help cassé). Une dérivation par le MÊME extracteur ne verrait rien ; la
    // référence figée, elle, expose le trou.
    const attendu = join(dir, 'reference-figee.txt');
    writeFileSync(attendu, 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
    const cli = fakeCli(`
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        // Format cassé : seules 2 lignes matchent encore le motif d'extraction.
        console.log('  alpha   ok');
        console.log('  beta    ok');
        console.log('COMMANDS: gamma, delta, epsilon (nouveau format non lu)');
      } else { process.exit(0); }
    `);
    const { status, stdout } = runBalayage(cli, { BALAYAGE_ATTENDU: attendu });
    expect(status).not.toBe(0);
    expect(stdout).toMatch(/gamma/);
    expect(stdout).toMatch(/epsilon/);
  });

  it('ne hangne PAS sur une commande qui ignore SIGTERM (--kill-after)', () => {
    // 'beta' ignore SIGTERM et boucle : sans --kill-after, timeout attend à l'infini.
    const cli = fakeCli(`
      const arg = process.argv[2];
      if (arg === '--help' || arg === undefined) {
        console.log('  alpha   ok');
        console.log('  beta    ignore SIGTERM');
      } else if (arg === 'beta') {
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1000);
      } else {
        process.exit(0);
      }
    `);
    // Le test lui-même impose 30s ; si le script hangne, execFileSync tue et status<0.
    const { status } = runBalayage(cli);
    // La commande beta dépasse le timeout → traitée comme fautive → exit 1, pas de hang.
    expect(status).toBe(1);
  });
});
