/**
 * Tours d'itération d'App Studio (après la première génération) — modèle pur.
 *
 * Trois écarts avec bolt.new se règlent ici, sans React ni IPC :
 * - **édition ciblée** : le message de l'utilisateur est enveloppé d'une
 *   consigne « modifie par `str_replace`, ne réécris pas les fichiers entiers,
 *   ne touche qu'aux fichiers nécessaires » (bolt.new annonce ~20 % de jetons
 *   en moins avec ses « diff based edits ») ;
 * - **fichiers verrouillés** : leur liste est rappelée au modèle, et
 *   `lockedPathsTouched` dit lesquels un tour a quand même modifiés (Cowork les
 *   remet ensuite dans leur état d'avant le tour : le verrou est appliqué,
 *   pas seulement demandé) ;
 * - **mode discussion** : on planifie sans rien écrire ; tout fichier modifié
 *   pendant un tour de discussion est lui aussi remis en l'état.
 *
 * @module renderer/components/studio/iteration-prompt
 */

export type IterationMode = 'build' | 'discuss';

export interface IterationOptions {
  lockedFiles?: readonly string[];
  mode?: IterationMode;
}

/** Message envoyé par « Implémenter ce plan » après un tour de discussion. */
export const IMPLEMENT_PLAN_PROMPT =
  'Implémente maintenant le plan que tu viens de proposer, étape par étape.';

function lockedBlock(locked: readonly string[]): string {
  if (locked.length === 0) return '';
  return [
    '',
    'Fichiers VERROUILLÉS — ne les modifie pas, ne les supprime pas, ne les renomme pas ' +
      '(toute modification sera annulée automatiquement) :',
    ...locked.map((p) => `- ${p}`),
  ].join('\n');
}

export function buildIterationPrompt(text: string, options: IterationOptions = {}): string {
  const request = text.trim();
  const locked = [...(options.lockedFiles ?? [])];
  if (options.mode === 'discuss') {
    return [
      '[App Studio — mode discussion]',
      "Ne modifie AUCUN fichier et n'exécute aucune commande dans ce tour : réfléchis avec moi.",
      'Lis les fichiers utiles si besoin, puis réponds en français : ce que tu comprends de la demande, ' +
        'les options avec leurs compromis, et un plan numéroté des fichiers à créer ou modifier.',
      "Termine en proposant de l'implémenter.",
      lockedBlock(locked),
      '',
      'Demande :',
      request,
    ]
      .filter((line) => line !== '')
      .join('\n');
  }
  return [
    '[App Studio — modification ciblée]',
    "L'application existe déjà. Applique la demande ci-dessous par des modifications CIBLÉES :",
    '- relis le fichier concerné puis modifie-le avec `str_replace` (ou `multi_edit`) sur le seul passage à changer ;',
    '- ne réécris pas un fichier entier qui existe déjà, ne régénère pas les fichiers non concernés ;',
    '- `create_file` seulement pour un fichier NOUVEAU ; déclare toute nouvelle dépendance dans package.json ;',
    "- n'exécute aucune commande (App Studio installe, relance et vérifie l'aperçu lui-même).",
    lockedBlock(locked),
    '',
    'Demande :',
    request,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Un chemin est couvert par un verrou exact, ou par un dossier verrouillé qui le contient. */
export function isPathLocked(filePath: string, locked: readonly string[]): boolean {
  const target = normalize(filePath);
  return locked.some((raw) => {
    const lock = normalize(raw);
    return lock !== '' && (target === lock || target.startsWith(`${lock}/`));
  });
}

/** Chemins modifiés par un tour qui tombent sous un verrou. */
export function lockedPathsTouched(changed: readonly string[], locked: readonly string[]): string[] {
  if (locked.length === 0) return [];
  return [...new Set(changed.map(normalize))].filter((p) => isPathLocked(p, locked)).sort();
}

/** Bascule un chemin dans la liste des verrous (ajout ou retrait), triée et sans doublon. */
export function toggleLock(locked: readonly string[], filePath: string): string[] {
  const target = normalize(filePath);
  const set = new Set(locked.map(normalize));
  if (set.has(target)) set.delete(target);
  else set.add(target);
  return [...set].filter(Boolean).sort();
}

/** Phrase courte pour la bande de build après une annulation de modifications interdites. */
export function revertNote(reverted: readonly string[], mode: IterationMode): string | null {
  if (reverted.length === 0) return null;
  const list = reverted.slice(0, 3).join(', ') + (reverted.length > 3 ? '…' : '');
  return mode === 'discuss'
    ? `Mode discussion : ${reverted.length} modification(s) annulée(s) (${list}).`
    : `Fichier(s) verrouillé(s) remis en l'état : ${list}.`;
}
