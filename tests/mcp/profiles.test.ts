import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getMCPProfilesPath,
  loadMCPProfiles,
  removeMCPProfile,
  setActiveMCPProfile,
  upsertMCPProfile,
} from '../../src/mcp/profiles.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-mcp-profiles-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('MCP profiles', () => {
  it('returns an empty configuration before the first profile', () => {
    expect(loadMCPProfiles(temporaryDirectory())).toEqual({
      version: 1,
      activeProfile: null,
      profiles: {},
    });
  });

  it('creates a normalized, persistent profile', () => {
    const cwd = temporaryDirectory();
    const profile = upsertMCPProfile('edition', ['pubcommander', 'pubcommander', ' filesystem '], 'Editorial', cwd);

    expect(profile.servers).toEqual(['pubcommander', 'filesystem']);
    expect(loadMCPProfiles(cwd).profiles.edition).toEqual(profile);
    expect(fs.existsSync(getMCPProfilesPath(cwd))).toBe(true);
  });

  it('tracks activation and clears it when the profile is removed', () => {
    const cwd = temporaryDirectory();
    upsertMCPProfile('research', ['brave-search'], undefined, cwd);
    expect(setActiveMCPProfile('research', cwd).activeProfile).toBe('research');
    expect(removeMCPProfile('research', cwd)).toBe(true);
    expect(loadMCPProfiles(cwd).activeProfile).toBeNull();
  });

  it('rejects invalid names and empty profiles', () => {
    const cwd = temporaryDirectory();
    expect(() => upsertMCPProfile('../bad', ['server'], undefined, cwd)).toThrow('Profile names');
    expect(() => upsertMCPProfile('empty', [], undefined, cwd)).toThrow('at least one server');
  });
});
