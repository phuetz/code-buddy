/**
 * Palette presentation of the Cowork availability computed by the main process (P4).
 * Pure (no React) so it is testable without the renderer toolchain. The renderer
 * only READS availability: an unavailable entry is shown disabled with its reason
 * and never dispatched; the main process re-checks on execute anyway.
 */

export type PaletteAvailability =
  | { status: 'available' }
  | { status: 'hidden' }
  | { status: 'unavailable'; reason: string };

export interface PaletteItemState {
  disabled: boolean;
  reason?: string;
}

export function paletteItemState(item: { availability?: PaletteAvailability }): PaletteItemState {
  const availability = item.availability;
  if (!availability || availability.status === 'available') return { disabled: false };
  if (availability.status === 'hidden') return { disabled: true, reason: 'masquée dans Cowork' };
  return { disabled: true, reason: availability.reason };
}

/** Next selectable index when moving through the list, skipping disabled entries. */
export function nextEnabledIndex(
  items: ReadonlyArray<{ availability?: PaletteAvailability }>,
  from: number,
  step: 1 | -1,
): number {
  if (items.length === 0) return 0;
  for (let offset = 1; offset <= items.length; offset++) {
    const idx = (from + step * offset + items.length * offset) % items.length;
    if (!paletteItemState(items[idx]!).disabled) return idx;
  }
  return from;
}
