/**
 * Unified rendering — public façade.
 *
 * One markdown string → rendered for a target surface. Parse once (`marked`
 * AST in markdown-core), render per surface so the SAME agent output is
 * consistent everywhere.
 *
 *   render(md, 'telegram') → string[]   (HTML chunks, ≤4096, balanced)
 *   render(md, 'ansi', ctx) → string    (colored terminal)
 *   render(md, 'plain') → string        (stripped, structure-preserving)
 */
import type { RenderContext } from '../renderers/types.js';
import { renderTelegramHtml } from './telegram-html.js';
import { renderAnsi } from './ansi.js';
import { renderPlain } from './plain.js';

export { renderTelegramHtml } from './telegram-html.js';
export { renderAnsi } from './ansi.js';
export { renderPlain } from './plain.js';
export { parseMarkdown, escapeHtml } from './markdown-core.js';

export type RenderTarget = 'telegram' | 'ansi' | 'plain';

export function render(md: string, target: 'telegram'): string[];
export function render(md: string, target: 'ansi' | 'plain', ctx?: Partial<RenderContext>): string;
export function render(md: string, target: RenderTarget, ctx?: Partial<RenderContext>): string | string[] {
  switch (target) {
    case 'telegram':
      return renderTelegramHtml(md);
    case 'ansi':
      return renderAnsi(md, ctx);
    case 'plain':
      return renderPlain(md);
  }
}
