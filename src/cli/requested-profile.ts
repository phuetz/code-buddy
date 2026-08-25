/**
 * Read `--profile` from argv before Commander parses, so it can hide commands
 * for `buddy --help`. A following token that starts with `-` is NOT a profile
 * name (`buddy --profile --help` used to look up a profile literally named
 * "--help").
 */

export type RequestedProfile =
  | { kind: 'none' }
  | { kind: 'missing' }
  | { kind: 'value'; name: string };

export function getRequestedProfile(argv: readonly string[]): RequestedProfile {
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') break;
    if (arg === '--profile') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) return { kind: 'missing' };
      return { kind: 'value', name: next };
    }
    if (arg?.startsWith('--profile=')) {
      const name = arg.slice('--profile='.length);
      if (!name) return { kind: 'missing' };
      return { kind: 'value', name };
    }
  }
  return { kind: 'none' };
}
