import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getPublicKey,
  signManifest,
  verifyManifest,
} from '../../src/skills/skill-signing.js';

let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-skill-signing-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe('skill-signing', () => {
  it('signs and verifies canonical manifests regardless of object key order', () => {
    const manifest = { name: 'authored-demo', version: '1.0.0', files: [{ path: 'SKILL.md', sha256: 'a'.repeat(64) }] };
    const signature = signManifest(manifest);
    const reordered = { files: manifest.files, version: manifest.version, name: manifest.name };

    expect(verifyManifest(reordered, signature, getPublicKey())).toBe(true);
  });

  it('fails verification after a one-byte manifest alteration', () => {
    const manifest = { name: 'authored-demo', version: '1.0.0' };
    const signature = signManifest(manifest);

    expect(verifyManifest({ ...manifest, version: '1.0.1' }, signature, getPublicKey())).toBe(false);
  });

  it('creates the private key with mode 0600', () => {
    getPublicKey();
    const mode = fs.statSync(path.join(tempHome, '.codebuddy', 'skill-signing', 'key.pem')).mode & 0o777;

    expect(mode).toBe(0o600);
  });
});
