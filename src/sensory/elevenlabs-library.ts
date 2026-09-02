/**
 * ElevenLabs voice library — read-only lookup into the phrases already SYNTHESIZED
 * and PAID FOR in Lisa's real voice.
 *
 * Why this exists: `~/.codebuddy/tts-elevenlabs-permanent/` holds 6 400+ short
 * conversational replies ("Coucou Patrice. Je suis là.", "Je t'entends, on peut
 * ralentir.") in the ElevenLabs voice, each paid once and reusable for free.
 * MySoulmate and the phone assistant already consume it through symlinks — the
 * robot, which speaks every day, did not. This module closes that gap.
 *
 * It sits BEFORE synthesis on the speak hot path, so it follows the same contract
 * as {@link TtsCache}: **read-only, best-effort, never-throws**. Any failure —
 * missing index, corrupt JSON, deleted audio — returns `null` and the caller falls
 * back to its normal synthesis. It never writes, never deletes: those files were
 * paid for, and the shared library is not ours to prune.
 *
 * @module sensory/elevenlabs-library
 */
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger.js';

/** One synthesized phrase in the shared library. */
export interface VoiceLibraryEntry {
  /** Absolute path to the audio file (.wav or .mp3). */
  file: string;
  /** The exact text that was synthesized. */
  text: string;
  /** The voice descriptor recorded at synthesis time. */
  voice: string;
}

interface RawEntry {
  key?: string;
  text?: string;
  voice?: string;
  file?: string;
}

export interface VoiceLibraryOptions {
  /** Library directory (default ~/.codebuddy/tts-elevenlabs-permanent). */
  dir?: string;
  /** Skip the library entirely — for tests, or to force plain synthesis. */
  disabled?: boolean;
}

/**
 * Normalize a phrase for matching.
 *
 * Two phrases that a listener would hear as identical must match: the library was
 * built over months by different tools, so the same sentence can differ by a
 * trailing space, a curly vs straight apostrophe, or capitalization. We do NOT
 * strip accents or punctuation — "Oui." and "Oui !" are different deliveries, and
 * playing the wrong one would be worse than synthesizing fresh.
 */
