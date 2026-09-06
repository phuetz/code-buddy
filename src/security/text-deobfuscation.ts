/**
 * Text de-obfuscation for static security scanners.
 *
 * Prompt-injection / jailbreak content that is INJECTED into an LLM context
 * (skills, imported guidance) is read by the model even when a human-invisible
 * trick hides it from a raw regex: zero-width characters, soft hyphens,
 * hyphenated word-wraps across lines, HTML comment/tag wrappers, homoglyphs,
 * bidi/format controls, percent-encoding, and a single layer of Base64.
 *
 * NOTE: the strategy gate (`src/agent/self-improvement/strategy-gate.ts`) keeps
 * its own equivalent `normalizeDirectiveText` — that module is reserved by the
 * self-improvement lane, so this is an intentional independent copy in the
 * security layer rather than a cross-lane import. Keep the two in sync.
 */

/** Hard cap so a huge skill cannot explode decode work. */
const MAX_SCAN_CHARS = 256 * 1024;
const MAX_PERCENT_BLOB = 8 * 1024;
const MAX_BASE64_BLOB = 8 * 1024;
const MAX_BASE64_BLOBS = 32;
const MIN_BASE64_CHARS = 16;

/**
 * Greek / leftover Cyrillic / IPA letters that look like Latin after a human
 * or an LLM reads them, but NFKC/NFKD will not fold. Accented Latin is handled
 * separately via NFKD + stripping combining marks (ă → a).
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  α: 'a', Α: 'A', ά: 'a', Ά: 'A',
  ε: 'e', Ε: 'E', έ: 'e', Έ: 'E',
  ι: 'i', Ι: 'I', ί: 'i', Ί: 'I', ϊ: 'i', ΐ: 'i',
  ο: 'o', Ο: 'O', ό: 'o', Ό: 'O',
  ρ: 'p', Ρ: 'P',
  τ: 't', Τ: 'T',
  υ: 'y', Υ: 'Y', ύ: 'y', ϋ: 'y',
  χ: 'x', Χ: 'X',
  κ: 'k', Κ: 'K',
  η: 'n',
  ν: 'v',
  ω: 'w',
  μ: 'u',
  ϲ: 'c', Ϲ: 'C', ς: 's', σ: 's', Σ: 'S',
  β: 'b', Β: 'B',
  ɑ: 'a', ɡ: 'g',
  // Cyrillic confusables (also applied in deobfuscateText; repeated here so
  // deobfuscateForScan is self-contained before that pass).
  о: 'o', О: 'O', а: 'a', А: 'A', е: 'e', Е: 'E',
  р: 'p', Р: 'P', с: 'c', С: 'C', і: 'i', І: 'I',
  у: 'y', У: 'Y', х: 'x', Х: 'X', ѕ: 's', ј: 'j',
};

function applyHomoglyphs(text: string): string {
  let out = '';
  for (const ch of text) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}

export function deobfuscateText(text: string): string {
  return text
    // Remove zero-width characters and soft hyphens
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, '')
    // Rejoin hyphenated words across lines: e.g. "jail-\nbreak" -> "jailbreak"
    .replace(/(\w+)-[\r\n]+\s*(\w+)/g, '$1$2')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Normalize unicode canonical composition
    .normalize('NFKC')
    // Map common Cyrillic confusable homoglyphs to Latin equivalents
    .replace(/\u043e/gi, 'o')
    .replace(/\u0430/gi, 'a')
    .replace(/\u0435/gi, 'e')
    .replace(/\u0440/gi, 'p')
    .replace(/\u0441/gi, 'c')
    .replace(/\u0456/gi, 'i')
    .replace(/\u0443/gi, 'y')
    .replace(/\u0445/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Safe layer of text de-obfuscation:
 * Strips format/bidi controls (\p{Cf}), applies homoglyph mappings,
 * unicode normalizations (NFKC/NFKD + diacritic strip), zero-width characters,
 * hyphenated line-wraps, and HTML comments/tags.
 * Safe for all pattern capabilities without risk of false positives from
 * decoding Base64 or URL-percent blobs.
 */
export function deobfuscateSafeForScan(text: string): string {
  const src = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  return foldSafeForScan(src);
}

function foldSafeForScan(text: string): string {
  const stripped = text.replace(/\p{Cf}/gu, '');
  const pre = applyHomoglyphs(stripped);
  const folded = pre
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '');
  const mapped = applyHomoglyphs(folded);
  return deobfuscateText(mapped);
}

/**
 * Scanner-facing de-obfuscation: one bounded pass that also folds bidi/format
 * controls, a single percent-decode, NFKC + diacritic strip, a homoglyph table,
 * and a single layer of strict Base64 (≥16 chars). Used by `scanSkillFirewall`
 * for prompt-injection capabilities.
 */
export function deobfuscateForScan(text: string): string {
  const src = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  const folded = foldForScan(src);
  const fromB64 = decodeBase64Blobs(src)
    .map((plain) => foldForScan(plain))
    .filter((plain) => plain.length > 0);
  if (fromB64.length === 0) return folded;
  return `${folded}\n${fromB64.join('\n')}`;
}

function foldForScan(text: string): string {
  const stripped = text.replace(/\p{Cf}/gu, '');
  const percentDecoded = decodePercentOnce(stripped);
  // Homoglyphs BEFORE NFKC: lunate sigma ϲ compatibility-maps to σ (then
  // "s"), but attackers use it as a Latin "c" lookalike.
  const pre = applyHomoglyphs(percentDecoded);
  const folded = pre
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '');
  const mapped = applyHomoglyphs(folded);
  return deobfuscateText(mapped);
}

function decodePercentOnce(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (blob) => {
    if (blob.length > MAX_PERCENT_BLOB) return blob;
    try {
      return decodeURIComponent(blob);
    } catch {
      try {
        return blob.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      } catch {
        return blob;
      }
    }
  });
}

/**
 * Strict standard Base64 (A–Z a–z 0–9 + /) with optional padding. One level
 * only: callers must not re-feed the result into this function.
 */
function decodeBase64Blobs(text: string): string[] {
  const out: string[] = [];
  const re = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null && out.length < MAX_BASE64_BLOBS) {
    const blob = match[0];
    if (blob.length > MAX_BASE64_BLOB) continue;
    const body = blob.replace(/=+$/u, '');
    if (body.length % 4 === 1) continue;
    const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
    let decoded: string;
    try {
      decoded = Buffer.from(padded, 'base64').toString('utf8');
    } catch {
      continue;
    }
    if (decoded.length < MIN_BASE64_CHARS / 4) continue;
    if (!/^[\t\n\r\x20-\x7E]+$/.test(decoded)) continue;
    out.push(decoded);
  }
  return out;
}
