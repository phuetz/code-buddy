/** Deterministic, local-only extraction of book manuscript material for trailers. */

import fs from 'fs/promises';
import path from 'path';

import type { ManuscriptSource } from './cinematic-trailer-plan.js';

const HARD_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_EXCERPT_LIMIT = 24;
const MAX_EXCERPT_CHARACTERS = 360;

export interface BookChapter {
  file: string;
  heading: string;
  text: string;
}

export interface BookManuscript {
  title: string;
  chapters: BookChapter[];
  coverPath?: string;
}

interface ManuscriptDirectoryEntry {
  name: string;
  isFile(): boolean;
}

interface ManuscriptFileInfo {
  size: number;
  isFile(): boolean;
}

export interface BookManuscriptFileSystem {
  readdir(directory: string, options: { withFileTypes: true }): Promise<ManuscriptDirectoryEntry[]>;
  lstat(filename: string): Promise<ManuscriptFileInfo>;
  readFile(filename: string, encoding: 'utf8'): Promise<string>;
}

export interface LoadBookManuscriptOptions {
  /** May lower, but never raise, the hard 2 MiB per-file ceiling. */
  maxBytesPerFile?: number;
  fileSystem?: BookManuscriptFileSystem;
}

export interface CandidateExcerpt {
  id: string;
  text: string;
  chapterIndex: number;
  lineStart: number;
  lineEnd: number;
  manuscriptSource: ManuscriptSource;
}

export interface ExtractCandidateExcerptsOptions {
  limit?: number;
  minCharacters?: number;
}

const defaultFileSystem: BookManuscriptFileSystem = {
  readdir: (directory, options) => fs.readdir(directory, options),
  lstat: (filename) => fs.lstat(filename),
  readFile: (filename, encoding) => fs.readFile(filename, encoding),
};

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function frontmatterTitle(text: string): string | undefined {
  const normalized = text.replace(/^\uFEFF/u, '');
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)/u.exec(normalized);
  if (!match?.[1]) return undefined;
  const titleLine = match[1].split(/\r?\n/u).find((line) => /^title\s*:/iu.test(line));
  if (!titleLine) return undefined;
  const value = unquoteYamlScalar(titleLine.replace(/^title\s*:/iu, ''));
  return value || undefined;
}

function firstHeading(text: string): string | undefined {
  const match = /^\s*#\s+(.+?)\s*#*\s*$/mu.exec(text);
  return match?.[1]?.trim() || undefined;
}

function fallbackHeading(filename: string): string {
  return path.basename(filename, path.extname(filename)).replace(/[-_]+/gu, ' ').trim();
}

function resolveReadLimit(value: number | undefined): number {
  if (value === undefined) return HARD_MAX_FILE_BYTES;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('The manuscript per-file byte limit must be a positive integer');
  }
  return Math.min(value, HARD_MAX_FILE_BYTES);
}

/** Load naturally ordered Markdown chapters without performing any network I/O. */
export async function loadBookManuscript(
  bookDir: string,
  options: LoadBookManuscriptOptions = {},
): Promise<BookManuscript> {
  if (!bookDir.trim()) throw new Error('Book directory is required');
  const directory = path.resolve(bookDir);
  const io = options.fileSystem ?? defaultFileSystem;
  const maxBytes = resolveReadLimit(options.maxBytesPerFile);
  const entries = await io.readdir(directory, { withFileTypes: true });
  if (entries.length === 0) throw new Error(`Book directory is empty: ${directory}`);

  const markdownEntries = entries
    .filter((entry) => entry.isFile() && /\.md$/iu.test(entry.name))
    .sort((left, right) => naturalCompare(left.name, right.name));
  if (markdownEntries.length === 0) {
    throw new Error(`Book directory contains no Markdown chapters: ${directory}`);
  }

  let title: string | undefined;
  const chapters: BookChapter[] = [];
  for (const entry of markdownEntries) {
    const filename = path.join(directory, entry.name);
    const info = await io.lstat(filename);
    if (!info.isFile()) throw new Error(`Manuscript chapter is not a regular file: ${entry.name}`);
    if (info.size > maxBytes) {
      throw new Error(`Manuscript chapter exceeds the ${maxBytes}-byte limit: ${entry.name}`);
    }
    const text = await io.readFile(filename, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`Manuscript chapter exceeds the ${maxBytes}-byte limit after reading: ${entry.name}`);
    }
    const yamlTitle = frontmatterTitle(text);
    const heading = firstHeading(text);
    title ??= yamlTitle ?? heading;
    chapters.push({
      file: entry.name,
      heading: heading ?? fallbackHeading(entry.name),
      text,
    });
  }

  const coverEntry = entries
    .filter((entry) => entry.isFile() && /^(?:cover|couverture)(?:[-_. ].*)?\.(?:jpe?g|png|webp)$/iu.test(entry.name))
    .sort((left, right) => naturalCompare(left.name, right.name))[0];
  let coverPath: string | undefined;
  if (coverEntry) {
    const candidate = path.join(directory, coverEntry.name);
    const info = await io.lstat(candidate);
    if (info.isFile()) coverPath = candidate;
  }

  return {
    title: title ?? path.basename(directory),
    chapters,
    ...(coverPath ? { coverPath } : {}),
  };
}

