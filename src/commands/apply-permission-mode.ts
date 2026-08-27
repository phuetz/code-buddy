/**
 * Résolution + APPLICATION de la posture de permission pour les commandes qui
 * acceptent `--permission-mode` après la sous-commande (loop, goal).
 *
 * Extrait de loop-cli/goal-cli, qui dupliquaient ce bloc. Le point clé est que
 * la posture est réellement APPLIQUÉE (`setMode`), pas seulement reconnue : un
 * test qui vérifie la présence du flag sans exercer cet appel laisse passer un
 * correctif inerte (constat du rejeu adversarial du 25/08).
 */
export const PERMISSION_MODES = [
  'default',
  'plan',
  'acceptEdits',
  'dontAsk',
  'bypassPermissions',
] as const;

export type ResolvedPermissionMode = (typeof PERMISSION_MODES)[number];

interface CommandLike {
  optsWithGlobals?: () => { permissionMode?: string } | undefined;
}

/**
 * Lit la posture depuis les options de la sous-commande OU l'option globale
 * hissée, la valide, et l'applique au gestionnaire. Retourne la posture
 * appliquée (ou `undefined` si aucune n'était demandée). `invalidMessage`
 * préserve le libellé historique propre à chaque commande (FR pour loop,
 * EN pour goal).
 */
export async function applyRequestedPermissionMode(
  options: { permissionMode?: string },
  command: CommandLike | undefined,
  invalidMessage: (mode: string, values: string) => string,
): Promise<ResolvedPermissionMode | undefined> {
  const permissionMode = options.permissionMode ?? command?.optsWithGlobals?.()?.permissionMode;
  if (!permissionMode) return undefined;
  if (!PERMISSION_MODES.includes(permissionMode as ResolvedPermissionMode)) {
    throw new Error(invalidMessage(permissionMode, PERMISSION_MODES.join(', ')));
  }
  const { getPermissionModeManager } = await import('../security/permission-modes.js');
  getPermissionModeManager().setMode(permissionMode as ResolvedPermissionMode);
  return permissionMode as ResolvedPermissionMode;
}
