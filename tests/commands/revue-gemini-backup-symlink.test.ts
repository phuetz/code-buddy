import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleBackup } from '../../src/commands/handlers/backup-handlers.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

describe('Revue G6 - Trou 5 : Archive de sauvegarde qui écrit ailleurs via symlink', () => {
  let workspace: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = makeTmpDir('revue-g6-backup-', path.join(previousCwd, 'tmp'));
    process.chdir(workspace);
    fs.mkdirSync(path.join(workspace, '.codebuddy'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(previousCwd);
    removeTmpDir(workspace);
  });

  it('doit refuser d’écrire à travers un symlink pointant hors du répertoire de destination', async () => {
    // Un fichier cible externe (par ex. ~/.bashrc ou un fichier hors projet)
    const outsideTarget = path.join(workspace, 'victim-outside.txt');
    fs.writeFileSync(outsideTarget, 'ORIGINAL_SECRET_DATA');

    // Dans .codebuddy, settings.json est un lien symbolique vers la cible externe
    const linkPath = path.join(workspace, '.codebuddy', 'settings.json');
    fs.symlinkSync(outsideTarget, linkPath);

    // Préparation d'une archive contenant settings.json
    const payload = Buffer.from('PWNED_DATA_OVERWRITTEN');
    const checksum = createHash('sha256').update(payload).digest('hex').slice(0, 16);
    const archivePath = path.join(workspace, 'backup-payload.json');
    fs.writeFileSync(
      archivePath,
      JSON.stringify({
        manifest: {
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          files: [{ path: 'settings.json', size: payload.length, checksum }],
          flags: { onlyConfig: true, includeWorkspace: false },
        },
        files: [{ path: 'settings.json', content: payload.toString('base64') }],
      }),
    );

    // Exécution de la restauration
    const result = await handleBackup(`restore ${archivePath} --confirm`);

    // VULNÉRABILITÉ : isInsideDestRoot ne fait qu'une vérification textuelle (path.relative).
    // writeFileSync suit le symlink et écrase outsideTarget !
    // Le test exige que la restauration échoue ou refuse d'écraser un fichier hors destRoot via symlink.
    expect(result.exitCode).toBe(1);
    expect(fs.readFileSync(outsideTarget, 'utf8')).toBe('ORIGINAL_SECRET_DATA');
  });
});
