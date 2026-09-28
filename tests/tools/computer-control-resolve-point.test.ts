/**
 * P3 — resolvePoint coordinate handling.
 *
 * The old auto-heuristic treated ANY x/y in 0-1000 as normalized and stretched
 * it to the screen, so a real pixel click at (500,400) on a 1920×1080 display
 * landed at (960,432). Now normalized scaling is EXPLICIT (input.normalized),
 * pixel coords pass through unchanged, and negatives are clamped to 0.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

jest.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: jest.fn().mockReturnValue({
    click: jest.fn(), doubleClick: jest.fn(), rightClick: jest.fn(), moveMouse: jest.fn(),
    drag: jest.fn(), scroll: jest.fn(), type: jest.fn(), pressKey: jest.fn(), hotkey: jest.fn(),
    getScreens: vi.fn().mockResolvedValue([
      { primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    ]),
  }),
  getPermissionManager: jest.fn().mockReturnValue({ check: jest.fn(), getInstructions: jest.fn() }),
  getSystemControl: jest.fn().mockReturnValue({}),
  getSmartSnapshotManager: jest.fn().mockReturnValue({ getElement: vi.fn() }),
  getScreenRecorder: jest.fn().mockReturnValue({}),
}));

import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';

type Pt = { x: number; y: number } | null;
async function resolve(tool: ComputerControlTool, input: Record<string, unknown>): Promise<Pt> {
  return (tool as unknown as { resolvePoint(i: Record<string, unknown>): Promise<Pt> }).resolvePoint(input);
}

describe('resolvePoint coordinate handling (P3)', () => {
  let tool: ComputerControlTool;
  beforeEach(() => {
    jest.clearAllMocks();
    tool = new ComputerControlTool();
  });

  it('passes real pixel coordinates through UNCHANGED (no auto-remap)', async () => {
    const pt = await resolve(tool, { action: 'click', x: 500, y: 400 });
    expect(pt).toEqual({ x: 500, y: 400 });
  });

  it('scales normalized coordinates only when normalized:true', async () => {
    const pt = await resolve(tool, { action: 'click', x: 500, y: 500, normalized: true });
    expect(pt).toEqual({ x: 960, y: 540 }); // 500/1000 * 1920 = 960, * 1080 = 540
  });

  it("clique la cible d'ancrage visuel (ref -999) même si le snapshot a expiré, une seule fois", async () => {
    (tool as unknown as { groundedVirtualElement: unknown }).groundedVirtualElement = {
      ref: -999,
      role: 'button',
      name: 'Valider',
      bounds: { x: 220, y: 158, width: 0, height: 0 },
      center: { x: 220, y: 158 },
      interactive: true,
      focused: false,
      enabled: true,
      visible: true,
      attributes: { source: 'visual-coordinates-grounding' },
    };
    // getElement (mock) rend undefined : c'est le cas du snapshot expiré.
    expect(await resolve(tool, { action: 'click', ref: -999 })).toEqual({ x: 220, y: 158 });
    // Consommée : un second clic sur -999 ne rejoue pas une cible périmée.
    expect(await resolve(tool, { action: 'click', ref: -999 })).toBeNull();
  });

  it('clamps negative coordinates to 0', async () => {
    const pt = await resolve(tool, { action: 'click', x: -50, y: -10 });
    expect(pt).toEqual({ x: 0, y: 0 });
  });
});
