/**
 * Snap extracted Figma values onto the Code Buddy design-system token spine
 * (assets/design-systems/<id>/tokens.css: --bg, --fg, --space-N, --text-*).
 */

import type { FigmaColor } from './types.js';

export const SPACE_SCALE: ReadonlyArray<{ token: string; px: number }> = [
  { token: 'space-1', px: 4 },
  { token: 'space-2', px: 8 },
  { token: 'space-3', px: 12 },
  { token: 'space-4', px: 16 },
  { token: 'space-5', px: 20 },
  { token: 'space-6', px: 24 },
  { token: 'space-8', px: 32 },
  { token: 'space-12', px: 48 },
];

export const TEXT_SCALE: ReadonlyArray<{ token: string; px: number }> = [
  { token: 'text-xs', px: 12 },
  { token: 'text-sm', px: 16 },
  { token: 'text-base', px: 16 },
  { token: 'text-lg', px: 20 },
  { token: 'text-xl', px: 26 },
  { token: 'text-3xl', px: 64 },
  { token: 'text-4xl', px: 86 },
];

/** Canonical brand tokens used by every vendored design system. */
export const COLOR_TOKENS: ReadonlyArray<{ token: string; hex: string }> = [
  { token: 'bg', hex: '#ffffff' },
  { token: 'surface', hex: '#ffffff' },
  { token: 'fg', hex: '#000000' },
  { token: 'accent', hex: '#000000' },
  { token: 'muted', hex: '#8c8c8c' },
  { token: 'success', hex: '#16a34a' },
  { token: 'warn', hex: '#eab308' },
  { token: 'danger', hex: '#dc2626' },
];

const COLOR_SNAP_MAX = 28;

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function figmaRgbToHex(r: number, g: number, b: number): string {
  const hex = [r, g, b]
    .map((channel) => Math.round(clamp01(channel) * 255).toString(16).padStart(2, '0'))
    .join('');
  return '#' + hex;
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || !match[1]) return null;
  const n = match[1];
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

function colorDistance(a: string, b: string): number {
  const left = parseHex(a);
  const right = parseHex(b);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function snapColor(hex: string, opacity: number): FigmaColor {
  const normalized = hex.toLowerCase();
  let best: { token: string; dist: number } | undefined;
  for (const candidate of COLOR_TOKENS) {
    const dist = colorDistance(normalized, candidate.hex);
    if (!best || dist < best.dist) best = { token: candidate.token, dist };
  }
  if (best && best.dist <= COLOR_SNAP_MAX) {
    return { hex: normalized, opacity, token: best.token };
  }
  return { hex: normalized, opacity };
}

export function snapSpace(px: number): { px: number; token: string } | undefined {
  if (!Number.isFinite(px) || px <= 0) return undefined;
  let best = SPACE_SCALE[0];
  if (!best) return undefined;
  for (const step of SPACE_SCALE) {
    if (Math.abs(step.px - px) < Math.abs(best.px - px)) best = step;
  }
  if (Math.abs(best.px - px) <= 2) return best;
  return undefined;
}

export function snapFontSize(px: number): { px: number; token: string } | undefined {
  if (!Number.isFinite(px) || px <= 0) return undefined;
  let best = TEXT_SCALE[0];
  if (!best) return undefined;
  for (const step of TEXT_SCALE) {
    if (Math.abs(step.px - px) < Math.abs(best.px - px)) best = step;
  }
  if (Math.abs(best.px - px) <= 3) return best;
  return undefined;
}

export function cssVar(token: string, fallback: string): string {
  return `var(--${token}, ${fallback})`;
}
