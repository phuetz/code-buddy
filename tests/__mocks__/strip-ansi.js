// Mock for strip-ansi ESM module
// Removes ANSI escape codes from a string

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(str) {
  if (typeof str !== 'string') return '';
  // Match ANSI escape sequences
  return str.replace(ANSI_REGEX, '');
}

module.exports = stripAnsi;
module.exports.default = stripAnsi;
