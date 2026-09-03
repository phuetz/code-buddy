/**
 * Structured, local notes about Code Buddy's own released changes.
 *
 * Parsing is deliberately pure. The asynchronous loader only reads the
 * project's CHANGELOG.md and maintains a cache below `.codebuddy/`, never in
 * the user's home directory. This makes the self-model useful to the CLI,
 * Lisa, and the self-improvement loop without making any provider request.
 *
 * @module self-model/evolution-notes
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export type EvolutionActivation = 'opt-in' | 'default' | 'mixed' | 'unspecified';

export interface EvolutionNote {
  /** Stable local identifier used by the cache and the evolutionary archive. */
  id: string;
  /** ISO calendar date, or null for an undated Unreleased section. */
  date: string | null;
  title: string;
  /** One concise sentence per fact. */
  facts: string[];
  /** Newly mentioned environment variables. */
  variables: string[];
  /** Newly mentioned CLI or slash commands. */
  commands: string[];
  activation: EvolutionActivation;
}

export interface EvolutionNotesQuery {
  since?: string;
  subject?: string;
  limit?: number;
}

export interface ReadEvolutionNotesOptions {
  workDir?: string;
  changelogPath?: string;
  cachePath?: string;
  /** Tests and embedders may provide a project-local reader/writer. */
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
  mkdir?: (directory: string) => Promise<void>;
}

interface EvolutionCacheFile {
  schemaVersion: 1;
  source: { mtimeMs: number; size: number };
  notes: EvolutionNote[];
}

const MONTHS: Record<string, string> = {
  janvier: '01',
  january: '01',
  février: '02',
  fevrier: '02',
  february: '02',
  mars: '03',
  march: '03',
  avril: '04',
  april: '04',
  mai: '05',
  may: '05',
  juin: '06',
  june: '06',
  juillet: '07',
  july: '07',
  août: '08',
  aout: '08',
  august: '08',
  septembre: '09',
  september: '09',
  octobre: '10',
  october: '10',
  novembre: '11',
  november: '11',
  décembre: '12',
  decembre: '12',
  december: '12',
};

