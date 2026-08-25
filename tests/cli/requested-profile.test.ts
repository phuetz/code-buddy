import { describe, expect, it } from 'vitest';
import { getRequestedProfile } from '../../src/cli/requested-profile.js';

describe('getRequestedProfile', () => {
  it('reads a profile name', () => {
    expect(getRequestedProfile(['node', 'buddy', '--profile', 'core', '--help'])).toEqual({
      kind: 'value',
      name: 'core',
    });
    expect(getRequestedProfile(['node', 'buddy', '--profile=nvidia', 'loop', 'x'])).toEqual({
      kind: 'value',
      name: 'nvidia',
    });
  });

  it('does not treat the next flag as a profile name', () => {
    expect(getRequestedProfile(['node', 'buddy', '--profile', '--help'])).toEqual({
      kind: 'missing',
    });
    expect(getRequestedProfile(['node', 'buddy', '--profile='])).toEqual({ kind: 'missing' });
    expect(getRequestedProfile(['node', 'buddy', '--profile'])).toEqual({ kind: 'missing' });
  });

  it('is silent when the flag is absent', () => {
    expect(getRequestedProfile(['node', 'buddy', '--help'])).toEqual({ kind: 'none' });
  });
});
