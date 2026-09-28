/**
 * Régions visuelles numérotées — principe « parse_visual_regions » de Cua.
 *
 * Quand l'arbre d'accessibilité est vide (Avalonia 11 sous Linux, Canvas, Skia…),
 * demander au modèle de PRÉDIRE des pixels est fragile, surtout pour un petit
 * modèle. On découpe plutôt la capture en régions numérotées :
 *
 *   - boîtes de texte par OCR (tesseract, image agrandie ×3 : mesuré le
 *     28/09/2026, tesseract brut lit « mpteur / ider » sur une fenêtre Avalonia,
 *     et « Compteur : 0 / Valider » après agrandissement) ;
 *   - contrôles par détection de zones de couleur unie ou de cadres
 *     rectangulaires (heuristique sans dépendance, voir `detectControlBoxes`) ;
 *   - icônes et contrôles d'OmniParser seulement si un serveur est configuré
 *     (`OMNIPARSER_API_URL`), toujours en CLIENT HTTP : le code d'OmniParser
 *     est sous AGPL-3.0, il n'est ni embarqué ni copié ici.
 *
 * Le modèle choisit ensuite un NUMÉRO dans cette liste fermée ; l'action vise le
 * centre de la région choisie, bornée à la capture qui l'a produite.
 *
 * Les fonctions exportées sans effet de bord (analyse TSV, regroupement en
 * lignes, détection des contrôles, fusion, signature) sont testées sur des
 * données synthétiques ; `parseVisualRegions` assemble le tout sur un fichier.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface RawImage {
  width: number;
  height: number;
  /** 3 (RGB) ou 4 (RGBA). */
  channels: number;
  data: Uint8Array;
}

export interface RegionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type VisualRegionKind = 'control' | 'text' | 'icon';
export type VisualRegionSource = 'contour' | 'ocr' | 'omniparser';

export interface VisualRegion {
  /** Numéro présenté au modèle (1, 2, 3… dans l'ordre de lecture). */
  id: number;
  kind: VisualRegionKind;
  /** Texte lu dans la région (vide pour un contrôle sans texte). */
  label: string;
  bounds: RegionBox;
  center: { x: number; y: number };
  source: VisualRegionSource;
  confidence?: number;
}

export interface OcrWord extends RegionBox {
  text: string;
  conf: number;
}

export interface OcrLine {
  text: string;
  bounds: RegionBox;
  conf: number;
}

// ============================================================================
// OCR : analyse de la sortie TSV de tesseract
// ============================================================================

/**
 * Analyse la sortie `tesseract … tsv` d'une image agrandie `scale` fois et
 * ramène chaque mot dans les coordonnées de la capture d'origine.
 */
