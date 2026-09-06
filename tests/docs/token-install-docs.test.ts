import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readDoc(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('B-8 + B-3: Documentation of token minting, --allow-scripts, and optional native modules', () => {
  it('docs/getting-started.md documente buddy fleet token et buddy token', () => {
    const content = readDoc('docs/getting-started.md');
    expect(content).toMatch(/buddy\s+(?:fleet\s+)?token/);
    expect(content).toMatch(/buddy\s+token/);
    expect(content).toMatch(/buddy\s+fleet\s+token/);
  });

  it('docs/getting-started.md documente --allow-scripts pour npm >= 11 et les 18 paquets natifs', () => {
    const content = readDoc('docs/getting-started.md');
    expect(content).toMatch(/--allow-scripts/);
    expect(content).toMatch(/npm\s*(?:>=|≥)\s*11/i);
    expect(content).toMatch(/18\s+(?:optional\s+)?native\s+packages/i);
  });

  it('docs/security.md documente le jeton d authentification et buddy token / fleet token', () => {
    const content = readDoc('docs/security.md');
    expect(content).toMatch(/buddy\s+token/);
    expect(content).toMatch(/buddy\s+fleet\s+token/);
    expect(content).toMatch(/JWT_SECRET/);
  });

  it('docs/security.md documente --allow-scripts et les 18 paquets natifs optionnels', () => {
    const content = readDoc('docs/security.md');
    expect(content).toMatch(/--allow-scripts/);
    expect(content).toMatch(/18\s+(?:optional\s+)?native/i);
  });
});
