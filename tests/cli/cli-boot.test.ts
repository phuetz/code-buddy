import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const BOOT = path.join(ROOT, 'src', 'cli-boot.ts');
const INDEX = path.join(ROOT, 'src', 'index.ts');

function run(entry: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX, entry, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      NO_COLOR: '1',
      CODEBUDDY_DISABLE_MCP: 'true',
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('cli-boot', () => {
  it('prints the same version as the Commander program for --version and -V', () => {
    const viaBoot = run(BOOT, ['--version']);
    const viaFlag = run(BOOT, ['-V']);
    const viaIndex = run(INDEX, ['--version']);

    expect(viaBoot.status).toBe(0);
    expect(viaFlag.status).toBe(0);
    expect(viaIndex.status).toBe(0);
    expect(viaBoot.stdout).toBe(viaIndex.stdout);
    expect(viaFlag.stdout).toBe(viaIndex.stdout);
    expect(viaBoot.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('keeps whoami output identical when launched through the thin entry', () => {
    const viaBoot = run(BOOT, ['whoami']);
    const viaIndex = run(INDEX, ['whoami']);

    expect(viaBoot.status).toBe(viaIndex.status);
    expect(viaBoot.stdout).toBe(viaIndex.stdout);
  });

  /*
   * Les cas ci-dessus passent par tsx sur les sources. Or `package.json#bin`
   * pointe sur `dist/cli-boot.js` : c'est ce fichier-là que l'utilisateur
   * exécute. On le vérifie donc directement quand la construction est
   * présente, sans transpileur intermédiaire.
   */
  it('runs the built entry point named by package.json#bin', () => {
    const built = path.join(ROOT, 'dist', 'cli-boot.js');
    if (!existsSync(built)) {
      // Pas de dist : rien à vérifier ici, et surtout rien à revendiquer.
      return;
    }
    const result = spawnSync(process.execPath, [built, '--version'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1', CODEBUDDY_DISABLE_MCP: 'true' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