export function parseTesseractTsv(tsv: string, scale: number, minConf = 40): OcrWord[] {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const words: OcrWord[] = [];
  for (const line of tsv.split(/\r?\n/)) {
    const cols = line.split('\t');
    if (cols.length < 12 || cols[0] === 'level') continue;
    const text = (cols[11] ?? '').trim();
    const conf = Number(cols[10]);
    if (!text || !Number.isFinite(conf) || conf < minConf) continue;
    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const w = Number(cols[8]);
    const h = Number(cols[9]);
    if (![left, top, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    words.push({
      text,
      conf,
      x: Math.round(left / s),
      y: Math.round(top / s),
      width: Math.max(1, Math.round(w / s)),
      height: Math.max(1, Math.round(h / s)),
    });
  }
  return words;
}

/**
 * Regroupe des mots en lignes : même bande verticale et écart horizontal
 * inférieur à ~1,5 hauteur de ligne. Tesseract en mode « texte épars »
 * (`--psm 11`, le bon mode pour une interface) rend un mot par bloc ; sans ce
 * regroupement, « Compteur : 0 » deviendrait trois régions.
 */
export function groupWordsIntoLines(words: OcrWord[]): OcrLine[] {
  const sorted = [...words].sort((a, b) => a.x - b.x);
  const lines: { words: OcrWord[]; box: RegionBox }[] = [];
  for (const w of sorted) {
    const cy = w.y + w.height / 2;
    let target: { words: OcrWord[]; box: RegionBox } | undefined;
    for (const l of lines) {
      const lineTop = l.box.y;
      const lineBottom = l.box.y + l.box.height;
      const lineH = l.box.height;
      const gap = w.x - (l.box.x + l.box.width);
      // Un signe de ponctuation (« : ») a une boîte minuscule : on teste son
      // centre contre la bande de la ligne, pas l'inverse.
      const sameBand = cy >= lineTop - lineH * 0.25 && cy <= lineBottom + lineH * 0.25;
      if (sameBand && gap <= Math.max(lineH, w.height) * 1.5 && gap >= -lineH) {
        target = l;
        break;
      }
    }
    if (target) {
      target.words.push(w);
      const x1 = Math.min(target.box.x, w.x);
      const y1 = Math.min(target.box.y, w.y);
      const x2 = Math.max(target.box.x + target.box.width, w.x + w.width);
      const y2 = Math.max(target.box.y + target.box.height, w.y + w.height);
      target.box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    } else {
      lines.push({ words: [w], box: { x: w.x, y: w.y, width: w.width, height: w.height } });
    }
  }
  return lines
    .map((l) => ({
      text: l.words.map((w) => w.text).join(' '),
      bounds: l.box,
      conf: l.words.reduce((s, w) => s + w.conf, 0) / l.words.length,
    }))
    // Une « ligne » sans lettre ni chiffre (bruit, « : » isolé) n'est pas une cible.
    .filter((l) => /[\p{L}\p{N}]/u.test(l.text));
}

// ============================================================================
// Contrôles : zones de couleur unie et cadres rectangulaires
// ============================================================================

export interface ControlDetectionOptions {
  /** Écart maximal entre deux pixels voisins d'une même zone (somme RGB). */
  neighborTolerance?: number;
  /** Écart maximal avec le pixel d'origine de la zone (évite les dérives de dégradé). */
  seedTolerance?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Taux de remplissage minimal d'une zone pleine (pixels / aire de la boîte). */
  minFillRatio?: number;
}

interface Component {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
  edgeCount: number;
}

/**
 * Détecte les boîtes de contrôles probables : zones de couleur (quasi) unie de
 * taille « bouton » (un bouton plein), ou cadres rectangulaires fins (un
 * bouton ou un champ bordé). Les grandes zones (fond d'écran, fenêtre) sont
 * écartées par la taille ; une boîte qui en contient une autre plus petite est
 * un conteneur, elle est écartée aussi.
 *
 * C'est une heuristique volontairement simple, sans dépendance : elle suffit
 * aux thèmes plats (Fluent d'Avalonia, la plupart des applis métier) et ne
 * prétend pas remplacer un détecteur appris comme OmniParser.
 */
export function detectControlBoxes(img: RawImage, opts: ControlDetectionOptions = {}): RegionBox[] {
  const { width: W, height: H, channels: C, data } = img;
  if (W <= 0 || H <= 0 || data.length < W * H * C) return [];
  const nTol = opts.neighborTolerance ?? 18;
  const sTol = opts.seedTolerance ?? 36;
  const minW = opts.minWidth ?? 16;
  const minH = opts.minHeight ?? 12;
  const maxW = opts.maxWidth ?? Math.min(600, Math.floor(W * 0.6));
  const maxH = opts.maxHeight ?? 120;
  const minFill = opts.minFillRatio ?? 0.55;

  const labels = new Int32Array(W * H).fill(-1);
  const stack = new Int32Array(W * H);
  const comps: Component[] = [];
  const diff = (a: number, b: number): number =>
    Math.abs(data[a]! - data[b]!) + Math.abs(data[a + 1]! - data[b + 1]!) + Math.abs(data[a + 2]! - data[b + 2]!);

  for (let start = 0; start < W * H; start++) {
    if (labels[start] !== -1) continue;
    const id = comps.length;
    const seed = start * C;
    const comp: Component = { minX: W, minY: H, maxX: -1, maxY: -1, count: 0, edgeCount: 0 };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp > 0) {
      const p = stack[--sp]!;
      const x = p % W;
      const y = (p - x) / W;
      comp.count++;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      const pc = p * C;
      // 4-voisinage
      const neighbors = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of neighbors) {
        if (q < 0 || labels[q] !== -1) continue;
        const qc = q * C;
        if (diff(pc, qc) <= nTol && diff(seed, qc) <= sTol) {
          labels[q] = id;
          stack[sp++] = q;
        }
      }
    }
    comps.push(comp);
  }

  // Second passage : pixels de chaque zone situés à ≤ 2 px du bord de sa boîte
  // (sert à reconnaître un cadre creux).
  for (let p = 0; p < W * H; p++) {
    const c = comps[labels[p]!]!;
    const x = p % W;
    const y = (p - x) / W;
    if (x - c.minX <= 2 || c.maxX - x <= 2 || y - c.minY <= 2 || c.maxY - y <= 2) c.edgeCount++;
  }

  const candidates: RegionBox[] = [];
  for (const c of comps) {
    const w = c.maxX - c.minX + 1;
    const h = c.maxY - c.minY + 1;
    if (w < minW || h < minH || w > maxW || h > maxH) continue;
    if (w / h > 25) continue;
    // Une boîte qui touche le bord de la capture est un morceau de fond ou de barre, pas un contrôle.
    if (c.minX === 0 || c.minY === 0 || c.maxX === W - 1 || c.maxY === H - 1) continue;
    const fill = c.count / (w * h);
    const isFilled = fill >= minFill;
    const isOutline = !isFilled && c.edgeCount / c.count >= 0.9 && c.count >= 0.6 * (2 * w + 2 * h);
    if (isFilled || isOutline) candidates.push({ x: c.minX, y: c.minY, width: w, height: h });
  }

  return removeContainersAndDuplicates(candidates);
}

