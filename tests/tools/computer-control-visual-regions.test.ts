/**
 * Computer use quand l'arbre d'accessibilité est vide : les régions visuelles
 * numérotées deviennent la liste fermée de l'ancrage, l'action vise le centre
 * de la région choisie, bornée à sa capture, puis re-capture pour vérifier.
 *
 * Sur l'ancien code, un arbre vide envoyait l'ancrage en COORDONNÉES
 * (candidates: []) : ces tests y échouent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAutomation, mockSnapshotManager, state, regionEl } = vi.hoisted(() => {
  type El = {
    ref: number; role: string; name: string;
    bounds: { x: number; y: number; width: number; height: number };
    center: { x: number; y: number };
    interactive: boolean; focused: boolean; enabled: boolean; visible: boolean;
    attributes?: Record<string, unknown>;
  };
  const state: { snapshot: { elements: El[]; elementMap: Map<number, El>; screenSize: { width: number; height: number } } | null; regions: El[]; afterRegions: El[] } = {
    snapshot: null,
    regions: [],
    afterRegions: [],
  };
  const regionEl = (ref: number, role: string, name: string, cx: number, cy: number, extra: Record<string, unknown> = {}): El => ({
    ref, role, name,
    bounds: { x: cx - 30, y: cy - 15, width: 60, height: 30 },
    center: { x: cx, y: cy },
    interactive: true, focused: false, enabled: true, visible: true,
    attributes: { source: 'visual-region', captureWidth: 1280, captureHeight: 800, signature: [0.2, 0.1], ...extra },
  });
  const mockAutomation = {
    initialize: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    getScreens: vi.fn().mockResolvedValue([{ primary: true, bounds: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 1 }]),
    getScreenSize: vi.fn().mockResolvedValue({ width: 1280, height: 800 }),
  };
  const mockSnapshotManager = {
    takeSnapshot: vi.fn().mockImplementation(async () => state.snapshot),
    getCurrentSnapshot: vi.fn().mockImplementation(() => state.snapshot),
    getElement: vi.fn().mockImplementation((ref: number) =>
      state.snapshot?.elementMap.get(ref) ?? state.regions.find((r) => r.ref === ref)),
    toTextRepresentation: vi.fn(),
    findElements: vi.fn(),
    toAnnotatedScreenshot: vi.fn().mockResolvedValue({ image: 'aW1n' }),
    addVisualRegionsToSnapshot: vi.fn().mockImplementation(async () => {
      if (!state.snapshot) return [];
      for (const r of state.regions) {
        state.snapshot.elements.push(r);
        state.snapshot.elementMap.set(r.ref, r);
      }
      return state.regions;
    }),
    detectVisualRegionElements: vi.fn().mockImplementation(async () => state.afterRegions),
  };
  return { mockAutomation, mockSnapshotManager, state, regionEl };
});

vi.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: vi.fn().mockReturnValue(mockAutomation),
  getPermissionManager: vi.fn().mockReturnValue({ check: vi.fn(), getInstructions: vi.fn() }),
  getSystemControl: vi.fn().mockReturnValue({}),
  getSmartSnapshotManager: vi.fn().mockReturnValue(mockSnapshotManager),
  getScreenRecorder: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn(), getStatus: vi.fn() }),
}));

vi.mock('../../src/tools/screenshot-tool.js', () => ({
  ScreenshotTool: class {
    capture = vi.fn().mockResolvedValue({ success: true, data: { path: 'capture.png' } });
  },
}));

// La re-capture du garde : une image de la même taille, dont la signature au
// niveau de la région est celle de la capture d'origine (écran inchangé).
const { recapture } = vi.hoisted(() => ({ recapture: { width: 1280, height: 800, signature: [0.2, 0.1] as number[] } }));
vi.mock('../../src/desktop-automation/visual-regions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/desktop-automation/visual-regions.js')>();
  return {
    ...actual,
    loadRawImage: vi.fn().mockImplementation(async () => ({ width: recapture.width, height: recapture.height, channels: 3, data: new Uint8Array(3) })),
    regionSignature: vi.fn().mockImplementation(() => recapture.signature),
  };
});

import { ComputerControlTool, checkVisualRegionGuard, setVisionGroundingProvider } from '../../src/tools/computer-control-tool.js';

const ENV = ['CODEBUDDY_VISION_GROUNDING', 'CODEBUDDY_VISION_GROUNDING_COORDS', 'CODEBUDDY_VISUAL_REGIONS', 'CODEBUDDY_REAL_COMPUTER_USE'];

describe("computer use par régions visuelles (arbre d'accessibilité vide)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ENV) delete process.env[k];
    process.env.CODEBUDDY_VISION_GROUNDING = '1';
    state.snapshot = { elements: [], elementMap: new Map(), screenSize: { width: 1280, height: 800 } };
    state.regions = [
      regionEl(501, 'text', 'Compteur : 0', 270, 120),
      regionEl(502, 'button', 'Annuler', 209, 161),
      regionEl(503, 'button', 'Valider', 288, 161),
    ];
    state.afterRegions = [
      regionEl(601, 'text', 'Compteur : 1', 270, 120),
      regionEl(602, 'button', 'Annuler', 209, 161),
      regionEl(603, 'button', 'Valider', 288, 161),
    ];
    recapture.width = 1280;
    recapture.height = 800;
    recapture.signature = [0.2, 0.1];
  });
  afterEach(() => {
    setVisionGroundingProvider(null);
    for (const k of ENV) delete process.env[k];
  });

  it('présente les régions comme une liste fermée et clique au centre de la région choisie', async () => {
    const provider = vi.fn().mockResolvedValue(503);
    setVisionGroundingProvider(provider);

    const result = await new ComputerControlTool().execute({ action: 'click_button', name: 'le bouton qui confirme' });

    expect(result.success).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    const req = provider.mock.calls[0]![0];
    expect(req.candidates.map((c: { ref: number }) => c.ref)).toEqual([501, 502, 503]);
    expect(req.candidates[2]).toMatchObject({ name: 'Valider', center: { x: 288, y: 161 }, source: 'visual-region' });
    expect(mockAutomation.click).toHaveBeenCalledTimes(1);
    expect(mockAutomation.click).toHaveBeenCalledWith(288, 161, { button: 'left' });
  });

  it('re-capture après le clic et rend le texte apparu', async () => {
    setVisionGroundingProvider(vi.fn().mockResolvedValue(503));
    const tool = new ComputerControlTool() as unknown as { delay(ms: number): Promise<void> } & ComputerControlTool;
    tool.delay = async () => {};
    await tool.execute({ action: 'click_button', name: 'le bouton qui confirme' });
    // clickNamedRole résume l'élément ; le détail de la re-capture est dans click()
    const direct = await tool.execute({ action: 'click', ref: 503 });
    expect(direct.success).toBe(true);
    expect(direct.output).toContain('Compteur : 1');
    expect(direct.output).toMatch(/appeared \["Compteur : 1"\]/);
    expect(mockSnapshotManager.detectVisualRegionElements).toHaveBeenCalled();
  });

  it('trouve la région par son nom sans appeler le modèle', async () => {
    const provider = vi.fn();
    setVisionGroundingProvider(provider);
    const result = await new ComputerControlTool().execute({ action: 'click_button', name: 'Valider' });
    expect(result.success).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    expect(mockAutomation.click).toHaveBeenCalledWith(288, 161, { button: 'left' });
  });

  it("n'accepte pas un numéro absent de la liste", async () => {
    setVisionGroundingProvider(vi.fn().mockResolvedValue(220));
    const result = await new ComputerControlTool().execute({ action: 'click_button', name: 'le bouton qui confirme' });
    expect(result.success).toBe(false);
    expect(mockAutomation.click).not.toHaveBeenCalled();
  });

  it('refuse de cliquer si la région a changé depuis la capture', async () => {
    setVisionGroundingProvider(vi.fn().mockResolvedValue(503));
    recapture.signature = [0, 0.9];
    const result = await new ComputerControlTool().execute({ action: 'click_button', name: 'le bouton qui confirme' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/screen changed/i);
    expect(mockAutomation.click).not.toHaveBeenCalled();
  });

  it("sans régions ni drapeau coordonnées, ne demande pas de pixels au modèle", async () => {
    state.regions = [];
    const provider = vi.fn().mockResolvedValue({ x: 500, y: 500 });
    setVisionGroundingProvider(provider);
    const result = await new ComputerControlTool().execute({ action: 'click_button', name: 'Valider' });
    expect(result.success).toBe(false);
    expect(provider).not.toHaveBeenCalled();
    expect(mockAutomation.click).not.toHaveBeenCalled();
  });

  it('garde le repli en coordonnées derrière CODEBUDDY_VISION_GROUNDING_COORDS=1', async () => {
    state.regions = [];
    process.env.CODEBUDDY_VISION_GROUNDING_COORDS = '1';
    const provider = vi.fn().mockResolvedValue({ x: 500, y: 500 });
    setVisionGroundingProvider(provider);
    const result = await new ComputerControlTool().execute({ action: 'click_button', name: 'Valider' });
    expect(result.success).toBe(true);
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ candidates: [] }));
    expect(mockAutomation.click).toHaveBeenCalledWith(640, 400, { button: 'left' });
  });

  it('CODEBUDDY_VISUAL_REGIONS=0 coupe les régions', async () => {
    process.env.CODEBUDDY_VISUAL_REGIONS = '0';
    setVisionGroundingProvider(vi.fn().mockResolvedValue(503));
    const result = await new ComputerControlTool().execute({ action: 'click_button', name: 'Valider' });
    expect(result.success).toBe(false);
    expect(mockSnapshotManager.addVisualRegionsToSnapshot).not.toHaveBeenCalled();
  });
});

describe('checkVisualRegionGuard', () => {
  const el = {
    center: { x: 288, y: 161 },
    bounds: { x: 258, y: 146, width: 60, height: 30 },
    attributes: { captureWidth: 1280, captureHeight: 800, signature: [0.2, 0.1] },
  };
  it('accepte une région inchangée', () => {
    expect(checkVisualRegionGuard(el, { width: 1280, height: 800, signature: [0.2, 0.1] })).toBeNull();
  });
  it('refuse un centre hors de la capture', () => {
    expect(checkVisualRegionGuard({ ...el, center: { x: 1300, y: 10 } }, { width: 1280, height: 800, signature: [0.2, 0.1] }))
      .toMatch(/outside/);
  });
  it("refuse si la taille d'écran a changé ou si la re-capture manque", () => {
    expect(checkVisualRegionGuard(el, { width: 1920, height: 1080, signature: [0.2, 0.1] })).toMatch(/size changed/);
    expect(checkVisualRegionGuard(el, null)).toMatch(/re-capture/);
  });
});
