/**
 * Semantic tone class helper for additive Cowork UI primitives.
 *
 * @module renderer/utils/ui-tone
 */

export type UiTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export function toneClasses(tone: UiTone = 'default'): string {
  if (tone === 'success') return 'bg-success/15 text-success border-success/30';
  if (tone === 'warning') return 'bg-warning/15 text-warning border-warning/30';
  if (tone === 'danger') return 'bg-destructive/15 text-destructive border-destructive/30';
  if (tone === 'info') return 'bg-primary/15 text-primary border-primary/30';
  return 'bg-muted text-muted-foreground border-border';
}
