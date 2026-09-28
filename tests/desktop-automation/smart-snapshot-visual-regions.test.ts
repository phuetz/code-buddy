/**
 * SmartSnapshotManager : un arbre d'accessibilité vide est complété par des
 * régions visuelles numérotées, seulement quand le drapeau l'autorise, et ces
 * régions restent adressables au-delà du TTL de 5 s du snapshot (un appel au
 * modèle dure plus longtemps) — le garde de signature vérifie l'écran au clic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/tools/screenshot-tool.js', () => ({
  ScreenshotTool: class {
    capture = vi.fn().mockResolvedValue({ success: true, data: { path: 'capture.png' } });
  },
}));

vi.mock('../../src/desktop-automation/visual-regions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/desktop-automation/visual-regions.js')>();
  return {
    ...actual,
    parseVisualRegions: vi.fn().mockResolvedValue({
      width: 1280,
      height: 800,
      raw: { width: 1280, height: 800, channels: 3, data: new Uint8Array(1280 * 800 * 3) },
      detectors: ['contours', 'ocr×3'],
      regions: [
        { id: 1, kind: 'text', label: 'Compteur : 0', bounds: { x: 228, y: 113, width: 84, height: 14 }, center: { x: 270, y: 120 }, source: 'ocr' },
        { id: 2, kind: 'control', label: 'Valider', bounds: { x: 257, y: 145, width: 62, height: 31 }, center: { x: 288, y: 161 }, source: 'contour' },
      ],
    }),
  };
});

import { SmartSnapshotManager } from '../../src/desktop-automation/smart-snapshot.js';

function managerWithEmptyTree(): SmartSnapshotManager {
  const m = new SmartSnapshotManager({ defaultTtl: 50 });
  const internals = m as unknown as {
    detectAccessibilityElements: () => Promise<unknown[]>;
    getScreenSize: () => Promise<{ width: number; height: number }>;
  };
  internals.detectAccessibilityElements = async () => [];
  internals.getScreenSize = async () => ({ width: 1280, height: 800 });
  return m;
}

describe("SmartSnapshotManager et régions visuelles", () => {
  beforeEach(() => {
    delete process.env.CODEBUDDY_VISION_GROUNDING;
    delete process.env.CODEBUDDY_VISUAL_REGIONS;
  });
  afterEach(() => {
    delete process.env.CODEBUDDY_VISION_GROUNDING;
    delete process.env.CODEBUDDY_VISUAL_REGIONS;
  });

  it('sans drapeau, un arbre vide reste vide (comportement historique)', async () => {
    const snap = await managerWithEmptyTree().takeSnapshot({ interactiveOnly: true });
    expect(snap.elements).toEqual([]);
  });

  it('avec l’ancrage visuel, un arbre vide devient une liste de régions numérotées', async () => {
    process.env.CODEBUDDY_VISION_GROUNDING = '1';
    const m = managerWithEmptyTree();
    const snap = await m.takeSnapshot({ interactiveOnly: true });
    expect(snap.elements.map((e) => [e.role, e.name, e.center])).toEqual([
      ['text', 'Compteur : 0', { x: 270, y: 120 }],
      ['button', 'Valider', { x: 288, y: 161 }],
    ]);
    expect(snap.elements[1]!.attributes).toMatchObject({
      source: 'visual-region',
      captureWidth: 1280,
      captureHeight: 800,
      detectors: ['contours', 'ocr×3'],
    });
    const text = m.toTextRepresentation(snap);
    expect(text).toContain('Valider center=(288,161)');
    expect(text).toContain('numbered regions cut from a screenshot');
  });

  it('une région reste adressable après le TTL du snapshot', async () => {
    process.env.CODEBUDDY_VISUAL_REGIONS = '1';
    const m = managerWithEmptyTree();
    const snap = await m.takeSnapshot({ interactiveOnly: true });
    const ref = snap.elements[1]!.ref;
    await new Promise((r) => setTimeout(r, 80));
    expect(m.getCurrentSnapshot()).toBeNull();
    expect(m.getElement(ref)?.name).toBe('Valider');
  });
});
