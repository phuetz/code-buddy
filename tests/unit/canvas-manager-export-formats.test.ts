/**
 * Canvas manager export format tests.
 */

import { CanvasManager } from '../../src/canvas/canvas-manager.js';

describe('CanvasManager export formats', () => {
  let manager: CanvasManager;
  let canvasId: string;

  beforeEach(() => {
    manager = new CanvasManager();
    const canvas = manager.createCanvas({
      name: 'Export Test',
      width: 800,
      height: 600,
      showGrid: false,
      snapToGrid: false,
    });
    canvasId = canvas.id;

    manager.addElement(canvasId, {
      type: 'text',
      position: { x: 40, y: 30 },
      size: { width: 260, height: 80 },
      locked: false,
      visible: true,
      label: 'Title',
      content: { text: 'Canvas Export Smoke Test' },
    });
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('exports PNG buffer', async () => {
    const exported = await manager.export(canvasId, { format: 'png' });

    expect(Buffer.isBuffer(exported)).toBe(true);
    const png = exported as Buffer;
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(png.length).toBeGreaterThan(8);
    expect(png.subarray(0, 8).equals(pngSignature)).toBe(true);
  });

  it('exports PDF buffer', async () => {
    const exported = await manager.export(canvasId, { format: 'pdf' });

    expect(Buffer.isBuffer(exported)).toBe(true);
    const pdf = exported as Buffer;
    expect(pdf.length).toBeGreaterThan(16);
    expect(pdf.toString('utf8', 0, 8)).toContain('%PDF-');
  });
});
