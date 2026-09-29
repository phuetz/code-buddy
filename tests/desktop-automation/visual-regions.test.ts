/**
 * Découpage d'une capture en régions numérotées (principe « parse_visual_regions »
 * de Cua), pour le computer use quand l'arbre d'accessibilité est vide.
 *
 * Les captures de `tests/fixtures/visual-regions/` sont de vraies captures Xvfb
 * (28/09/2026) d'une appli Avalonia 11.3, qui n'expose aucun arbre AT-SPI.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  buildVisualRegions,
  detectControlBoxes,
  groupWordsIntoLines,
  isPointInsideCapture,
  loadRawImage,
  parseTesseractTsv,
  parseVisualRegions,
  regionSignature,
  signatureDistance,
  REGION_SIGNATURE_MAX_DISTANCE,
  type RawImage,
  type RegionBox,
} from '../../src/desktop-automation/visual-regions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', 'fixtures', 'visual-regions');

function hasTesseract(): boolean {
  try {
    execFileSync('tesseract', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Image RGB unie, sur laquelle on peint des rectangles. */
function canvas(width: number, height: number, rgb: [number, number, number]): RawImage {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) data.set(rgb, i * 3);
  return { width, height, channels: 3, data };
}
function fill(img: RawImage, box: RegionBox, rgb: [number, number, number]): void {
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) img.data.set(rgb, (y * img.width + x) * 3);
  }
}
function frame(img: RawImage, box: RegionBox, rgb: [number, number, number]): void {
  fill(img, { x: box.x, y: box.y, width: box.width, height: 1 }, rgb);
  fill(img, { x: box.x, y: box.y + box.height - 1, width: box.width, height: 1 }, rgb);
  fill(img, { x: box.x, y: box.y, width: 1, height: box.height }, rgb);
  fill(img, { x: box.x + box.width - 1, y: box.y, width: 1, height: box.height }, rgb);
}

const TSV_HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

describe('parseTesseractTsv', () => {
  it("ramène les boîtes d'une image agrandie ×3 aux coordonnées de la capture", () => {
    // Sortie réelle de tesseract --psm 11 sur la capture Avalonia agrandie ×3.
    const tsv = [
      TSV_HEADER,
      '5\t1\t1\t1\t1\t1\t534\t333\t195\t41\t93.29\tCompteur',
      '5\t1\t2\t1\t1\t1\t591\t456\t135\t33\t96.40\tValider',
      '5\t1\t3\t1\t1\t1\t26\t26\t1268\t788\t12.00\tbruit',
      '5\t1\t4\t1\t1\t1\t10\t10\t30\t30\t95.00\t ',
    ].join('\n');
    expect(parseTesseractTsv(tsv, 3)).toEqual([
      { text: 'Compteur', conf: 93.29, x: 178, y: 111, width: 65, height: 14 },
      { text: 'Valider', conf: 96.4, x: 197, y: 152, width: 45, height: 11 },
    ]);
  });
});

describe('groupWordsIntoLines', () => {
  it('regroupe « Compteur », « : », « 0 » en une ligne et laisse « Valider » à part', () => {
    const words = parseTesseractTsv(
      [
        TSV_HEADER,
        '5\t1\t1\t1\t1\t1\t534\t333\t195\t41\t93\tCompteur',
        '5\t1\t2\t1\t1\t1\t745\t358\t3\t4\t92\t:',
        '5\t1\t3\t1\t1\t1\t766\t333\t19\t30\t93\t0',
        '5\t1\t4\t1\t1\t1\t591\t456\t135\t33\t96\tValider',
      ].join('\n'),
      3,
    );
    const lines = groupWordsIntoLines(words);
    expect(lines.map((l) => l.text)).toEqual(['Compteur : 0', 'Valider']);
    expect(lines[0]!.bounds).toEqual({ x: 178, y: 111, width: 83, height: 14 });
  });

  it("écarte une « ligne » faite seulement de ponctuation", () => {
    expect(groupWordsIntoLines([{ text: '|', conf: 90, x: 5, y: 5, width: 2, height: 10 }])).toEqual([]);
  });
});

describe('detectControlBoxes', () => {
  it('trouve un bouton plein dans une fenêtre, sans prendre la fenêtre ni le fond', () => {
    const img = canvas(640, 400, [0, 0, 0]);
    fill(img, { x: 10, y: 10, width: 420, height: 260 }, [255, 255, 255]);
    fill(img, { x: 189, y: 143, width: 62, height: 31 }, [204, 204, 204]);
    // « texte » sombre dans le bouton : des traits fins qui ne forment pas un contrôle
    fill(img, { x: 198, y: 152, width: 2, height: 11 }, [20, 20, 20]);
    fill(img, { x: 204, y: 152, width: 2, height: 11 }, [20, 20, 20]);
    expect(detectControlBoxes(img)).toEqual([{ x: 189, y: 143, width: 62, height: 31 }]);
  });

  it('reconnaît un bouton seulement bordé (intérieur de la couleur du fond)', () => {
    const img = canvas(400, 300, [0, 0, 0]);
    fill(img, { x: 10, y: 10, width: 380, height: 280 }, [255, 255, 255]);
    frame(img, { x: 100, y: 100, width: 80, height: 28 }, [120, 120, 120]);
    expect(detectControlBoxes(img)).toEqual([{ x: 100, y: 100, width: 80, height: 28 }]);
  });

  it('écarte un conteneur qui englobe des boutons', () => {
    const img = canvas(640, 400, [0, 0, 0]);
    fill(img, { x: 10, y: 10, width: 600, height: 300 }, [255, 255, 255]);
    fill(img, { x: 40, y: 40, width: 300, height: 100 }, [230, 230, 240]);
    fill(img, { x: 60, y: 60, width: 60, height: 30 }, [180, 180, 180]);
    fill(img, { x: 140, y: 60, width: 60, height: 30 }, [180, 180, 180]);
    const boxes = detectControlBoxes(img);
    expect(boxes).toHaveLength(2);
    expect(boxes).toEqual(
      expect.arrayContaining([
        { x: 60, y: 60, width: 60, height: 30 },
        { x: 140, y: 60, width: 60, height: 30 },
      ]),
    );
  });

  it('trouve les quatre boutons de la vraie capture Avalonia 11 (sans arbre AT-SPI)', async () => {
    const raw = await loadRawImage(path.join(fixtures, 'avalonia11-leurres.png'));
    const boxes = detectControlBoxes(raw).sort((a, b) => a.x - b.x);
    // Boutons Aide, Annuler, Valider, Réinitialiser mesurés sur la capture.
    expect(boxes.map((b) => Math.round(b.x + b.width / 2))).toEqual([137, 209, 288, 380]);
    expect(boxes.every((b) => b.height === 31)).toBe(true);
  });
});