interface SourceRange {
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
}

interface ScoredExcerpt extends Omit<CandidateExcerpt, 'id'> {
  score: number;
  offset: number;
}

function proseRanges(text: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let blockStart = -1;
  let blockEnd = -1;
  let blockLineStart = -1;
  let blockLineEnd = -1;
  let offset = 0;
  let lineNumber = 1;
  let inFrontmatter = text.replace(/^\uFEFF/u, '').startsWith('---');
  let inFence = false;

  const flush = (): void => {
    if (blockStart >= 0 && blockEnd > blockStart) {
      ranges.push({ start: blockStart, end: blockEnd, lineStart: blockLineStart, lineEnd: blockLineEnd });
    }
    blockStart = -1;
    blockEnd = -1;
    blockLineStart = -1;
    blockLineEnd = -1;
  };

  const lines = text.match(/.*(?:\r?\n|$)/gu) ?? [];
  for (const rawLine of lines) {
    if (!rawLine) continue;
    const content = rawLine.replace(/\r?\n$/u, '');
    const trimmed = content.trim();
    const isDelimiter = trimmed === '---';
    if (lineNumber === 1 && inFrontmatter && isDelimiter) {
      flush();
      offset += rawLine.length;
      lineNumber += 1;
      continue;
    }
    if (inFrontmatter) {
      flush();
      if (isDelimiter) inFrontmatter = false;
      offset += rawLine.length;
      lineNumber += 1;
      continue;
    }
    if (/^```/u.test(trimmed)) {
      flush();
      inFence = !inFence;
    } else if (inFence || !trimmed || /^#{1,6}\s/u.test(trimmed)) {
      flush();
    } else {
      const leading = content.length - content.trimStart().length;
      const trailing = content.length - content.trimEnd().length;
      if (blockStart < 0) {
        blockStart = offset + leading;
        blockLineStart = lineNumber;
      }
      blockEnd = offset + content.length - trailing;
      blockLineEnd = lineNumber;
    }
    offset += rawLine.length;
    lineNumber += 1;
  }
  flush();
  return ranges;
}

function sentenceRanges(text: string, range: SourceRange): SourceRange[] {
  const source = text.slice(range.start, range.end);
  const matches = [...source.matchAll(/[^.!?…]+(?:[.!?…]+(?:[”»"']+)?(?=\s|$)|$)/gu)];
  return matches.flatMap((match) => {
    const raw = match[0];
    const relativeStart = (match.index ?? 0) + raw.length - raw.trimStart().length;
    const relativeEnd = (match.index ?? 0) + raw.trimEnd().length;
    if (relativeEnd <= relativeStart) return [];
    const prefix = source.slice(0, relativeStart);
    const body = source.slice(relativeStart, relativeEnd);
    const lineStart = range.lineStart + (prefix.match(/\n/gu)?.length ?? 0);
    const lineEnd = lineStart + (body.match(/\n/gu)?.length ?? 0);
    return [{
      start: range.start + relativeStart,
      end: range.start + relativeEnd,
      lineStart,
      lineEnd,
    }];
  });
}

const ACTION_WORDS = /\b(?:court|courut|fuit|frappe|ouvre|ferme|tombe|saisit|arrache|brise|tourne|avance|recule|crie|hurle|chuchote|découvre|voit|entend|runs?|flees?|strikes?|opens?|closes?|falls?|grabs?|tears?|breaks?|turns?|walks?|screams?|whispers?|discovers?|sees?|hears?)\b/giu;
const TENSION_WORDS = /\b(?:sang|ombre|nuit|silence|peur|danger|mort|secret|mensonge|disparu|interdit|urgence|blood|shadow|night|silence|fear|danger|death|secret|lie|missing|forbidden|urgent)\b/giu;
const CONCRETE_WORDS = /\b(?:porte|fenêtre|route|forêt|maison|chambre|visage|main|couteau|lettre|photo|voiture|train|mer|feu|pluie|door|window|road|forest|house|room|face|hand|knife|letter|photo|car|train|sea|fire|rain)\b/giu;

function matchCount(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

function imageTensionScore(text: string): number {
  const dialogue = /(?:^|\s)[—–]|[«“"]/u.test(text) ? 6 : 0;
  const action = Math.min(matchCount(text, ACTION_WORDS), 3) * 3;
  const tension = Math.min(matchCount(text, TENSION_WORDS), 3) * 3;
  const concrete = Math.min(matchCount(text, CONCRETE_WORDS), 4) * 2;
  const properNouns = Math.min([...(text.matchAll(/\b\p{Lu}[\p{L}'’-]{2,}\b/gu))].length, 3);
  const lengthFit = text.length >= 45 && text.length <= 280 ? 3 : 0;
  return dialogue + action + tension + concrete + properNouns + lengthFit;
}

function chunkSentences(text: string, sentences: SourceRange[]): SourceRange[] {
  const chunks: SourceRange[] = [];
  for (let index = 0; index < sentences.length;) {
    const first = sentences[index]!;
    let endIndex = index;
    while (endIndex + 1 < sentences.length && endIndex - index < 2) {
      const next = sentences[endIndex + 1]!;
      if (next.end - first.start > MAX_EXCERPT_CHARACTERS) break;
      endIndex += 1;
    }
    const last = sentences[endIndex]!;
    chunks.push({ start: first.start, end: last.end, lineStart: first.lineStart, lineEnd: last.lineEnd });
    index = endIndex + 1;
  }
  return chunks;
}

/** Select short, image-bearing passages with exact manuscript line provenance. */
export function extractCandidateExcerpts(
  manuscript: BookManuscript,
  options: ExtractCandidateExcerptsOptions = {},
): CandidateExcerpt[] {
  const limit = options.limit ?? DEFAULT_EXCERPT_LIMIT;
  const minCharacters = options.minCharacters ?? 24;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('Excerpt limit must be a positive integer');
  if (!Number.isInteger(minCharacters) || minCharacters < 1) {
    throw new Error('Excerpt minimum length must be a positive integer');
  }

  const candidates: ScoredExcerpt[] = [];
  manuscript.chapters.forEach((chapter, chapterIndex) => {
    for (const paragraph of proseRanges(chapter.text)) {
      for (const chunk of chunkSentences(chapter.text, sentenceRanges(chapter.text, paragraph))) {
        const excerptText = chapter.text.slice(chunk.start, chunk.end).trim();
        if (excerptText.length < minCharacters || excerptText.length > MAX_EXCERPT_CHARACTERS) continue;
        candidates.push({
          text: excerptText,
          chapterIndex,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          manuscriptSource: {
            file: chapter.file,
            locator: `chapter:${chapterIndex + 1};lines:${chunk.lineStart}-${chunk.lineEnd}`,
          },
          score: imageTensionScore(excerptText),
          offset: chunk.start,
        });
      }
    }
  });

  return candidates
    .sort((left, right) =>
      right.score - left.score || left.chapterIndex - right.chapterIndex || left.offset - right.offset)
    .slice(0, limit)
    .map(({ score: _score, offset: _offset, ...excerpt }, index) => ({
      id: `excerpt-${String(index + 1).padStart(3, '0')}`,
      ...excerpt,
    }));
}
