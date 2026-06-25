/**
 * Unified rendering — plain text.
 *
 * Walks the shared markdown AST and strips it to clean plain text while keeping
 * structure (headings uppercased, lists bulleted, tables aligned monospace).
 * For piped output, the web chat, and as the Telegram HTML fallback.
 */
import { type Token, type Tokens } from 'marked';
import { parseMarkdown } from './markdown-core.js';

function inlineToText(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'br':
        out += '\n';
        break;
      case 'link': {
        const l = t as Tokens.Link;
        const txt = inlineToText(l.tokens) || l.text || '';
        out += /^https?:/i.test(l.href || '') && txt !== l.href ? `${txt} (${l.href})` : txt;
        break;
      }
      case 'image':
        out += (t as Tokens.Image).text || '';
        break;
      default: {
        const any = t as { tokens?: Token[]; text?: string };
        out += any.tokens ? inlineToText(any.tokens) : (any.text ?? '');
      }
    }
  }
  return out;
}

function tableToText(t: Tokens.Table): string {
  const headers = t.header.map((c) => inlineToText(c.tokens).trim());
  const rows = t.rows.map((r) => r.map((c) => inlineToText(c.tokens).trim()));
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length), 1));
  const fmt = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i]!)).join('  ').trimEnd();
  return [fmt(headers), widths.map((w) => '─'.repeat(w)).join('  '), ...rows.map(fmt)].join('\n');
}

function blocksToText(tokens: Token[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break;
      case 'heading':
        out.push(inlineToText((t as Tokens.Heading).tokens).toUpperCase());
        break;
      case 'paragraph':
        out.push(inlineToText((t as Tokens.Paragraph).tokens));
        break;
      case 'text': {
        const tok = t as Tokens.Text;
        out.push(tok.tokens ? inlineToText(tok.tokens) : tok.text);
        break;
      }
      case 'code':
        out.push((t as Tokens.Code).text);
        break;
      case 'blockquote':
        out.push(blocksToText((t as Tokens.Blockquote).tokens).map((l) => `> ${l}`).join('\n'));
        break;
      case 'table':
        out.push(tableToText(t as Tokens.Table));
        break;
      case 'list': {
        const list = t as Tokens.List;
        out.push(
          list.items
            .map((it, i) => {
              const m = list.ordered ? `${(Number(list.start) || 1) + i}. ` : '• ';
              return m + blocksToText(it.tokens).join('\n').replace(/\n/g, '\n' + ' '.repeat(m.length));
            })
            .join('\n'),
        );
        break;
      }
      case 'hr':
        out.push('─'.repeat(10));
        break;
      default: {
        const any = t as { tokens?: Token[]; text?: string };
        out.push(any.tokens ? inlineToText(any.tokens) : (any.text ?? ''));
      }
    }
  }
  return out.filter((b) => b.trim().length > 0);
}

/** Render markdown to clean plain text. Never throws. */
export function renderPlain(md: string): string {
  try {
    return blocksToText(parseMarkdown(md)).join('\n\n');
  } catch {
    return (md ?? '').trim();
  }
}
