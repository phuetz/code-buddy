/**
 * ```deck block — the agent emits a machine-readable slide deck in its reply
 * (same proven pattern as the App Studio ```plan block): parsed here into the
 * SlideDeckPreview's props, hidden from the chat text. Pure + testable.
 */
import type { SlidePreviewItem } from './slide-deck-preview-model.js';

const DECK_BLOCK_RE = /```deck\s*\n([\s\S]*?)```/;

/** Keeps the preview readable — a Genspark-style deck is 5-12 slides. */
const MAX_SLIDES = 24;

export interface ParsedDeck {
  title: string;
  slides: SlidePreviewItem[];
}

/** Parse a ```deck fenced JSON block: {"title","slides":[{title,bullets,notes}]}. */
export function parseDeckBlock(text: string): ParsedDeck | null {
  const match = (text ?? '').match(DECK_BLOCK_RE);
  if (!match) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]!);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.slides) || obj.slides.length === 0) return null;

  const slides: SlidePreviewItem[] = [];
  for (const entry of obj.slides.slice(0, MAX_SLIDES)) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const bullets = Array.isArray(s.bullets)
      ? s.bullets.filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
      : [];
    const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : undefined;
    if (!title && bullets.length === 0) continue;
    slides.push({
      ...(title ? { title } : {}),
      bullets,
      ...(typeof s.notes === 'string' && s.notes.trim() ? { notes: s.notes.trim() } : {}),
    });
  }
  if (slides.length === 0) return null;

  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 80) : 'Deck',
    slides,
  };
}

/** Remove ```deck blocks from the visible reply (the preview renders them). */
export function stripDeckBlocks(text: string): string {
  return text.replace(/```deck\s*\n[\s\S]*?```/g, '').trim();
}

export interface DeckSourceMessage {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/** Most recent deck in the session: streaming partial wins, else newest assistant. */
export function latestDeckBlock(messages: ReadonlyArray<DeckSourceMessage>, partial?: string): ParsedDeck | null {
  if (partial) {
    const live = parseDeckBlock(partial);
    if (live) return live;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const text = m.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    const deck = parseDeckBlock(text);
    if (deck) return deck;
  }
  return null;
}

/** The generation prompt: emit the deck block first, then offer the export. */
export function buildDeckGenerationPrompt(subject: string): string {
  return [
    `Construis un deck de présentation sur : ${subject}`,
    '',
    'COMMENCE ta réponse par le deck complet dans un bloc ```deck (JSON strict) :',
    '```deck',
    '{"title":"<titre du deck>","slides":[{"title":"<titre slide>","bullets":["<point>","<point>"],"notes":"<note orateur optionnelle>"}]}',
    '```',
    '6 à 10 slides : une slide de titre, un fil narratif clair, 2 à 4 bullets CONCRETS par slide',
    "(chiffres, exemples — pas de généralités), une slide de conclusion avec l'action suivante.",
    "N'utilise AUCUN outil pour cette étape et n'écris AUCUN fichier — le bloc ```deck suffit,",
    "l'interface le rend en aperçu. Après le bloc, résume le deck en 2 phrases.",
  ].join('\n');
}

/** The export prompt: hand the emitted deck to the real pptx skill. */
export function buildDeckExportPrompt(deck: ParsedDeck): string {
  return [
    `Exporte ce deck en fichier PowerPoint (.pptx) avec le skill pptx : crée « ${deck.title}.pptx »`,
    'dans le dossier de travail courant, une slide par entrée, titres et bullets fidèles au deck ci-dessous,',
    'notes orateur incluses quand présentes. Réponds avec le chemin du fichier créé.',
    '',
    '```deck',
    JSON.stringify({ title: deck.title, slides: deck.slides }, null, 1),
    '```',
  ].join('\n');
}
