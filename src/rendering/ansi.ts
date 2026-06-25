/**
 * Unified rendering — ANSI terminal.
 *
 * Walks the shared markdown AST → ANSI for non-interactive terminal output (the
 * interactive Ink UI keeps its own specialised React table rendering). Same
 * AST-walker design as telegram-html.ts / plain.ts — no global marked mutation,
 * no marked-terminal coupling. `ctx.color === false` (NO_COLOR / piped) yields
 * clean plain text.
 */
import { type Token, type Tokens } from 'marked';
import { highlight } from 'cli-highlight';
import hljs from 'highlight.js';
import type { RenderContext } from '../renderers/types.js';
import { parseMarkdown } from './markdown-core.js';

const { getLanguage } = hljs;
const ESC = String.fromCharCode(27);
const C = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  italic: `${ESC}[3m`,
  underline: `${ESC}[4m`,
  strike: `${ESC}[9m`,
  cyan: `${ESC}[36m`,
  gray: `${ESC}[90m`,
  blue: `${ESC}[34m`,
  headingColors: [`${ESC}[1;35m`, `${ESC}[1;34m`, `${ESC}[1;33m`, `${ESC}[34m`, `${ESC}[33m`, `${ESC}[37m`],
};

function wrap(on: boolean, code: string, text: string): string {
  return on ? `${code}${text}${C.reset}` : text;
}

function inline(tokens: Token[] | undefined, color: boolean): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'strong':
        out += wrap(color, C.bold, inline((t as Tokens.Strong).tokens, color));
        break;
      case 'em':
        out += wrap(color, C.italic, inline((t as Tokens.Em).tokens, color));
        break;
      case 'del':
        out += wrap(color, C.strike, inline((t as Tokens.Del).tokens, color));
        break;
      case 'codespan':
        out += wrap(color, C.cyan, (t as Tokens.Codespan).text);
        break;
      case 'br':
        out += '\n';
        break;
      case 'link': {
        const l = t as Tokens.Link;
        const txt = inline(l.tokens, color) || l.text || '';
        out += wrap(color, C.underline + C.blue, txt) + (color ? '' : ` (${l.href})`);
        break;
      }
      case 'image':
        out += (t as Tokens.Image).text || '';
        break;
      default: {
        const any = t as { tokens?: Token[]; text?: string };
        out += any.tokens ? inline(any.tokens, color) : (any.text ?? '');
      }
    }
  }
  return out;
}

function tableAnsi(t: Tokens.Table, color: boolean): string {
  const headers = t.header.map((c) => inline(c.tokens, false).trim());
  const rows = t.rows.map((r) => r.map((c) => inline(c.tokens, false).trim()));
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length), 1));
  const fmt = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i]!)).join('  ').trimEnd();
  const sepLine = widths.map((w) => '─'.repeat(w)).join('  ');
  return [
    wrap(color, C.bold + C.cyan, fmt(headers)),
    wrap(color, C.gray, sepLine),
    ...rows.map(fmt),
  ].join('\n');
}

function blocks(tokens: Token[], color: boolean): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break;
      case 'heading': {
        const h = t as Tokens.Heading;
        const code = C.headingColors[Math.min(h.depth - 1, C.headingColors.length - 1)]!;
        out.push(wrap(color, code, `${'#'.repeat(h.depth)} ${inline(h.tokens, false)}`));
        break;
      }
      case 'paragraph':
        out.push(inline((t as Tokens.Paragraph).tokens, color));
        break;
      case 'text': {
        const tok = t as Tokens.Text;
        out.push(tok.tokens ? inline(tok.tokens, color) : tok.text);
        break;
      }
      case 'code': {
        const c = t as Tokens.Code;
        let code = c.text;
        if (color) {
          try {
            code = c.lang && getLanguage(c.lang)
              ? highlight(code, { language: c.lang, ignoreIllegals: true })
              : highlight(code, { ignoreIllegals: true });
          } catch {
            /* keep raw */
          }
        }
        out.push(code);
        break;
      }
      case 'blockquote':
        out.push(
          blocks((t as Tokens.Blockquote).tokens, color)
            .join('\n')
            .split('\n')
            .map((l) => wrap(color, C.gray, '│ ') + l)
            .join('\n'),
        );
        break;
      case 'table':
        out.push(tableAnsi(t as Tokens.Table, color));
        break;
      case 'list': {
        const list = t as Tokens.List;
        out.push(
          list.items
            .map((it, i) => {
              const m = list.ordered ? `${(Number(list.start) || 1) + i}. ` : '• ';
              return m + blocks(it.tokens, color).join('\n').replace(/\n/g, '\n' + ' '.repeat(m.length));
            })
            .join('\n'),
        );
        break;
      }
      case 'hr':
        out.push(wrap(color, C.gray, '─'.repeat(10)));
        break;
      default: {
        const any = t as { tokens?: Token[]; text?: string };
        out.push(any.tokens ? inline(any.tokens, color) : (any.text ?? ''));
      }
    }
  }
  return out.filter((b) => b.trim().length > 0);
}

/** Render markdown to an ANSI string. `ctx.color === false` → clean plain text.
 *  Never throws. */
export function renderAnsi(md: string, ctx?: Partial<RenderContext>): string {
  const color = ctx?.color !== false;
  try {
    return blocks(parseMarkdown(md), color).join('\n\n');
  } catch {
    return (md ?? '').trim();
  }
}
