/**
 * Widget gate — validates an LLM-proposed authored widget template. Ordered,
 * blocking, FAIL-CLOSED (anything unproven is rejected; nothing is kept on a
 * miss). Mirrors the self-improvement skill/tool gates.
 *
 *   G1 STATIC FIREWALL — the authored template must be inert & self-contained:
 *      no <script>, no inline event handlers, no `javascript:`, no external
 *      resource loads (src=, external stylesheet, @import, url(http…)), no
 *      <iframe>/<object>/<embed>. (Outbound <a href> links ARE allowed.)
 *   G2 RENDER — `renderTemplate(template, sample)` must produce non-empty output,
 *      leave NO unresolved `{{…}}` tokens, and the rendered HTML must ALSO pass
 *      the firewall (defence in depth; data is escaped so this is belt & braces).
 *
 * Pure & synchronous — no I/O, no network, no code execution.
 *
 * @module widgets/widget-gate
 */
import { renderTemplate } from './template-engine.js';
import type { WidgetProposal, WidgetGateOutcome } from './widget-types.js';

/** Patterns that make a widget unsafe (loads/executes code or phones home). */
const FIREWALL_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /<\s*script\b/i, why: 'inline <script> (CSP-blocked and unsafe)' },
  { re: /<\s*(iframe|object|embed|frame|frameset)\b/i, why: 'nested framing/embedding element' },
  { re: /\son[a-z]+\s*=/i, why: 'inline event handler (onload/onclick/…)' },
  { re: /javascript\s*:/i, why: 'javascript: URL' },
  { re: /\bdata\s*:\s*text\/html/i, why: 'data:text/html payload' },
  { re: /<\s*link\b[^>]*\bhref\s*=\s*["']?\s*https?:/i, why: 'external stylesheet <link>' },
  { re: /@import\b/i, why: '@import (external stylesheet load)' },
  { re: /\burl\s*\(\s*["']?\s*(https?:)?\/\//i, why: 'url() loading an external resource' },
  // A resource-loading `src=` to an external/absolute URL. Escaped `{{ }}` is fine.
  { re: /\bsrc\s*=\s*["']?\s*(https?:)?\/\//i, why: 'external resource via src=' },
  { re: /<\s*(base|meta)\b/i, why: '<base>/<meta> (can redirect resource resolution)' },
];

/** Scan a chunk of HTML for firewall violations. Returns the list of reasons (empty = safe). */
export function scanWidgetFirewall(html: string): string[] {
  const reasons: string[] = [];
  for (const { re, why } of FIREWALL_PATTERNS) {
    if (re.test(html)) reasons.push(why);
  }
  return reasons;
}

/** Run a proposal through the gate. Fail-closed. Pure. */
export function gateWidget(proposal: WidgetProposal): WidgetGateOutcome {
  const template = (proposal?.template ?? '').trim();
  if (!template) {
    return { accepted: false, reason: 'render-empty', reasons: ['empty template'] };
  }

  // G1 — firewall on the raw template.
  const staticReasons = scanWidgetFirewall(template);
  if (staticReasons.length > 0) {
    return { accepted: false, reason: 'static-scan', reasons: staticReasons };
  }

  // G2 — render with the sample and re-check.
  let fragment: string;
  try {
    fragment = renderTemplate(template, proposal.sample);
  } catch (e) {
    return { accepted: false, reason: 'render-empty', reasons: [`render threw: ${String(e)}`] };
  }
  if (!fragment.trim()) {
    return { accepted: false, reason: 'render-empty', reasons: ['template rendered to empty output'] };
  }
  if (/\{\{.*?\}\}/.test(fragment)) {
    return {
      accepted: false,
      reason: 'unrendered-tokens',
      reasons: ['rendered output still contains unresolved {{…}} tokens'],
    };
  }
  const renderedReasons = scanWidgetFirewall(fragment);
  if (renderedReasons.length > 0) {
    return { accepted: false, reason: 'render-unsafe', reasons: renderedReasons };
  }

  return { accepted: true, fragment };
}
