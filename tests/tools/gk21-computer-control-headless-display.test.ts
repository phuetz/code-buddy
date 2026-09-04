/**
 * GK21 — computer_control ne doit jamais présenter un bureau qu'il n'a pas vu.
 *
 * Deux contrats, deux portées :
 *  - sans DISPLAY/WAYLAND, il ne doit pas parcourir l'arbre AT-SPI de la
 *    session (ce serait lorgner le bureau de l'opérateur). DISPLAY ne gouverne
 *    la pile d'accessibilité QUE sous X11/Wayland : sur macOS et Windows la
 *    variable ne veut rien dire et l'effacer ne prouve rien. Le scénario est
 *    donc adossé à une sonde de plate-forme réelle plutôt qu'appliqué en
 *    aveugle là où sa prémisse est fausse ;
 *  - PARTOUT, un instantané qui échoue doit rendre un no-op honnête et jamais
 *    l'arbre de démonstration codé en dur — le défaut réellement observé sur
 *    macOS, où osascript échoue sur un runner sans session Aqua et où le repli
 *    inventait cinq éléments (« OK », « Cancel », « Search »…).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';

describe('GK21 computer_control without a display', () => {
  let savedDisplay: string | undefined;
  let savedWayland: string | undefined;
  let savedOmni: string | undefined;

  beforeEach(() => {
    savedDisplay = process.env.DISPLAY;
    savedWayland = process.env.WAYLAND_DISPLAY;
    savedOmni = process.env.OMNIPARSER_API_URL;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    process.env.OMNIPARSER_API_URL = 'http://127.0.0.1:59991';
  });

  afterEach(() => {
    if (savedDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = savedDisplay;
    if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = savedWayland;
    if (savedOmni === undefined) delete process.env.OMNIPARSER_API_URL;
    else process.env.OMNIPARSER_API_URL = savedOmni;
  });

  it.runIf(process.platform === 'linux')('does not list session windows when DISPLAY is unset', async () => {
    const tool = new ComputerControlTool();
    const result = await tool.execute({ action: 'snapshot_with_screenshot' });
    expect(result.success, result.error).toBe(true);
    expect(result.output ?? '').not.toMatch(/Chromium Web Browser|Brave|Hide Panel/i);
    expect(result.output ?? '').toMatch(/no-op|DISPLAY|no display/i);
    const data = result.data as { elementCount?: number; screenshot?: string | null };
    expect(data.elementCount ?? 0).toBe(0);
    expect(data.screenshot == null || data.screenshot === '').toBe(true);
  }, 30_000);

  // Portée : POSIX. Le chemin Windows (UIAutomation) garde son repli
  // historique sur l'arbre de démonstration ; le corriger sort du périmètre de
  // cette réparation et n'a pas pu être vérifié sur un vrai runner Windows.
  it.runIf(process.platform !== 'win32')('ne présente jamais l’arbre de démonstration codé en dur', async () => {
    const tool = new ComputerControlTool();
    const result = await tool.execute({ action: 'snapshot_with_screenshot' });
    expect(result.success, result.error).toBe(true);
    // La signature exacte du faux bureau de smart-snapshot.ts. Un vrai
    // instantané peut évidemment contenir un bouton « OK » ; il ne contient
    // pas les cinq éléments inventés ensemble.
    const output = result.output ?? '';
    const fabricated = ['OK', 'Cancel', 'Search', 'Remember me', 'Forgot password?'];
    const present = fabricated.filter((name) => output.includes(name));
    expect(present, `arbre fabriqué détecté dans :\n${output}`).not.toEqual(fabricated);
  }, 30_000);
});
