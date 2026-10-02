import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { grantAdditionalDirectories } from '../../src/cli/additional-directories.js';
import { getTrustFolderManager, resetTrustFolderManager } from '../../src/security/trust-folders.js';

vi.mock('../../src/security/sandbox.js', () => ({ getSandboxManager: () => ({ allowPath: vi.fn() }) }));
let root: string;
afterEach(() => {
  resetTrustFolderManager();
  if (root) rmSync(root, { recursive: true, force: true });
});

it('honors an explicit document directory for file tools without persisting or widening trust', () => {
  root = mkdtempSync(join(tmpdir(), 'additional-directories-'));
  const documents = join(root, 'documents');
  const sibling = join(root, 'documents-private');
  mkdirSync(documents); mkdirSync(sibling);
  const report = join(documents, 'RAPPORT.md');
  writeFileSync(report, 'Fixture de la mission A');
  const secret = join(sibling, 'secret.txt');
  writeFileSync(secret, 'synthetic');
  symlinkSync(secret, join(documents, 'escape.txt'));
  const trust = getTrustFolderManager();
  trust.setEnforcement(true);
  const saved = trust.getTrustedFolders();
  expect(trust.isTrusted(report)).toBe(false);
  const release = grantAdditionalDirectories([documents]);
  try {
    expect(trust.isTrusted(report)).toBe(true);
    expect(trust.isTrusted(join(documents, 'new-report.md'))).toBe(true);
    expect(trust.isTrusted(secret)).toBe(false);
    expect(trust.isTrusted(join(documents, 'escape.txt'))).toBe(false);
    expect(trust.isTrusted(root)).toBe(false);
    expect(trust.getTrustedFolders()).toEqual(saved);
  } finally { release(); }
  expect(trust.isTrusted(report)).toBe(false);
});

it('rolls back session trust when a directory grant is invalid', () => {
  root = mkdtempSync(join(tmpdir(), 'additional-directories-'));
  const trust = getTrustFolderManager();
  trust.setEnforcement(true);
  expect(() => grantAdditionalDirectories([root, join(root, 'missing')])).toThrow();
  expect(trust.isTrusted(root)).toBe(false);
});
