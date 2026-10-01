import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '../..');

function readRepositoryFile(filePath: string): string {
  return fs.readFileSync(path.join(rootDir, filePath), 'utf8');
}

describe('server port consistency in documentation', () => {
  it('does not describe a separate gateway listener on port 3001', () => {
    const forbidden = [
      'Gateway WS (3001)',
      '**3001** Gateway WS',
      'gateway (3001)',
      'Separate gateway on port 3001',
    ];
    for (const filePath of ['CLAUDE.md', 'AGENTS.md', 'docs/features.md', 'docs/infrastructure.md']) {
      const content = readRepositoryFile(filePath);
      for (const phrase of forbidden) {
        expect(content, `${filePath} contains ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it('does not import the gateway server from the CLI or HTTP server entry point', () => {
    for (const filePath of ['src/index.ts', 'src/server/index.ts']) {
      expect(readRepositoryFile(filePath), `${filePath} imports gateway/server`).not.toContain('gateway/server');
    }
  });
});