function contains(outer: RegionBox, inner: RegionBox, margin = 0): boolean {
  return (
    inner.x >= outer.x - margin &&
    inner.y >= outer.y - margin &&
    inner.x + inner.width <= outer.x + outer.width + margin &&
    inner.y + inner.height <= outer.y + outer.height + margin
  );
}

function area(b: RegionBox): number {
  return b.width * b.height;
}

/**
 * Deux boîtes presque identiques (le cadre d'un bouton et son intérieur) : on
 * garde l'extérieure. Une boîte qui contient une boîte nettement plus petite
 * est un conteneur : on l'écarte.
 */
function removeContainersAndDuplicates(boxes: RegionBox[]): RegionBox[] {
  const sorted = [...boxes].sort((a, b) => area(b) - area(a));
  const kept: RegionBox[] = [];
  for (const b of sorted) {
    const twin = kept.find((k) => contains(k, b, 1) && area(b) >= area(k) * 0.7);
    if (twin) continue;
    kept.push(b);
  }
  return kept.filter((outer) => !kept.some((inner) => inner !== outer && contains(outer, inner, 1) && area(inner) < area(outer) * 0.7));
}

// ============================================================================
// Fusion et numérotation
// ============================================================================

export interface IconBox extends RegionBox {
  label: string;
  source: VisualRegionSource;
}

/**
 * Fusionne contrôles, lignes de texte et (facultatif) éléments OmniParser en une
 * liste numérotée dans l'ordre de lecture. Le texte situé DANS un contrôle
 * devient son libellé (« Valider » est un bouton, pas un texte flottant).
 */
