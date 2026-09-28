import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readDoc(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function expectAccurateInstallPolicy(content: string): void {
  expect(content).toMatch(/npm 11[\s\S]{0,160}warn[\s\S]{0,160}still runs?[\s\S]{0,30}by default/i);
  expect(content).toMatch(/npm 12[\s\S]{0,80}blocks?[\s\S]{0,80}by default/i);
  expect(content).toMatch(/--allow-scripts=better-sqlite3/);
  expect(content).not.toMatch(/npm\s*(?:>=|≥)\s*11[^\n]*blocked by default/i);
  expect(content).not.toMatch(/18\s+(?:optional\s+)?native\s+packages/i);
}

describe('B-8 + B-3: Documentation of token minting, --allow-scripts, and optional native modules', () => {
  it('docs/getting-started.md documente buddy fleet token et buddy token', () => {
    const content = readDoc('docs/getting-started.md');
    expect(content).toMatch(/buddy\s+(?:fleet\s+)?token/);
    expect(content).toMatch(/buddy\s+token/);
    expect(content).toMatch(/buddy\s+fleet\s+token/);
  });

  it('docs/getting-started.md explique la politique npm 11/12 et la forme nommée de --allow-scripts', () => {
    const content = readDoc('docs/getting-started.md');
    expectAccurateInstallPolicy(content);
    const optional = JSON.parse(readDoc('package.json')).optionalDependencies as Record<string, string>;
    for (const name of ['better-sqlite3', 'sharp', 'node-pty']) {
      expect(optional).toHaveProperty(name);
      expect(content).toContain(name);
    }
  });

  it('docs/security.md documente le jeton d authentification et buddy token / fleet token', () => {
    const content = readDoc('docs/security.md');
    expect(content).toMatch(/buddy\s+token/);
    expect(content).toMatch(/buddy\s+fleet\s+token/);
    expect(content).toMatch(/JWT_SECRET/);
  });

  it('docs/security.md explique la politique npm 11/12 et les modules natifs optionnels', () => {
    const content = readDoc('docs/security.md');
    expectAccurateInstallPolicy(content);
    expect(content).toMatch(/optional native add-ons/i);
  });

  it('docs/getting-started.md documente l ouverture PWA en une commande', () => {
    const content = readDoc('docs/getting-started.md');
    expect(content).toMatch(/buddy\s+token/);
    expect(content).toMatch(/#token=/);
    expect(content).toMatch(/__codebuddy__\/mobile/);
    expect(content).toMatch(/--telegram/);
    expect(content).toMatch(/--qr/);
  });

  it('docs/security.md documente --env, le hash PWA, et le secret jamais affiche', () => {
    const content = readDoc('docs/security.md');
    expect(content).toMatch(/--env/);
    expect(content).toMatch(/#token=/);
    expect(content).toMatch(/never (?:printed|logged)|jamais affiche/i);
    expect(content).toMatch(/server\.env/);
  });

  it('CLAUDE.md liste buddy token dans les commandes CLI', () => {
    const content = readDoc('CLAUDE.md');
    expect(content).toMatch(/buddy token/);
  });
});
