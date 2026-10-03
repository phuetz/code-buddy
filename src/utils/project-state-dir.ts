/**
 * Répertoire d'état projet `.codebuddy/` sans pollution de `git status`.
 *
 * Code Buddy écrit pendant et après une session des états locaux sous
 * `<projet>/.codebuddy/` (résultats d'outils restaurables, instantané de
 * contexte, HANDOFF.md de fin de session, métriques, candidats de leçons) —
 * plus de 300 sites d'écriture. Dans un dépôt qui n'ignore pas ce dossier, le
 * statut Git devient sale par le seul fait du harnais, même quand l'agent a
 * tout commité : la consigne « git status vide » d'une mission devient
 * impossible (constaté sur chaque rejeu de la mission C du banc harnais,
 * `?? .codebuddy/`, alors que le HANDOFF est écrit après le dernier tour).
 *
 * Quand Code Buddy CRÉE ce dossier à la racine d'un dépôt, il y dépose un
 * `.gitignore` contenant `*` (convention de `.pytest_cache`, `.ruff_cache`…) :
 * le dossier s'ignore lui-même, sans toucher au `.gitignore` du projet. Un
 * `.codebuddy/` déjà présent (éventuellement suivi par le projet) n'est jamais
 * modifié.
 */
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

export const SELF_IGNORE_CONTENT =
  '# Créé par Code Buddy : état local de session (résultats d\'outils, HANDOFF, métriques).\n' +
  '# Supprimez ce fichier pour suivre ce dossier dans Git.\n' +
  '*\n';

/**
 * Crée `<workDir>/.codebuddy/` auto-ignoré si `workDir` est la racine d'un
 * dépôt Git et que le dossier n'existe pas encore. Retourne `true` si créé.
 */
export function ensureSelfIgnoredProjectStateDir(workDir: string): boolean {
  try {
    if (!fs.existsSync(path.join(workDir, '.git'))) return false;
    const dir = path.join(workDir, '.codebuddy');
    if (fs.existsSync(dir)) return false;
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, '.gitignore'), SELF_IGNORE_CONTENT, { mode: 0o644, flag: 'wx' });
    return true;
  } catch (err) {
    logger.debug('[project-state-dir] self-ignored state dir not created', { workDir, err: String(err) });
    return false;
  }
}
