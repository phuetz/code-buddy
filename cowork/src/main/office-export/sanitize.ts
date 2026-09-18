/**
 * OOXML-safe text and suggested filenames for local office export.
 *
 * @module main/office-export/sanitize
 */

export function isInvalidXmlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return false;
  return (
    (codePoint >= 0x00 && codePoint <= 0x08) ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0xfffe ||
    codePoint === 0xffff
  );
}

export function sanitizeXmlText(value: string): string {
  let out = '';
  for (const char of value) {
    if (!isInvalidXmlCharacter(char)) out += char;
  }
  return out;
}

export function slugifyExportName(title: string, fallback = 'export'): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