function normalizeText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function privacySafe(value: string): string {
  return value
    .replace(/\bpatrice\b/gi, 'la personne utilisatrice')
    .replace(/\/home\/[^\s`),]+/g, 'un chemin local')
    .replace(/\b[0-9a-f]{12,}\b/gi, 'une révision');
}

function markdownSafe(value: string): string {
  return privacySafe(
    value
      .replace(/!?(\[([^\]]+)\])\([^)]*\)/g, '$2')
      .replace(/\*\*|__|~~/g, '')
      .replace(/<[^>]+>/g, '')
  );
}

function sentence(value: string): string {
  const cleaned = normalizeText(markdownSafe(value)).replace(/^[-*+]\s+/, '');
  if (!cleaned) return '';
  const firstSentence = cleaned.match(/^.*?(?:[.!?…](?=\s|$)|$)/)?.[0]?.trim() ?? cleaned;
  const bounded = firstSentence.length > 420 ? `${firstSentence.slice(0, 417).trimEnd()}…` : firstSentence;
  return /[.!?…]$/.test(bounded) ? bounded : `${bounded}.`;
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.slice(0, 80) || 'note';
}

function extractDate(value: string): string | null {
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const named = value.toLowerCase().match(
    /\b(?:du\s+)?(\d{1,2})(?:\s+au\s+(\d{1,2}))?\s+([a-zàâçéèêëîïôûùüÿ]+)\s+(20\d{2})\b/
  );
  if (!named) return null;
  const month = MONTHS[named[3]!];
  const day = named[2] ?? named[1];
  return month && day ? `${named[4]}-${month}-${day.padStart(2, '0')}` : null;
}

function stripDateSuffix(title: string): string {
  return title
    .replace(/\s+[—–-]\s+(?:nuit du|du\s+\d|\d{1,2}\s+[a-zàâçéèêëîïôûùüÿ]+\s+20\d{2}).*$/i, '')
    .trim();
}

function extractFacts(body: string): string[] {
  const lines = body.replace(/\r/g, '').split('\n');
  const facts: string[] = [];
  let current = '';
  let sawBullet = false;

  const flush = (): void => {
    const value = sentence(current);
    if (value) facts.push(value);
    current = '';
  };

  for (const line of lines) {
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      sawBullet = true;
      flush();
      current = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
      continue;
    }
    if (!line.trim()) {
      if (!sawBullet) flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) continue;
    current = current ? `${current} ${line.trim()}` : line.trim();
  }
  flush();

  return [...new Set(facts)].slice(0, 12);
}

function codeSpans(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]!.trim()).filter(Boolean);
}

function extractVariables(body: string): string[] {
  const values = new Set<string>();
  const candidates = [body, ...codeSpans(body)];
  for (const candidate of candidates) {
    for (const match of candidate.matchAll(/\b[A-Z][A-Z0-9_]*_[A-Z0-9_]+\b/g)) values.add(match[0]);
  }
  return [...values].slice(0, 30);
}

function extractCommands(body: string): string[] {
  const values = new Set<string>();
  for (const candidate of codeSpans(body)) {
    if (/^(?:buddy\b|\/[-a-z])/i.test(candidate)) values.add(normalizeText(candidate));
  }
  return [...values].slice(0, 30);
}

function activationFor(value: string): EvolutionActivation {
  const text = value.toLowerCase();
  const optIn = /opt[- ]?in|opt[- ]?out|default off|par défaut[^.\n]*(?:off|désactiv|desactiv)|without (?:their|the) env|sans (?:leur|la) variable|=true pour l?['’]?opt/i.test(text);
  const defaultOn = /enabled by default|activé par défaut|active par défaut|default(?:s)? to on|par défaut[^.\n]*(?:actif|activé|on)/i.test(text);
  if (optIn && defaultOn) return 'mixed';
  if (optIn) return 'opt-in';
  if (defaultOn) return 'default';
  return 'unspecified';
}

function sectionNotes(markdown: string): Array<{ title: string; date: string | null; body: string }> {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const sections: Array<{ title: string; date: string | null; body: string }> = [];
  let releaseDate: string | null = null;
  let current: { title: string; date: string | null; lines: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    sections.push({ title: current.title, date: current.date ?? releaseDate, body: current.lines.join('\n') });
    current = null;
  };

  for (const line of lines) {
    const heading = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    const headingLevel = heading?.[1];
    const headingTitle = heading?.[2];
    if (headingLevel?.length === 2 && headingTitle) {
      flush();
      releaseDate = extractDate(headingTitle);
      continue;
    }
    if (headingLevel?.length === 3 && headingTitle) {
      flush();
      current = { title: stripDateSuffix(markdownSafe(headingTitle)), date: extractDate(headingTitle), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return sections;
}

/** Parse a CHANGELOG fixture without reading or writing anything. */
export function parseEvolutionNotes(markdown: string): EvolutionNote[] {
  const seen = new Map<string, number>();
  return sectionNotes(markdown).map((section) => {
    const facts = extractFacts(section.body);
    const variables = extractVariables(section.body);
    const commands = extractCommands(section.body);
    const baseId = `${section.date ?? 'unreleased'}:${slug(section.title)}`;
    const occurrence = seen.get(baseId) ?? 0;
    seen.set(baseId, occurrence + 1);
    return {
      id: occurrence === 0 ? baseId : `${baseId}:${occurrence + 1}`,
      date: section.date,
      title: section.title,
      facts,
      variables,
      commands,
      activation: activationFor(`${section.title}\n${section.body}`),
    };
  });
}

function dateValue(value: string | null): number {
  return value ? Date.parse(`${value}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY;
}

function normalizedSubject(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Filter and sort notes for a question such as "since 2026-09-01" or "voice". */
export function queryEvolutionNotes(
  notes: readonly EvolutionNote[],
  options: EvolutionNotesQuery = {},
): EvolutionNote[] {
  const since = options.since ? dateValue(options.since) : Number.NEGATIVE_INFINITY;
  const subject = options.subject ? normalizedSubject(options.subject) : '';
  const terms = subject.split(' ').filter((term) => term.length >= 2);
  const limit = Math.max(1, Math.min(50, options.limit ?? 5));
  return [...notes]
    .filter((note) => dateValue(note.date) >= since)
    .filter((note) => {
      if (terms.length === 0) return true;
      const haystack = normalizedSubject([
        note.title,
        ...note.facts,
        ...note.variables,
        ...note.commands,
      ].join(' '));
      return terms.some((term) => haystack.includes(term));
    })
    .sort((left, right) => dateValue(right.date) - dateValue(left.date))
    .slice(0, limit);
}

function friendlyCompanionLine(note: EvolutionNote): string {
  const text = normalizedSubject(`${note.title} ${note.facts[0] ?? ''}`);
  if (/(robot|voix|entend|echo|ecoute|parole|audio)/.test(text)) {
    return 'J’ai récemment appris à mieux distinguer ta voix de la mienne.';
  }
  if (/(fiabil|execution|verif|succes|test)/.test(text)) {
    return 'J’ai récemment appris à mieux vérifier ce que j’annonce avant de le dire.';
  }
  if (/(memoire|contexte|conversation|compagnon|relation)/.test(text)) {
    return 'J’ai récemment appris à mieux garder le fil de nos échanges.';
  }
  return `J’ai récemment appris quelque chose de nouveau sur ma façon de répondre : ${note.title.toLowerCase()}.`;
}

/** At most three first-person, non-repository lines for Lisa's relational prompt. */
export function formatEvolutionNotesForCompanion(notes: readonly EvolutionNote[]): string {
  return notes
    .slice(0, 3)
    .map(friendlyCompanionLine)
    .join('\n');
}

/** Compact plain text for a voice answer; it is intentionally not Markdown. */
export function formatEvolutionNotesForVoice(notes: readonly EvolutionNote[]): string {
  if (notes.length === 0) return 'Je n’ai pas encore de note de version récente à consulter.';
  return formatEvolutionNotesForCompanion(notes);
}

/** Condensed structured output for the `self_evolution` tool. */
export function formatEvolutionNotesSummary(notes: readonly EvolutionNote[]): string {
  if (notes.length === 0) return 'Aucune note d’évolution récente trouvée.';
  return notes.map((note) => {
    const date = note.date ?? 'date inconnue';
    const fact = note.facts[0] ?? 'Aucun fait détaillé dans la section.';
    const activation = note.activation === 'unspecified' ? '' : ` Activation : ${note.activation}.`;
    return `- ${date} — ${note.title} : ${fact}${activation}`;
  }).join('\n');
}

function cacheIsValid(value: unknown, source: { mtimeMs: number; size: number }): value is EvolutionCacheFile {
  if (!value || typeof value !== 'object') return false;
  const cache = value as Partial<EvolutionCacheFile>;
  return (
    cache.schemaVersion === 1 &&
    cache.source?.mtimeMs === source.mtimeMs &&
    cache.source?.size === source.size &&
    Array.isArray(cache.notes)
  );
}

/** Read, cache, and return the project's structured evolution notes. */
export async function readEvolutionNotes(
  options: ReadEvolutionNotesOptions = {},
): Promise<EvolutionNote[]> {
  const workDir = path.resolve(options.workDir ?? process.cwd());
  const changelogPath = path.resolve(options.changelogPath ?? path.join(workDir, 'CHANGELOG.md'));
  const cachePath = path.resolve(
    options.cachePath ?? path.join(workDir, '.codebuddy', 'self-model', 'evolution.json'),
  );
  const readFile = options.readFile ?? ((filePath: string) => fs.readFile(filePath, 'utf8'));
  const writeFile = options.writeFile ?? ((filePath: string, content: string) => fs.writeFile(filePath, content, 'utf8'));
  const mkdir = options.mkdir ?? ((directory: string) => fs.mkdir(directory, { recursive: true }));

  let source: { mtimeMs: number; size: number };
  let markdown: string;
  try {
    const stat = await fs.stat(changelogPath);
    source = { mtimeMs: stat.mtimeMs, size: stat.size };
    markdown = await readFile(changelogPath);
  } catch {
    return [];
  }

  try {
    const cached = JSON.parse(await readFile(cachePath)) as unknown;
    if (cacheIsValid(cached, source)) return cached.notes;
  } catch {
    // A missing or corrupt cache is rebuilt from the source below.
  }

  const notes = parseEvolutionNotes(markdown);
  try {
    await mkdir(path.dirname(cachePath));
    await writeFile(cachePath, JSON.stringify({ schemaVersion: 1, source, notes }, null, 2));
  } catch {
    // Read-only installs still get the parsed model; caching is best-effort.
  }
  return notes;
}
