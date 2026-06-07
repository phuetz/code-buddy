/**
 * Regression test locking in the multi-line command fix.
 *
 * Background: BLOCKED_PATTERNS once contained a control-char regex that
 * wrongly matched tab (0x09), LF (0x0a) and CR (0x0d), blocking ALL
 * multi-line commands (heredocs, scripts). It was narrowed so those three
 * whitespace control chars pass, mirroring BLOCKED_CONTROL_CHARS (which
 * already excludes \t \n \r). This test pins that behavior so it cannot
 * silently regress, while proving the genuinely dangerous control chars
 * (NUL, BEL, ESC/ANSI) and the hard command blocklist stay blocked.
 *
 * Control characters are built with String.fromCharCode so no literal
 * escape ever transits the shell when this file is edited/read.
 */

import { describe, it, expect } from 'vitest';
import { validateCommand } from '../../src/tools/bash/command-validator.js';

const TAB = String.fromCharCode(9); // \t
const NUL = String.fromCharCode(0); // \0
const BEL = String.fromCharCode(7); // \a
const ESC = String.fromCharCode(27); // \e (start of ANSI escape sequence)

describe('validateCommand — multi-line commands stay valid', () => {
  it('allows a heredoc write spanning multiple lines', () => {
    const cmd = "cat > /tmp/x <<'EOF'\nline1\nline2\nEOF";
    expect(validateCommand(cmd).valid).toBe(true);
  });

  it('allows a multi-line two-command script joined by newlines', () => {
    const cmd = ['echo first', 'echo second'].join('\n');
    expect(validateCommand(cmd).valid).toBe(true);
  });

  it('allows a command containing a tab character', () => {
    const cmd = `printf 'a${TAB}b'`;
    expect(validateCommand(cmd).valid).toBe(true);
  });
});

describe('validateCommand — dangerous control chars stay blocked', () => {
  it('blocks a command containing a NUL byte', () => {
    const cmd = `echo${NUL}x`;
    expect(validateCommand(cmd).valid).toBe(false);
  });

  it('blocks a command containing a BEL byte', () => {
    const cmd = `echo${BEL}x`;
    expect(validateCommand(cmd).valid).toBe(false);
  });

  it('blocks a command containing an ANSI escape sequence', () => {
    const cmd = `echo ${ESC}[31m`;
    expect(validateCommand(cmd).valid).toBe(false);
  });
});

describe('validateCommand — hard command blocklist stays blocked', () => {
  it('blocks rm -rf /', () => {
    expect(validateCommand('rm -rf /').valid).toBe(false);
  });

  it('blocks chmod', () => {
    expect(validateCommand('chmod +x /tmp/x.sh').valid).toBe(false);
  });
});