export function normalizePhrase(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Read-only index over the paid ElevenLabs phrases.
 *
 * The index is loaded once, lazily, on first lookup — the speak path must not pay
 * for a 6 400-entry JSON parse until it actually asks for something.
 */
export class ElevenLabsVoiceLibrary {
  private readonly dir: string;
  private readonly disabled: boolean;
  private byPhrase: Map<string, VoiceLibraryEntry> | null = null;
  private loadFailed = false;

  constructor(opts: VoiceLibraryOptions = {}) {
    this.dir =
      opts.dir ??
      process.env.CODEBUDDY_TTS_LIBRARY_DIR ??
      path.join(os.homedir(), '.codebuddy', 'tts-elevenlabs-permanent');
    this.disabled = opts.disabled ?? process.env.CODEBUDDY_TTS_LIBRARY === 'off';
  }

  /** Lazily parse `index.json`. Any failure disables the library for this process. */
  private load(): Map<string, VoiceLibraryEntry> | null {
    if (this.disabled || this.loadFailed) return null;
    if (this.byPhrase) return this.byPhrase;

    try {
      const raw = fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8');
      const parsed = JSON.parse(raw) as { entries?: RawEntry[] } | RawEntry[];
      const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
      const map = new Map<string, VoiceLibraryEntry>();

      for (const entry of entries) {
        if (!entry?.text || !entry.file) continue;
        const key = normalizePhrase(entry.text);
        // First writer wins: the library is append-only, so the earliest synthesis
        // of a phrase is the one that has been heard and validated.
        if (map.has(key)) continue;
        map.set(key, {
          file: path.isAbsolute(entry.file) ? entry.file : path.join(this.dir, entry.file),
          text: entry.text,
          voice: entry.voice ?? '',
        });
      }

      this.byPhrase = map;
      logger.info(`[voice-library] ${map.size} paid phrase(s) available from ${this.dir}`);
      return map;
    } catch (err) {
      // Never throw on the speak path: a missing or corrupt library simply means
      // "synthesize normally", which is exactly today's behaviour.
      this.loadFailed = true;
      logger.warn(
        `[voice-library] unavailable, falling back to synthesis: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Find an already-paid recording of `text`, or `null` to synthesize normally.
   *
   * The audio file is verified to still exist and be non-empty before being
   * returned — an index entry whose file was deleted must not silently hand back a
   * path that the player would fail on.
   */
  lookup(text: string): VoiceLibraryEntry | null {
    if (!text?.trim()) return null;
    const index = this.load();
    if (!index) return null;

    const hit = index.get(normalizePhrase(text));
    if (!hit) return null;

    try {
      if (fs.statSync(hit.file).size <= 0) return null;
    } catch {
      return null;
    }
    return hit;
  }

  /** Number of indexed phrases, or 0 when the library is unavailable. */
  size(): number {
    return this.load()?.size ?? 0;
  }

  /**
   * Return a **throwaway WAV copy** of the paid recording for `text`, or `null`.
   *
   * Two reasons this is not simply the library path:
   *
   * 1. **The caller unlinks what it plays.** `sayNow` deletes the file after
   *    playback — handing it a library path would erase an audio that was paid
   *    for. Copy-on-hit is the same contract as the TTS cache.
   * 2. **The player is `aplay`, which only reads WAV.** The library holds both
   *    `.wav` and `.mp3`; an mp3 is transcoded with ffmpeg. If ffmpeg is missing
   *    or fails we return `null` and the caller synthesizes normally — staying
   *    silent would be worse than not using the library.
   */
  copyForPlayback(text: string, tmpDir: string = os.tmpdir()): string | null {
    const hit = this.lookup(text);
    if (!hit) return null;

    const dest = path.join(tmpDir, `cb-voicelib-${process.pid}-${Date.now()}-${counter++}.wav`);
    try {
      if (path.extname(hit.file).toLowerCase() === '.wav') {
        fs.copyFileSync(hit.file, dest);
      } else {
        const res = spawnSync(
          process.env.CODEBUDDY_FFMPEG_BIN ?? 'ffmpeg',
          ['-y', '-v', 'error', '-i', hit.file, dest],
          { stdio: 'ignore', timeout: 15_000 },
        );
        if (res.status !== 0) throw new Error(`ffmpeg exit ${res.status}`);
      }
      if (fs.statSync(dest).size <= 0) throw new Error('empty copy');
      return dest;
    } catch (err) {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* nothing to clean */
      }
      logger.warn(
        `[voice-library] could not prepare "${hit.text.slice(0, 40)}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}

let counter = 0;

let shared: ElevenLabsVoiceLibrary | null = null;

/** Process-wide library — the index is parsed once, then reused. */
export function getVoiceLibrary(): ElevenLabsVoiceLibrary {
  shared ??= new ElevenLabsVoiceLibrary();
  return shared;
}

/** Reset the shared instance (tests only). */
export function resetVoiceLibrary(): void {
  shared = null;
}

/** A voice descriptor that identifies a paid ElevenLabs rendition. */
export function isPaidElevenLabsVoice(voice: string | undefined): boolean {
  return Boolean(voice?.trim().toLowerCase().startsWith('elevenlabs:'));
}

/** How long a lock file may sit before it is treated as abandoned by a dead writer. */
const LOCK_STALE_MS = 10_000;

/**
 * Take an exclusive lock on the shared index, run `fn`, release.
 *
 * The index is read by three products (MySoulmate, the phone assistant, the robot)
 * and one of them updates it with a naive read-modify-write. A lock cannot fix that
 * writer from here, but it keeps OUR window closed and lets concurrent robot turns
 * queue instead of racing. Returns false when the lock could not be taken — the
 * caller then simply skips publishing, which costs a future re-synthesis and
 * nothing else.
 */
function withIndexLock(lockPath: string, fn: () => void): boolean {
  let fd: number | undefined;
  try {
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch {
      // A lock left behind by a killed process must not block the library forever.
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age < LOCK_STALE_MS) return false;
      fs.unlinkSync(lockPath);
      fd = fs.openSync(lockPath, 'wx');
    }
    fn();
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* someone else cleaned it */
    }
  }
}

/**
 * Publish a freshly PAID rendition into the shared library, so the other products
 * get it for free.
 *
 * Doctrine (Patrice, 2026-08-16): a phrase in Lisa's ElevenLabs voice is a
 * cross-product asset, paid once and reused everywhere. Until now Code Buddy only
 * READ this library: everything the robot paid for landed in its private TTS cache
 * — which also evicts — and MySoulmate and the phone assistant never saw it.
 *
 * Append-only and conservative by design:
 * - an existing phrase is never overwritten (the reader takes the first entry, and
 *   those files were paid for);
 * - the index is written to a temp file and renamed, so a concurrent reader never
 *   sees a half-written 6 000-entry JSON;
 * - the text is stored whitespace-collapsed but CASE-PRESERVED, because MySoulmate's
 *   own lookup is case-sensitive — lowercasing here would hide the entry from it;
 * - every failure is swallowed: publishing is a bonus, never a reason to break speech.
 *
 * @returns the stored file path, or null when nothing was published.
 */
export function publishToVoiceLibrary(
  text: string,
  voice: string | undefined,
  srcFile: string,
  dir: string = process.env.CODEBUDDY_TTS_LIBRARY_DIR ??
    path.join(os.homedir(), '.codebuddy', 'tts-elevenlabs-permanent'),
): string | null {
  if (process.env.CODEBUDDY_TTS_LIBRARY_PUBLISH === 'off') return null;
  if (!isPaidElevenLabsVoice(voice)) return null;
  const canonical = text?.trim().replace(/\s+/g, ' ');
  if (!canonical) return null;

  const indexPath = path.join(dir, 'index.json');
  let published: string | null = null;

  const ok = withIndexLock(path.join(dir, 'index.lock'), () => {
    fs.mkdirSync(dir, { recursive: true });
    let parsed: { voice?: string; count?: number; entries?: RawEntry[] } = {};
    try {
      parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as typeof parsed;
    } catch {
      /* first write, or an unreadable index we must not clobber blindly */
      if (fs.existsSync(indexPath)) throw new Error('index unreadable — refusing to overwrite');
    }
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const wanted = normalizePhrase(canonical);
    if (entries.some((e) => e?.text && normalizePhrase(e.text) === wanted)) return;

    // Hash the full phrase, not a prefix: the library's own naming truncates to the
    // first 16 characters of text, which would collide across similar openers.
    const key = createHash('sha256').update(`${wanted}\u0000${voice}`).digest('hex').slice(0, 32);
    const file = `${key}${path.extname(srcFile).toLowerCase() || '.wav'}`;
    const dest = path.join(dir, file);
    if (!fs.existsSync(dest)) {
      const tmp = `${dest}.${process.pid}.tmp`;
      fs.copyFileSync(srcFile, tmp);
      if (fs.statSync(tmp).size <= 0) {
        fs.unlinkSync(tmp);
        throw new Error('refusing to publish an empty rendition');
      }
      fs.renameSync(tmp, dest);
    }

    entries.push({ key, text: canonical, voice, file });
    const next = { ...parsed, voice: parsed.voice ?? voice, count: entries.length, entries };
    const tmpIndex = `${indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpIndex, JSON.stringify(next, null, 1));
    fs.renameSync(tmpIndex, indexPath);
    published = dest;
  });

  if (!ok) return null;
  if (published) {
    logger.info(`[voice-library] published a paid phrase for every product to reuse`);
    shared = null; // the in-process index must see it on the next lookup
  }
  return published;
}
