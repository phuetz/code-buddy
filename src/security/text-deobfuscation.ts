/**
 * Text de-obfuscation for static security scanners.
 *
 * Prompt-injection / jailbreak content that is INJECTED into an LLM context
 * (skills, imported guidance) is read by the model even when a human-invisible
 * trick hides it from a raw regex: zero-width characters, soft hyphens,
 * hyphenated word-wraps across lines, HTML comment/tag wrappers, and Cyrillic
 * homoglyphs. This helper canonicalizes such text so a regex firewall sees what
 * the model sees.
 *
 * NOTE: the strategy gate (`src/agent/self-improvement/strategy-gate.ts`) keeps
 * its own equivalent `normalizeDirectiveText` — that module is reserved by the
 * self-improvement lane, so this is an intentional independent copy in the
 * security layer rather than a cross-lane import. Keep the two in sync.
 */
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