describe('buildVisualRegions', () => {
  it('donne au contrôle le texte qu’il contient et numérote dans l’ordre de lecture', () => {
    const regions = buildVisualRegions(
      [
        { x: 250, y: 145, width: 70, height: 31 },
        { x: 170, y: 145, width: 70, height: 31 },
      ],
      [
        { text: 'Valider', bounds: { x: 265, y: 153, width: 40, height: 12 }, conf: 95 },
        { text: 'Annuler', bounds: { x: 185, y: 153, width: 40, height: 12 }, conf: 95 },
        { text: 'Compteur : 0', bounds: { x: 178, y: 111, width: 84, height: 14 }, conf: 93 },
      ],
    );
    expect(regions.map((r) => [r.id, r.kind, r.label])).toEqual([
      [1, 'text', 'Compteur : 0'],
      [2, 'control', 'Annuler'],
      [3, 'control', 'Valider'],
    ]);
    expect(regions[2]!.center).toEqual({ x: 285, y: 161 });
  });

  it("n'appelle pas « contrôle » un glyphe épais couvert par une ligne de texte", () => {
    const regions = buildVisualRegions(
      [{ x: 100, y: 100, width: 18, height: 14 }],
      [{ text: 'WW', bounds: { x: 98, y: 99, width: 40, height: 16 }, conf: 90 }],
    );
    expect(regions.map((r) => r.kind)).toEqual(['text']);
  });

  it('ajoute les éléments OmniParser qui ne recouvrent aucune région', () => {
    const regions = buildVisualRegions([], [], [
      { x: 10, y: 10, width: 24, height: 24, label: 'engrenage', source: 'omniparser' },
    ]);
    expect(regions).toEqual([
      expect.objectContaining({ id: 1, kind: 'icon', label: 'engrenage', source: 'omniparser', center: { x: 22, y: 22 } }),
    ]);
  });
});

describe('bornage et signature', () => {
  it('refuse un point hors de la capture', () => {
    expect(isPointInsideCapture({ x: 288, y: 161 }, { width: 1280, height: 800 })).toBe(true);
    expect(isPointInsideCapture({ x: 1280, y: 10 }, { width: 1280, height: 800 })).toBe(false);
    expect(isPointInsideCapture({ x: -1, y: 10 }, { width: 1280, height: 800 })).toBe(false);
    expect(isPointInsideCapture({ x: Number.NaN, y: 10 }, { width: 1280, height: 800 })).toBe(false);
  });

  it('tolère le survol (teinte du fond) mais pas un bouton disparu ou déplacé', () => {
    const box = { x: 20, y: 20, width: 62, height: 31 };
    const draw = (bg: [number, number, number], strokes: number[]): RawImage => {
      const img = canvas(120, 80, [255, 255, 255]);
      fill(img, box, bg);
      for (const sx of strokes) fill(img, { x: sx, y: 28, width: 2, height: 12 }, [10, 10, 10]);
      return img;
    };
    const base = regionSignature(draw([204, 204, 204], [30, 40, 50]), box);
    const hover = regionSignature(draw([224, 224, 224], [30, 40, 50]), box);
    const gone = regionSignature(canvas(120, 80, [255, 255, 255]), box);
    const moved = regionSignature(draw([204, 204, 204], [30, 40, 50]), { ...box, x: box.x + 12 });
    expect(signatureDistance(base, hover)).toBeLessThanOrEqual(REGION_SIGNATURE_MAX_DISTANCE);
    expect(signatureDistance(base, gone)).toBeGreaterThan(REGION_SIGNATURE_MAX_DISTANCE);
    expect(signatureDistance(base, moved)).toBeGreaterThan(REGION_SIGNATURE_MAX_DISTANCE);
  });
});

describe.skipIf(!hasTesseract())('parseVisualRegions sur une vraie capture (tesseract requis)', () => {
  it('rend « Compteur : 0 » et le bouton « Valider » au bon endroit', async () => {
    const parsed = await parseVisualRegions(path.join(fixtures, 'avalonia11-compteur.png'), { language: 'eng' });
    const valider = parsed.regions.find((r) => r.label === 'Valider');
    expect(valider).toMatchObject({ kind: 'control', source: 'contour' });
    // Centre réel du bouton mesuré au pixel près le 28/09 : (220, 158).
    expect(Math.abs(valider!.center.x - 220)).toBeLessThanOrEqual(2);
    expect(Math.abs(valider!.center.y - 158)).toBeLessThanOrEqual(2);
    expect(parsed.regions.some((r) => r.kind === 'text' && /Compteur\s*:\s*0/.test(r.label))).toBe(true);
    expect(parsed.detectors).toEqual(['contours', 'ocr×3']);
  });
});
