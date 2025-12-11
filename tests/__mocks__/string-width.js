// Mock for string-width ESM module
// Returns approximate string width (ASCII characters = 1, others = 2)

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*m/g;

function stringWidth(str) {
  if (typeof str !== 'string') return 0;

  // Remove ANSI escape codes first
  const stripped = str.replace(ANSI_REGEX, '');

  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0);
    // Basic heuristic: ASCII is width 1, CJK/emoji are width 2
    if (code <= 0x7F) {
      width += 1;
    } else if (code >= 0x1100 && code <= 0x11FF || // Hangul Jamo
               code >= 0x2E80 && code <= 0x9FFF || // CJK
               code >= 0xAC00 && code <= 0xD7AF || // Hangul
               code >= 0xF900 && code <= 0xFAFF || // CJK Compatibility
               code >= 0xFE10 && code <= 0xFE1F || // Vertical forms
               code >= 0xFE30 && code <= 0xFE6F || // CJK Compatibility Forms
               code >= 0xFF00 && code <= 0xFF60 || // Fullwidth
               code >= 0xFFE0 && code <= 0xFFE6 || // Fullwidth symbols
               code >= 0x1F300 && code <= 0x1F9FF) { // Emoji
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

module.exports = stringWidth;
module.exports.default = stringWidth;