export function buildVisualRegions(controls: RegionBox[], lines: OcrLine[], extra: IconBox[] = []): VisualRegion[] {
  const consumed = new Set<number>();
  const drafts: Omit<VisualRegion, 'id'>[] = [];

  // Une « boîte de contrôle » entièrement couverte par une ligne de texte est un
  // glyphe épais, pas un contrôle.
  const realControls = controls.filter((c) => !lines.some((l) => contains(l.bounds, c, 2)));

  for (const c of realControls) {
    const inside: string[] = [];
    lines.forEach((l, i) => {
      const cx = l.bounds.x + l.bounds.width / 2;
      const cy = l.bounds.y + l.bounds.height / 2;
      if (cx >= c.x - 2 && cx <= c.x + c.width + 2 && cy >= c.y - 2 && cy <= c.y + c.height + 2) {
        inside.push(l.text);
        consumed.add(i);
      }
    });
    drafts.push({
      kind: 'control',
      label: inside.join(' '),
      bounds: c,
      center: { x: Math.round(c.x + c.width / 2), y: Math.round(c.y + c.height / 2) },
      source: 'contour',
    });
  }

  lines.forEach((l, i) => {
    if (consumed.has(i)) return;
    drafts.push({
      kind: 'text',
      label: l.text,
      bounds: l.bounds,
      center: { x: Math.round(l.bounds.x + l.bounds.width / 2), y: Math.round(l.bounds.y + l.bounds.height / 2) },
      source: 'ocr',
      confidence: Math.round(l.conf),
    });
  });

  for (const e of extra) {
    // Un élément OmniParser qui recouvre déjà une région n'ajoute rien.
    const duplicate = drafts.some((d) => contains(d.bounds, e, 4) && contains(e, d.bounds, 4));
    if (duplicate) continue;
    drafts.push({
      kind: 'icon',
      label: e.label,
      bounds: { x: e.x, y: e.y, width: e.width, height: e.height },
      center: { x: Math.round(e.x + e.width / 2), y: Math.round(e.y + e.height / 2) },
      source: e.source,
    });
  }

  // Ordre de lecture : par bandes de 10 px, puis de gauche à droite.
  drafts.sort((a, b) => {
    const band = Math.floor(a.center.y / 10) - Math.floor(b.center.y / 10);
    return band !== 0 ? band : a.center.x - b.center.x;
  });
  return drafts.map((d, i) => ({ id: i + 1, ...d }));
}

/** Présentation texte d'une région pour une liste fermée. */
export function describeRegion(r: VisualRegion): string {
  const kind = r.kind === 'control' ? 'contrôle' : r.kind === 'icon' ? 'icône' : 'texte';
  const label = r.label ? `"${r.label}"` : '(sans texte)';
  return `${kind} ${label} centre=(${r.center.x},${r.center.y}) taille=${r.bounds.width}x${r.bounds.height}`;
}

// ============================================================================
// Bornage à la capture et signature de région
// ============================================================================

/** Un point est-il DANS la capture qui a produit la région ? */
export function isPointInsideCapture(p: { x: number; y: number }, capture: { width: number; height: number }): boolean {
  return (
    Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x >= 0 && p.y >= 0 && p.x < capture.width && p.y < capture.height
  );
}

/**
 * Signature d'une région, robuste au survol : densité de contours (écart de
 * luminance entre voisins) sur une grille 8×4. Un bouton qui change de teinte
 * au passage de la souris garde ses contours ; une fenêtre déplacée ou un autre
 * contenu les change.
 */
export function regionSignature(img: RawImage, box: RegionBox, cols = 8, rows = 4): number[] {
  const { width: W, height: H, channels: C, data } = img;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(W, Math.ceil(box.x + box.width));
  const y1 = Math.min(H, Math.ceil(box.y + box.height));
  const sig = new Array<number>(cols * rows).fill(0);
  const counts = new Array<number>(cols * rows).fill(0);
  if (x1 - x0 < 2 || y1 - y0 < 2) return sig;
  const lum = (x: number, y: number): number => {
    const i = (y * W + x) * C;
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  };
  for (let y = y0; y < y1 - 1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      const l = lum(x, y);
      const edge = Math.abs(l - lum(x + 1, y)) > 40 || Math.abs(l - lum(x, y + 1)) > 40 ? 1 : 0;
      const cx = Math.min(cols - 1, Math.floor(((x - x0) / (x1 - x0)) * cols));
      const cy = Math.min(rows - 1, Math.floor(((y - y0) / (y1 - y0)) * rows));
      sig[cy * cols + cx]! += edge;
      counts[cy * cols + cx]! += 1;
    }
  }
  return sig.map((s, i) => (counts[i]! > 0 ? s / counts[i]! : 0));
}

