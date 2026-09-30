import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const home = `${process.cwd()}/_qa/socle/archive-home`;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { home, previousHome, previousUserProfile };
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchiveTool } from '../../src/tools/archive-tool.js';

let work: string;
let previousCwd: string;

beforeAll(() => {
  previousCwd = process.cwd();
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-archive-boundary-'));
  fs.mkdirSync(path.join(qa.home, '.codebuddy'), { recursive: true });
  process.chdir(work);
});

afterAll(() => {
  process.chdir(previousCwd);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(qa.home, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousUserProfile;
});

describe('archive : source et extraction classées', () => {
  it('refuse une archive rangée dans le dossier privé du HOME', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const archivePath = path.join(qa.home, '.codebuddy', 'backup.zip');
    const zip = new AdmZip();
    zip.addFile('notes.txt', Buffer.from('PUBLIC-ARCHIVE-MARKER'));
    zip.writeZip(archivePath);

    const archive = new ArchiveTool();
    expect((await archive.list(archivePath)).success).toBe(false);
    expect((await archive.extract(archivePath, { outputDir: path.join(work, 'private-out') })).success).toBe(false);
    expect(fs.existsSync(path.join(work, 'private-out', 'notes.txt'))).toBe(false);
  });

  it('refuse un membre classé et une destination hors du répertoire courant', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const secretPath = path.join(work, 'secret.zip');
    const secretZip = new AdmZip();
    secretZip.addFile('secrets.json', Buffer.from('FAKE-ARCHIVE-SECRET'));
    secretZip.writeZip(secretPath);

    const archive = new ArchiveTool();
    expect((await archive.list(secretPath)).success).toBe(false);
    expect((await archive.extract(secretPath, { outputDir: path.join(work, 'secret-out') })).success).toBe(false);
    expect(fs.existsSync(path.join(work, 'secret-out', 'secrets.json'))).toBe(false);

    const ordinaryPath = path.join(work, 'ordinary.zip');
    const ordinaryZip = new AdmZip();
    ordinaryZip.addFile('notes.txt', Buffer.from('PUBLIC-ARCHIVE-MARKER'));
    ordinaryZip.writeZip(ordinaryPath);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-archive-outside-'));
    try {
      expect((await archive.extract(ordinaryPath, { outputDir: outside })).success).toBe(false);
      expect(fs.existsSync(path.join(outside, 'notes.txt'))).toBe(false);
      expect((await archive.extract(ordinaryPath, { outputDir: path.join(work, 'ordinary-out') })).success).toBe(true);
      expect(fs.readFileSync(path.join(work, 'ordinary-out', 'notes.txt'), 'utf8')).toBe('PUBLIC-ARCHIVE-MARKER');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
