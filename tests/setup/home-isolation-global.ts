/**
 * globalSetup de l'isolation du HOME (voir tests/setup/home-isolation.ts).
 *
 * S'exécute dans le processus principal de Vitest, avant la création des workers : il mémorise le
 * HOME appelant et crée le dossier parent de tous les HOME jetables de l'exécution. Les workers en
 * héritent par l'environnement. Le nettoyage se fait ici, une fois les workers terminés : un worker
 * forks est arrêté par SIGTERM (sans événement `exit`) et un fichier fini peut encore avoir des
 * écritures différées en vol, donc ni `afterAll` ni `process.on('exit')` ne conviennent.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default function setup(): () => void {
  process.env.CODEBUDDY_VITEST_CALLER_HOME ||= os.homedir();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-vitest-run-'));
  process.env.CODEBUDDY_VITEST_HOME_PARENT = parent;
  // tsx ouvre un socket Unix sous TMPDIR : le chemin appelant peut dépasser sun_path.
  const tmpBase = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  const tmpParent = fs.mkdtempSync(path.join(tmpBase, 'cb-vitest-tmp-'));
  process.env.CODEBUDDY_VITEST_TMP_PARENT = tmpParent;
  return () => {
    for (const directory of [parent, tmpParent]) {
      try {
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Handle encore ouvert (Windows) : aucun retour vers le HOME appelant.
      }
    }
  };
}
