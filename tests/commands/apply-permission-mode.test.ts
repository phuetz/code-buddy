/**
 * Prouve que loop/goal APPLIQUENT la posture, pas seulement qu'ils exposent le
 * flag. Le rejeu adversarial du 25/08 avait montré qu'une mutation no-op de
 * setMode laissait les tests loop/goal verts : ils n'exerçaient jamais l'appel.
 * Ce test spy sur setMode et échoue si la posture n'est plus appliquée.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const setMode = vi.hoisted(() => vi.fn());

vi.mock('../../src/security/permission-modes.js', () => ({
  getPermissionModeManager: () => ({ setMode }),
}));

import { applyRequestedPermissionMode } from '../../src/commands/apply-permission-mode.js';

const frMessage = (mode: string, values: string) =>
  `Posture de permission inconnue : ${mode}. Valeurs : ${values}`;

afterEach(() => {
  setMode.mockReset();
});

describe('applyRequestedPermissionMode', () => {
  it('APPLIQUE la posture donnée en option de sous-commande', async () => {
    const applied = await applyRequestedPermissionMode(
      { permissionMode: 'acceptEdits' },
      undefined,
      frMessage,
    );
    expect(setMode).toHaveBeenCalledTimes(1);
    expect(setMode).toHaveBeenCalledWith('acceptEdits');
    expect(applied).toBe('acceptEdits');
  });

  it('lit la posture de l’option globale hissée quand la sous-commande n’en a pas', async () => {
    const command = { optsWithGlobals: () => ({ permissionMode: 'plan' }) };
    const applied = await applyRequestedPermissionMode({}, command, frMessage);
    expect(setMode).toHaveBeenCalledWith('plan');
    expect(applied).toBe('plan');
  });

  it('n’applique RIEN et retourne undefined quand aucune posture n’est demandée', async () => {
    const applied = await applyRequestedPermissionMode({}, undefined, frMessage);
    expect(setMode).not.toHaveBeenCalled();
    expect(applied).toBeUndefined();
  });

  it('rejette une posture inconnue AVANT tout appel à setMode, avec le libellé fourni', async () => {
    await expect(
      applyRequestedPermissionMode({ permissionMode: 'nimportequoi' }, undefined, frMessage),
    ).rejects.toThrow(
      'Posture de permission inconnue : nimportequoi. Valeurs : default, plan, acceptEdits, dontAsk, bypassPermissions',
    );
    expect(setMode).not.toHaveBeenCalled();
  });
});
