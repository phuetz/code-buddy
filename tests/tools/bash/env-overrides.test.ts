import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  CONTROLLED_SUBPROCESS_ENV,
  buildBashEnvPrelude,
} from '../../../src/tools/bash/env-overrides.js';

/**
 * Issue #126 — tests for buildBashEnvPrelude().
 *
 * The prelude is prepended to every bash command by `bash-tool.ts`, so a value
 * that is not quoted literally can either break the command or be expanded by
 * the shell. These tests pin the contract without touching production code.
 */

/** Run a shell snippet through a real bash and return its raw stdout. */
function runBash(command: string): string {
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`bash exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

/** Split a NUL-terminated `printf '%s\0'` payload into its fields. */
function splitNul(payload: string): string[] {
  const fields = payload.split('\0');
  // The trailing NUL produces one empty trailing field: drop it.
  if (fields[fields.length - 1] === '') {
    fields.pop();
  }
  return fields;
}

describe('buildBashEnvPrelude — default controlled environment', () => {
  it('exports every controlled variable with its literal value', () => {
    const prelude = buildBashEnvPrelude();

    for (const [key, value] of Object.entries(CONTROLLED_SUBPROCESS_ENV)) {
      expect(prelude).toContain(`export ${key}='${value}'`);
    }
  });

  it('covers the whole controlled set and nothing else', () => {
    const prelude = buildBashEnvPrelude();
    const exportedKeys = [...prelude.matchAll(/export ([A-Z0-9_]+)=/g)].map((m) => m[1]);

    expect(exportedKeys).toEqual(Object.keys(CONTROLLED_SUBPROCESS_ENV));
  });

  it('returns an empty string for an empty environment', () => {
    expect(buildBashEnvPrelude({})).toBe('');
  });

  it('separates entries with "; " and adds no trailing separator', () => {
    const prelude = buildBashEnvPrelude({ A: '1', B: '2' });

    expect(prelude).toBe("export A='1'; export B='2'");
    expect(prelude.endsWith('; ')).toBe(false);
  });
});

describe('buildBashEnvPrelude — literal quoting', () => {
  it('keeps spaces, dollars, semicolons and newlines inside single quotes', () => {
    const prelude = buildBashEnvPrelude({
      SPACES: 'a b  c',
      DOLLARS: '$HOME and $(echo pwned) and ${PATH}',
      SEMIS: 'a;b;c',
      NEWLINE: 'line1\nline2',
    });

    expect(prelude).toContain("export SPACES='a b  c'");
    expect(prelude).toContain("export DOLLARS='$HOME and $(echo pwned) and ${PATH}'");
    expect(prelude).toContain("export SEMIS='a;b;c'");
    expect(prelude).toContain("export NEWLINE='line1\nline2'");
  });

  it("escapes a single quote as the '\\'' sequence", () => {
    const prelude = buildBashEnvPrelude({ APOS: "it's" });

    expect(prelude).toBe("export APOS='it'\\''s'");
  });

  it('escapes every apostrophe in a value with several of them', () => {
    const prelude = buildBashEnvPrelude({ MANY: "a'b'c" });

    expect(prelude).toBe("export MANY='a'\\''b'\\''c'");
  });

  it('handles an empty value', () => {
    expect(buildBashEnvPrelude({ EMPTY: '' })).toBe("export EMPTY=''");
  });
});

describe('buildBashEnvPrelude — deterministic key order', () => {
  it('is stable across calls and follows insertion order, not alphabetical', () => {
    const env = { ZETA: '1', ALPHA: '2', MID: '3' };

    const first = buildBashEnvPrelude(env);
    const second = buildBashEnvPrelude(env);

    expect(first).toBe(second);
    expect(first).toBe("export ZETA='1'; export ALPHA='2'; export MID='3'");
  });

  it('preserves the declaration order of CONTROLLED_SUBPROCESS_ENV', () => {
    const keys = [...buildBashEnvPrelude().matchAll(/export ([A-Z0-9_]+)=/g)].map((m) => m[1]);

    expect(keys).toEqual(Object.keys(CONTROLLED_SUBPROCESS_ENV));
  });
});

describe.skipIf(process.platform === 'win32')('buildBashEnvPrelude — real bash round-trip', () => {
  it('passes hostile values through without command substitution', () => {
    const env: Record<string, string> = {
      PLAIN: 'plain',
      SPACES: 'a b  c',
      APOS: "it's",
      DOLLARS: '$HOME',
      SUBSHELL: '$(echo pwned)',
      BACKTICK: '`echo pwned`',
      SEMIS: 'a;b;c',
      NEWLINE: 'line1\nline2',
      EMPTY: '',
      DOUBLEQUOTE: 'say "hi"',
      GLOB: '*',
      BACKSLASH: 'a\\b',
    };

    const prelude = buildBashEnvPrelude(env);
    const keys = Object.keys(env);
    const printf = `printf '%s\\0' ${keys.map((k) => `"$${k}"`).join(' ')}`;
    const stdout = runBash(`${prelude}\n${printf}`);

    expect(splitNul(stdout)).toEqual(keys.map((k) => env[k]));
  });

  it('does not execute a command hidden in a value', () => {
    const env = { TRAP: '$(echo pwned); echo second' };
    const prelude = buildBashEnvPrelude(env);

    const stdout = runBash(`${prelude}\nprintf '%s\\0' "$TRAP"`);

    expect(splitNul(stdout)).toEqual(['$(echo pwned); echo second']);
    // The literal marker appears once, inside the value — never as command output.
    expect(stdout.match(/pwned/g)).toHaveLength(1);
  });

  it('exports the default controlled variables in a real shell', () => {
    const prelude = buildBashEnvPrelude();
    const keys = Object.keys(CONTROLLED_SUBPROCESS_ENV);
    const printf = `printf '%s\\0' ${keys.map((k) => `"$${k}"`).join(' ')}`;
    const stdout = runBash(`${prelude}\n${printf}`);

    expect(splitNul(stdout)).toEqual(keys.map((k) => CONTROLLED_SUBPROCESS_ENV[k]));
  });
});
