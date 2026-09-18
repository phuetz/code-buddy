/**
 * Line-oriented Markdown model for local office export.
 * Not a full CommonMark parser: headings, lists, fences, tables, images,
 * quotes and `---` breaks are enough for artefact / conversation export.
 *
 * @module main/office-export/markdown-model
 */

export const FALLBACK_TITLE = 'Sans titre';

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'blockquote'; text: string }
  | { type: 'thematic_break' };

export interface MdDocument {
  title: string;
  blocks: MdBlock[];
}

export interface SlideModel {
  title: string;
  bullets: string[];
  image?: { alt: string; src: string };
  notes: string;
}

const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const THEMATIC = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const ATX = /^(#{1,6})\s+(.*)$/;
const ATX_EMPTY = /^(#{1,6})\s*$/;
const UL = /^[-*+]\s+(.*)$/;
const OL = /^\d+[.)]\s+(.*)$/;
const IMG = /^!\[([^\]]*)\]\((.+)\)$/;

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return TABLE_SEP.test(line.trim());
}

function startsBlock(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (THEMATIC.test(trimmed) && !isTableSeparator(trimmed)) return true;
  if (ATX.test(trimmed) || ATX_EMPTY.test(trimmed)) return true;
  if (trimmed.startsWith('```')) return true;
  if (trimmed.startsWith('>')) return true;
  if (IMG.test(trimmed)) return true;
  if (trimmed.startsWith('|')) return true;
  if (UL.test(trimmed) || OL.test(trimmed)) return true;
  return false;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function unescapeMarkdown(text: string): string {
  return decodeEntities(text.replace(/\\([\\`*_[\]()#+.!-])/g, '$1'));
}

export function parseMarkdownDocument(source: string, fallbackTitle = FALLBACK_TITLE): MdDocument {
  const lines = (source ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (THEMATIC.test(trimmed) && !isTableSeparator(trimmed)) {
      blocks.push({ type: 'thematic_break' });
      i += 1;
      continue;
    }

    const emptyHeading = trimmed.match(ATX_EMPTY);
    if (emptyHeading) {
      const level = emptyHeading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, text: '' });
      i += 1;
      continue;
    }

    const heading = trimmed.match(ATX);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, text: unescapeMarkdown(heading[2] ?? '').trim() });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', language, text: body.join('\n') });
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quote.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'blockquote', text: unescapeMarkdown(quote.join('\n').trim()) });
      continue;
    }

    const image = trimmed.match(IMG);
    if (image) {
      const rawSrc = (image[2] ?? '').trim().replace(/^<|>$/g, '');
      const src = rawSrc.replace(/\s+".*"$/, '').trim();
      blocks.push({ type: 'image', alt: unescapeMarkdown(image[1] ?? ''), src });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? '')) {
      const headers = splitTableRow(trimmed).map(unescapeMarkdown);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|') && !isTableSeparator(lines[i] ?? '')) {
        rows.push(splitTableRow(lines[i] ?? '').map(unescapeMarkdown));
        i += 1;
      }
      if (headers.length > 0) {
        blocks.push({ type: 'table', headers, rows });
      }
      continue;
    }

    const ul = trimmed.match(UL);
    const ol = trimmed.match(OL);
    if (ul || ol) {
      const ordered = Boolean(ol);
      const items: string[] = [];
      while (i < lines.length) {
        const itemLine = (lines[i] ?? '').trim();
        const match = ordered ? itemLine.match(OL) : itemLine.match(UL);
        if (!match) break;
        items.push(unescapeMarkdown(match[1] ?? '').trim());
        i += 1;
      }
      if (items.length > 0) {
        blocks.push({ type: 'list', ordered, items });
      }
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (!current.trim()) break;
      if (para.length > 0 && startsBlock(current)) break;
      para.push(current.trim());
      i += 1;
    }
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', text: unescapeMarkdown(para.join(' ')) });
    }
  }

  const firstH1 = blocks.find((block) => block.type === 'heading' && block.level === 1);
  const firstHeading = blocks.find((block) => block.type === 'heading');
  const headingText =
    (firstH1 && firstH1.type === 'heading' ? firstH1.text : '') ||
    (firstHeading && firstHeading.type === 'heading' ? firstHeading.text : '');
  const title = headingText.trim() || fallbackTitle.trim() || FALLBACK_TITLE;

  return { title, blocks };
}

export const MAX_SLIDE_BULLETS = 10;

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .trim();
}

export function documentToSlides(doc: MdDocument, warnings?: string[]): SlideModel[] {
  const slides: SlideModel[] = [];
  let current: (SlideModel & { droppedBullets: number }) | null = null;

  const flush = (): void => {
    if (current) {
      if (current.droppedBullets > 0) {
        const slideTitle = current.title.trim() || (slides.length === 0 ? doc.title : '') || FALLBACK_TITLE;
        warnings?.push(
          `Diapositive « ${slideTitle} » : limite de ${MAX_SLIDE_BULLETS} puces atteinte, ${current.droppedBullets} élément(s) tronqué(s)`
        );
      }
      slides.push({
        title: current.title,
        bullets: current.bullets,
        image: current.image,
        notes: current.notes,
      });
    }
    current = null;
  };

  const ensure = (): SlideModel & { droppedBullets: number } => {
    if (!current) {
      current = { title: '', bullets: [], notes: '', droppedBullets: 0 };
    }
    return current;
  };

  const pushBullet = (slide: SlideModel & { droppedBullets: number }, text: string): void => {
    const cleaned = stripInlineMarkdown(text);
    if (!cleaned) return;
    if (slide.bullets.length >= MAX_SLIDE_BULLETS) {
      slide.droppedBullets += 1;
      return;
    }
    slide.bullets.push(cleaned);
  };

  for (const block of doc.blocks) {
    if (block.type === 'thematic_break') {
      flush();
      continue;
    }
    if (block.type === 'heading' && block.level === 1) {
      flush();
      current = {
        title: stripInlineMarkdown(block.text) || FALLBACK_TITLE,
        bullets: [],
        notes: '',
        droppedBullets: 0,
      };
      continue;
    }

    const slide = ensure();
    if (block.type === 'heading') {
      if (!slide.title.trim()) {
        slide.title = stripInlineMarkdown(block.text) || FALLBACK_TITLE;
      } else {
        pushBullet(slide, block.text);
      }
    } else if (block.type === 'list') {
      for (const item of block.items) pushBullet(slide, item);
    } else if (block.type === 'paragraph') {
      pushBullet(slide, block.text);
    } else if (block.type === 'blockquote') {
      slide.notes = [slide.notes, stripInlineMarkdown(block.text)].filter(Boolean).join('\n');
    } else if (block.type === 'image') {
      if (!slide.image) {
        slide.image = { alt: block.alt, src: block.src };
      }
    } else if (block.type === 'code') {
      const first = block.text.split('\n').find((line) => line.trim());
      if (first) pushBullet(slide, first.trim());
    } else if (block.type === 'table') {
      pushBullet(slide, block.headers.join(' · '));
    }
  }
  flush();

  if (slides.length === 0) {
    return [{ title: doc.title || FALLBACK_TITLE, bullets: [], notes: '' }];
  }

  return slides.map((slide) => ({
    ...slide,
    title: slide.title.trim() || FALLBACK_TITLE,
  }));
}
