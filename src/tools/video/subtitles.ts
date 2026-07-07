/**
 * Subtitles — karaoke (word-by-word) captions for the film producer, as a
 * burnable ASS (Advanced SubStation Alpha) string.
 *
 * We do NOT transcribe the synthesized voice (an STT pass garbles proper nouns —
 * "Code Buddy" → "budile"). Instead we start from the KNOWN narration text and
 * estimate per-word timings proportionally (letter count + punctuation pauses).
 * Piper reads at an even pace, so this tracks the voice well while keeping the
 * text 100% correct. Pure + unit-testable; the ffmpeg `subtitles=` burn lives in
 * the scene renderer.
 *
 * @module tools/video/subtitles
 */

export interface WordTiming {
  /** Start time in seconds (relative to the narration start). */
  start: number;
  /** End time in seconds. */
  end: number;
  word: string;
}

export interface KaraokeStyle {
  /** Video width/height the ASS is authored against (must match the burn target). */
  playResX?: number;
  playResY?: number;
  fontName?: string;
  fontSize?: number;
  /** ASS colour &HAABBGGRR — already-sung / current word. */
  primary?: string;
  /** ASS colour — upcoming (not-yet-sung) words. */
  secondary?: string;
  outline?: number;
  marginV?: number;
  /** Max words per displayed line. */
  wordsPerLine?: number;
}

const DEFAULT_STYLE: Required<KaraokeStyle> = {
  playResX: 1920,
  playResY: 1080,
  fontName: 'DejaVu Sans',
  fontSize: 50,
  primary: '&H00FFFFFF', // white (sung)
  secondary: '&H00D9B36A', // code-buddy blue (upcoming) — note ASS is &HAABBGGRR
  outline: 3,
  marginV: 78,
  wordsPerLine: 6,
};

const WORD_LETTERS = /[^\wàâäéèêëïîôöùûüÿçœæ']/gi;

/**
 * Estimate per-word timings for `text` spanning `duration` seconds. Weight each
 * word by its letter count plus a pause after punctuation (mimicking the voice's
 * natural breaks). Pure.
 */
export function estimateWordTimings(text: string, duration: number): WordTiming[] {
  const raw = (text ?? '').trim().split(/\s+/).filter(Boolean);
  if (raw.length === 0 || !(duration > 0)) return [];
  const weights = raw.map((w) => {
    const letters = Math.max(1, w.replace(WORD_LETTERS, '').length);
    const extra = /[.!?:]$/.test(w) ? 4.0 : /[,;]$/.test(w) ? 2.2 : 0;
    return letters + 1.6 + extra;
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const scale = duration / total;
  const out: WordTiming[] = [];
  let t = 0;
  for (let i = 0; i < raw.length; i++) {
    const d = weights[i]! * scale;
    out.push({ start: round2(t), end: round2(t + d), word: raw[i]! });
    t += d;
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format seconds as ASS time `H:MM:SS.cs`. */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${pad(c)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Escape a word for safe inclusion in an ASS Dialogue line. */
function sanitizeWord(w: string): string {
  return w.replace(/[{}\\]/g, '').replace(/\n/g, ' ');
}

/**
 * Build a full ASS document that karaoke-highlights the narration word by word.
 * `leadSec` offsets all times (the narration usually starts a beat into the clip).
 * Pure — returns the ASS string to write next to the clip and burn via ffmpeg.
 */
export function buildKaraokeAss(
  text: string,
  durationSec: number,
  leadSec = 0,
  style: KaraokeStyle = {}
): string {
  const st = { ...DEFAULT_STYLE, ...style };
  const words = estimateWordTimings(text, durationSec);
  const header =
    `[Script Info]\nScriptType: v4.00+\nPlayResX: ${st.playResX}\nPlayResY: ${st.playResY}\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ` +
    `Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, ` +
    `Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: K,${st.fontName},${st.fontSize},${st.primary},${st.secondary},&H00101418,&H90000000,` +
    `-1,0,0,0,100,100,0,0,1,${st.outline},1,2,200,200,${st.marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const lines: string[] = [];
  for (let i = 0; i < words.length; i += st.wordsPerLine) {
    const group = words.slice(i, i + st.wordsPerLine);
    const start = group[0]!.start + leadSec;
    const end = group[group.length - 1]!.end + leadSec;
    let prev = start;
    let txt = '';
    for (const wd of group) {
      const ws = wd.start + leadSec;
      const we = wd.end + leadSec;
      const gap = Math.max(0, Math.round((ws - prev) * 100));
      if (gap) txt += `{\\k${gap}}`;
      const dur = Math.max(1, Math.round((we - ws) * 100));
      txt += `{\\k${dur}}${sanitizeWord(wd.word)} `;
      prev = we;
    }
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},K,,0,0,0,,${txt.trim()}`);
  }
  return header + lines.join('\n') + '\n';
}