/**
 * Dissimilarité de Bray-Curtis entre deux signatures : 0 = mêmes contours aux
 * mêmes endroits, 1 = aucun contour en commun. Deux régions sans contour sont
 * identiques (0).
 */
export function signatureDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let diff = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i]! - b[i]!);
    total += a[i]! + b[i]!;
  }
  return total === 0 ? 0 : diff / total;
}

/** Au-delà de ce seuil, la région a changé depuis la capture : on refuse d'agir. */
export const REGION_SIGNATURE_MAX_DISTANCE = 0.35;

// ============================================================================
// Assemblage sur un fichier image
// ============================================================================

export interface ParseVisualRegionsOptions {
  /** Facteur d'agrandissement avant OCR (défaut 3). */
  ocrScale?: number;
  /** Langues tesseract (défaut `OCR_LANGUAGE` ou « fra+eng »). */
  language?: string;
  /** Éléments OmniParser déjà obtenus (client HTTP), en pixels. */
  omniParserElements?: IconBox[];
  timeoutMs?: number;
}

export interface ParsedVisualRegions {
  regions: VisualRegion[];
  width: number;
  height: number;
  /** Image brute (RGB) de la capture, pour les signatures. */
  raw: RawImage;
  /** Détecteurs réellement exécutés (un détecteur absent n'est pas prétendu). */
  detectors: string[];
}

export async function loadRawImage(imagePath: string): Promise<RawImage> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels, data: new Uint8Array(data) };
}

async function runTesseractUpscaled(imagePath: string, scale: number, language: string, timeoutMs: number): Promise<OcrWord[]> {
  const sharp = (await import('sharp')).default;
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-regions-'));
  const upscaled = path.join(tmpDir, 'up.png');
  try {
    const meta = await sharp(imagePath).metadata();
    await sharp(imagePath)
      .resize({ width: Math.round((meta.width ?? 1) * scale), kernel: 'lanczos3' })
      .grayscale()
      .png()
      .toFile(upscaled);
    // Import paresseux : des suites de tests remplacent child_process sans execFile.
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { stdout } = await promisify(execFile)('tesseract', [upscaled, 'stdout', '-l', language, '--psm', '11', 'tsv'], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseTesseractTsv(stdout, scale);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Découpe une capture en régions numérotées. Ne lève jamais : un détecteur en
 * échec est simplement absent de `detectors`.
 */
export async function parseVisualRegions(imagePath: string, opts: ParseVisualRegionsOptions = {}): Promise<ParsedVisualRegions> {
  const raw = await loadRawImage(imagePath);
  const detectors: string[] = [];

  let controls: RegionBox[] = [];
  try {
    controls = detectControlBoxes(raw);
    detectors.push('contours');
  } catch (err) {
    logger.debug('Visual regions: control detection failed', { error: String(err) });
  }

  let lines: OcrLine[] = [];
  try {
    const words = await runTesseractUpscaled(
      imagePath,
      opts.ocrScale ?? 3,
      opts.language ?? process.env.OCR_LANGUAGE ?? 'fra+eng',
      opts.timeoutMs ?? 20_000,
    );
    lines = groupWordsIntoLines(words);
    detectors.push(`ocr×${opts.ocrScale ?? 3}`);
  } catch (err) {
    logger.debug('Visual regions: tesseract OCR failed', { error: String(err) });
  }

  if (opts.omniParserElements && opts.omniParserElements.length > 0) detectors.push('omniparser');

  const regions = buildVisualRegions(controls, lines, opts.omniParserElements ?? []);
  return { regions, width: raw.width, height: raw.height, raw, detectors };
}
