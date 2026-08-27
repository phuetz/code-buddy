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
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/balayage-installation.sh', import.meta.url));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'balayage-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Écrit un faux CLI node dont le comportement dépend des arguments. */
function fakeCli(body: string): string {
  const p = join(dir, 'fake-cli.js');
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
  try {
    // Fusionne stderr dans stdout : les messages de garde vont sur stderr.
    const stdout = execFileSync('bash', [SCRIPT], {
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

describe('balayage-installation.sh — gardes', () => {
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
    expect(status).toBe(0);
    expect(stdout).toMatch(/2\/2 commandes répondent/);
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
    expect(stdout).not.toMatch(/2\/2 commandes répondent/);
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
    expect(status).toBe(0);
    expect(stdout).toMatch(/2\/2 commandes répondent/);
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
