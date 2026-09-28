/**
 * Garde de get_active_window sous Linux : sans _NET_ACTIVE_WINDOW, libnut fait
 * tuer le processus par Xlib (BadDrawable sur X_GetGeometry, mesuré sous Xvfb
 * le 28/09/2026). On ne l'interroge que si xprop montre une vraie fenêtre active.
 */
import { describe, expect, it } from 'vitest';
import { xpropShowsActiveWindow } from '../../src/desktop-automation/nutjs-provider.js';

describe('xpropShowsActiveWindow', () => {
  it('refuse un serveur X sans gestionnaire de fenêtres (sortie réelle de Xvfb nu)', () => {
    expect(xpropShowsActiveWindow('_NET_ACTIVE_WINDOW:  no such atom on any window.\n')).toBe(false);
  });

  it('refuse une fenêtre active nulle', () => {
    expect(xpropShowsActiveWindow('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0\n')).toBe(false);
  });

  it('accepte une vraie fenêtre active', () => {
    expect(xpropShowsActiveWindow('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x2a00007\n')).toBe(true);
  });

  it('refuse une sortie vide ou inattendue', () => {
    expect(xpropShowsActiveWindow('')).toBe(false);
    expect(xpropShowsActiveWindow('xprop: unable to open display\n')).toBe(false);
  });
});
