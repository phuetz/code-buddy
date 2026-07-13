import { basename, extname } from 'path';
import { readFile, stat } from 'fs/promises';
import type {
  MeetingNotesDependencies,
  MeetingNotesInput,
  MeetingTranscriptSegment,
} from './types.js';

export const MEETING_MEDIA_EXTENSIONS = new Set([
  '.aac', '.aiff', '.avi', '.flac', '.m4a', '.m4v', '.mkv', '.mov', '.mp3',
  '.mp4', '.mpeg', '.mpg', '.oga', '.ogg', '.opus', '.wav', '.webm', '.wma',
]);
export const MEETING_TEXT_EXTENSIONS = new Set(['.json', '.md', '.srt', '.txt', '.vtt']);
export const MAX_MEETING_TRANSCRIPT_CHARACTERS = 8 * 1024 * 1024;
export const MAX_MEETING_TEXT_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_MEETING_MEDIA_FILE_BYTES = 1024 * 1024 * 1024;

const SENSITIVE_MEETING_BASENAMES = new Set([
  '.env', 'credentials', 'credentials.json', 'id_ed25519', 'id_rsa',
  'secrets', 'secrets.json', 'settings.json',
]);

export function assertSupportedMeetingFilePath(filePath: string): void {
  const extension = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();
  const segments = filePath.split(/[\\/]+/u).map((segment) => segment.toLowerCase());
  if (
    SENSITIVE_MEETING_BASENAMES.has(name) ||
    name.startsWith('.env.') ||
    ['.key', '.p12', '.pem', '.pfx'].includes(extension) ||
    segments.some((segment) => segment === '.git' || segment === '.codebuddy')
  ) {
    throw new Error(`Sensitive files cannot be used as meeting input: ${name}`);
  }
  if (!MEETING_TEXT_EXTENSIONS.has(extension) && !MEETING_MEDIA_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported meeting input extension "${extension || '(none)'}"; use TXT, MD, SRT, VTT, JSON, audio, or video`,
    );
  }
}

function assertTranscriptBounds(segments: MeetingTranscriptSegment[]): void {
  if (segments.length > 100_000) throw new Error('Meeting transcript has too many segments');
  let characters = 0;
  for (const segment of segments) {
    characters += segment.text.length + (segment.speaker?.length ?? 0);
    if (characters > MAX_MEETING_TRANSCRIPT_CHARACTERS) {
      throw new Error('Meeting transcript exceeds the 8 MiB text safety limit');
    }
  }
}

interface IngestedTranscript {
  segments: MeetingTranscriptSegment[];
  source: { kind: 'text' | 'json' | 'media'; name: string | null };
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) / 1000 : null;
}

/** Parse `HH:MM:SS(.mmm)` or `MM:SS(.mmm)` into seconds. */
export function parseTranscriptTimestamp(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  const pieces = normalized.split(':');
  if (pieces.length < 2 || pieces.length > 3) return null;
  const values = pieces.map((piece) => Number(piece));
  if (values.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (pieces.length === 2) {
    const [minutes, seconds] = values;
    if (minutes === undefined || seconds === undefined || seconds >= 60) return null;
    return Math.round((minutes * 60 + seconds) * 1000) / 1000;
  }
  const [hours, minutes, seconds] = values;
  if (hours === undefined || minutes === undefined || seconds === undefined || minutes >= 60 || seconds >= 60) {
    return null;
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000) / 1000;
}

function cleanSpeakerAndText(raw: string): { speaker: string | null; text: string } {
  const text = raw.trim().replace(/^[-–—]\s*/, '');
  const bracketed = /^\[([^\]]{1,60})\]\s+(.+)$/u.exec(text);
  if (bracketed?.[1] && bracketed[2]) {
    return { speaker: bracketed[1].trim(), text: bracketed[2].trim() };
  }
  const match = /^([^:\n]{1,60}):\s+(.+)$/u.exec(text);
  if (!match?.[1] || !match[2]) return { speaker: null, text };
  const candidate = match[1].trim();
  // Avoid treating URLs and ordinary prose containing a colon as speaker labels.
  if (/^(https?|file)$/i.test(candidate) || /[.!?]$/.test(candidate)) {
    return { speaker: null, text };
  }
  return { speaker: candidate, text: match[2].trim() };
}

function pushSegment(
  target: MeetingTranscriptSegment[],
  value: { startSeconds?: number | null; endSeconds?: number | null; speaker?: string | null; text: string },
): void {
  const text = value.text.trim();
  if (!text) return;
  target.push({
    sequence: target.length + 1,
    startSeconds: value.startSeconds ?? null,
    endSeconds: value.endSeconds ?? null,
    speaker: value.speaker?.trim() || null,
    text,
  });
}

/**
 * Parse plain text, SRT/VTT, and common `[timestamp] Speaker: text` exports.
 * Missing timestamps remain null rather than being invented.
 */
export function parseTextTranscript(text: string): MeetingTranscriptSegment[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const segments: MeetingTranscriptSegment[] = [];

  for (let index = 0; index < lines.length;) {
    const raw = lines[index]?.trim() ?? '';
    if (!raw || raw === 'WEBVTT') {
      index += 1;
      continue;
    }

    // SRT cue number or WebVTT cue identifier before a timestamp range.
    if (/-->/u.test(lines[index + 1] ?? '')) {
      index += 1;
      continue;
    }

    const range = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\]?\s*-->\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\]?(?:\s+.*)?$/u.exec(raw);
    if (range?.[1] && range[2]) {
      const cue: string[] = [];
      index += 1;
      while (index < lines.length) {
        const next = lines[index]?.trim() ?? '';
        if (!next) break;
        if (/^\d+$/.test(next) && /-->/u.test(lines[index + 1] ?? '')) break;
        if (/-->/u.test(next)) break;
        // Keep tags until the cue is assembled so WebVTT `<v Speaker>` can be
        // interpreted as diarization metadata; formatting tags are stripped below.
        cue.push(next);
        index += 1;
      }
      const cueText = cue.join(' ');
      const voice = /^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/iu.exec(cueText);
      const parsed = cleanSpeakerAndText((voice?.[2] ?? cueText).replace(/<[^>]+>/g, ''));
      pushSegment(segments, {
        startSeconds: parseTranscriptTimestamp(range[1]),
        endSeconds: parseTranscriptTimestamp(range[2]),
        speaker: parsed.speaker ?? voice?.[1]?.trim() ?? null,
        text: parsed.text,
      });
      continue;
    }

    const stamped = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\]?\s*(?:[-–—]\s*)?(.+)$/u.exec(raw);
    if (stamped?.[1] && stamped[2]) {
      const parsed = cleanSpeakerAndText(stamped[2]);
      pushSegment(segments, {
        startSeconds: parseTranscriptTimestamp(stamped[1]),
        ...parsed,
      });
      index += 1;
      continue;
    }

    const parsed = cleanSpeakerAndText(raw.replace(/<[^>]+>/g, ''));
    pushSegment(segments, parsed);
    index += 1;
  }

  return segments;
}

function pickArray(value: Record<string, unknown>): unknown[] | null {
  const candidates = [value.segments, value.transcript, value.utterances, value.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.segments)) return nested.segments;
    }
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Normalize common Whisper, diarization, and Code Buddy transcript JSON shapes. */
export function parseJsonTranscript(value: unknown): MeetingTranscriptSegment[] {
  if (typeof value === 'string') return parseTextTranscript(value);

  let items: unknown[] | null = Array.isArray(value) ? value : null;
  if (!items && value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.transcript === 'string') return parseTextTranscript(record.transcript);
    if (typeof record.text === 'string' && !pickArray(record)) return parseTextTranscript(record.text);
    items = pickArray(record);
  }
  if (!items) throw new Error('Unsupported transcript JSON: expected text or a segments/transcript/utterances/results array');

  const segments: MeetingTranscriptSegment[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      pushSegment(segments, cleanSpeakerAndText(item));
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const text = firstString(record, ['text', 'said', 'utterance', 'content']);
    if (!text) continue;
    const speaker = firstString(record, ['speaker', 'speaker_label', 'speakerLabel', 'name']);
    const startSeconds = finiteNonNegative(record.startSeconds ?? record.start ?? record.t_start ?? record.offset);
    const endSeconds = finiteNonNegative(record.endSeconds ?? record.end ?? record.t_end);
    pushSegment(segments, { startSeconds, endSeconds, speaker, text });
  }
  return segments;
}

async function transcribeMedia(
  path: string,
  deps: MeetingNotesDependencies,
): Promise<MeetingTranscriptSegment[]> {
  let transcribe = deps.transcribe;
  if (!transcribe) {
    const { transcribeLong } = await import('../tools/video/long-transcribe.js');
    transcribe = transcribeLong;
  }
  const timed = await transcribe(path);
  const segments: MeetingTranscriptSegment[] = [];
  for (const item of timed) {
    pushSegment(segments, {
      startSeconds: finiteNonNegative(item.t_start),
      endSeconds: finiteNonNegative(item.t_end),
      text: item.said,
    });
  }
  if (segments.length === 0) {
    throw new Error(`No speech could be transcribed from ${basename(path)}`);
  }
  return segments;
}

export async function ingestMeetingTranscript(
  input: MeetingNotesInput,
  deps: MeetingNotesDependencies = {},
): Promise<IngestedTranscript> {
  if (input.kind === 'text') {
    if (input.text.length > MAX_MEETING_TRANSCRIPT_CHARACTERS) {
      throw new Error('Meeting transcript exceeds the 8 MiB text safety limit');
    }
    const segments = parseTextTranscript(input.text);
    assertTranscriptBounds(segments);
    if (segments.length === 0) throw new Error('The text transcript is empty');
    return { segments, source: { kind: 'text', name: input.sourceName?.trim() || null } };
  }

  if (input.kind === 'json') {
    const segments = parseJsonTranscript(input.value);
    assertTranscriptBounds(segments);
    if (segments.length === 0) throw new Error('The JSON transcript contains no usable speech segments');
    return { segments, source: { kind: 'json', name: input.sourceName?.trim() || null } };
  }

  const name = basename(input.path);
  const extension = extname(input.path).toLowerCase();
  assertSupportedMeetingFilePath(input.path);
  const sourceStat = await stat(input.path);
  if (!sourceStat.isFile()) throw new Error(`Meeting input is not a regular file: ${name}`);
  if (MEETING_MEDIA_EXTENSIONS.has(extension)) {
    if (sourceStat.size > MAX_MEETING_MEDIA_FILE_BYTES) {
      throw new Error(`Meeting media exceeds the ${MAX_MEETING_MEDIA_FILE_BYTES}-byte safety limit`);
    }
    const segments = await transcribeMedia(input.path, deps);
    assertTranscriptBounds(segments);
    return {
      segments,
      source: { kind: 'media', name },
    };
  }

  if (sourceStat.size > MAX_MEETING_TEXT_FILE_BYTES) {
    throw new Error(`Meeting transcript file exceeds the ${MAX_MEETING_TEXT_FILE_BYTES}-byte safety limit`);
  }
  const raw = await readFile(input.path, 'utf8');
  if (extension === '.json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid transcript JSON in ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const segments = parseJsonTranscript(parsed);
    assertTranscriptBounds(segments);
    if (segments.length === 0) throw new Error(`The JSON transcript ${name} contains no usable speech segments`);
    return { segments, source: { kind: 'json', name } };
  }

  if (raw.includes('\0')) {
    throw new Error(`Unsupported binary meeting input: ${name}`);
  }
  const segments = parseTextTranscript(raw);
  assertTranscriptBounds(segments);
  if (segments.length === 0) throw new Error(`The transcript ${name} is empty`);
  return { segments, source: { kind: 'text', name } };
}
