/**
 * Tiny, SAFE Mustache-style template engine for AUTHORED widgets. Authored
 * widgets are data-driven yet inert: `{{path}}` interpolation is ALWAYS
 * HTML-escaped, `{{#each}}`/`{{#if}}` are the only control structures, and there
 * is NO expression evaluation, NO function calls, NO `eval`. A template is a
 * pure string transform — CSP-proof (no client script) and injection-safe (every
 * interpolated value is escaped, so authored data can never inject markup).
 *
 * Grammar:
 *   {{ a.b.c }}            → HTML-escaped value at dot-path (empty if missing)
 *   {{#each items}} … {{/each}}   → iterate an array; inside, {{this}} / {{field}}
 *   {{#if flag}} … {{else}} … {{/if}}  → truthy conditional
 * Paths resolve against the current item, walking up to parent contexts.
 *
 * @module widgets/template-engine
 */

export function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]!
  );
}

interface Ctx {
  data: unknown;
  parent?: Ctx;
}

/** Resolve a dot-path against the context chain (item → parents). undefined if unresolved. */
function resolvePath(path: string, ctx: Ctx): unknown {
  const p = path.trim();
  if (p === 'this' || p === '.') return ctx.data;
  const parts = p.replace(/^this\./, '').split('.').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return ctx.data;
  for (let cur: Ctx | undefined = ctx; cur; cur = cur.parent) {
    let val: unknown = cur.data;
    let ok = true;
    for (const key of parts) {
      if (val != null && typeof val === 'object' && key in (val as object)) {
        val = (val as Record<string, unknown>)[key];
      } else {
        ok = false;
        break;
      }
    }
    if (ok) return val;
  }
  return undefined;
}

function isTruthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

type Token = { text: string } | { tag: string };

function tokenize(tpl: string): Token[] {
  const tokens: Token[] = [];
  const re = /\{\{\{?\s*([^}]*?)\s*\}?\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) tokens.push({ text: tpl.slice(last, m.index) });
    tokens.push({ tag: m[1]!.trim() });
    last = re.lastIndex;
  }
  if (last < tpl.length) tokens.push({ text: tpl.slice(last) });
  return tokens;
}

/**
 * Render a chunk of tokens from index `start` until an optional stop tag.
 * Returns the produced string and the index of the token AFTER the stop tag.
 */
function renderTokens(
  tokens: Token[],
  start: number,
  ctx: Ctx,
  stop: (tag: string) => boolean
): { out: string; next: number } {
  let out = '';
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if ('text' in tok) {
      out += tok.text;
      i++;
      continue;
    }
    const tag = tok.tag;
    if (stop(tag)) return { out, next: i };

    if (tag.startsWith('#each ')) {
      const path = tag.slice(6).trim();
      const bodyStart = i + 1;
      // Find the matching {{/each}} to know where the block ends (skip nested each).
      const arr = resolvePath(path, ctx);
      const items = Array.isArray(arr) ? arr : [];
      let rendered = '';
      let endIdx = bodyStart;
      if (items.length === 0) {
        // Render once into a sink to advance past the block.
        const sink = renderTokens(tokens, bodyStart, ctx, (t) => t === '/each');
        endIdx = sink.next;
      } else {
        for (let k = 0; k < items.length; k++) {
          const r = renderTokens(tokens, bodyStart, { data: items[k], parent: ctx }, (t) => t === '/each');
          rendered += r.out;
          endIdx = r.next;
        }
      }
      out += rendered;
      i = endIdx + 1; // skip the {{/each}}
      continue;
    }

    if (tag.startsWith('#if ')) {
      const path = tag.slice(4).trim();
      const truthy = isTruthy(resolvePath(path, ctx));
      // Render the "then" branch up to {{else}} or {{/if}}.
      const thenR = renderTokens(tokens, i + 1, ctx, (t) => t === 'else' || t === '/if');
      let afterThen = thenR.next;
      let elseOut = '';
      let endIf = afterThen;
      if (tokens[afterThen] && 'tag' in tokens[afterThen]! && (tokens[afterThen] as { tag: string }).tag === 'else') {
        const elseR = renderTokens(tokens, afterThen + 1, ctx, (t) => t === '/if');
        elseOut = elseR.out;
        endIf = elseR.next;
      }
      out += truthy ? thenR.out : elseOut;
      i = endIf + 1; // skip {{/if}}
      continue;
    }

    // Plain interpolation — ALWAYS escaped.
    out += escapeHtml(resolvePath(tag, ctx));
    i++;
  }
  return { out, next: i };
}

/** Render a safe Mustache-style template with `data`. Pure, never executes code. */
export function renderTemplate(tpl: string, data: unknown): string {
  const tokens = tokenize(tpl);
  return renderTokens(tokens, 0, { data }, () => false).out;
}
