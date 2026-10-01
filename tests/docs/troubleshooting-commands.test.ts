import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function collectSource(directory: string): string {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSource(fullPath);
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)
      ? fs.readFileSync(fullPath, 'utf8')
      : '';
  }).join('\n');
}

describe('troubleshooting.md commands', () => {
  const docsPath = path.join(__dirname, '../../docs/troubleshooting.md');
  const srcPath = path.join(__dirname, '../../src');
  const coworkSrcPath = path.join(__dirname, '../../cowork/src');

  it('should not contain "buddy serve"', () => {
    const content = fs.readFileSync(docsPath, 'utf8');
    const hasBuddyServe = /buddy serve\b(?!r)/.test(content);
    expect(hasBuddyServe).toBe(false);
  });

  it('should only reference existing environment variables', () => {
    const content = fs.readFileSync(docsPath, 'utf8');
    const codeBlocks = [];
    let inCodeBlock = false;
    let currentBlock = '';

    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          codeBlocks.push(currentBlock);
          currentBlock = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
      } else if (inCodeBlock) {
        currentBlock += line + '\n';
      } else if (line.startsWith('`') && line.endsWith('`')) {
         // also check inline code
         codeBlocks.push(line);
      } else {
         // check anything between backticks
         const inlineMatches = line.match(/`([^`]+)`/g);
         if (inlineMatches) {
             inlineMatches.forEach(m => codeBlocks.push(m));
         }
      }
    }

    const varsFound = new Set<string>();
    const varRegex = /(?:CODEBUDDY_[A-Z_]+|CORS_ORIGINS)/g;

    for (const block of codeBlocks) {
      let match;
      while ((match = varRegex.exec(block)) !== null) {
        varsFound.add(match[0]);
      }
    }

    // List of known exceptions as described in prompt
    const exceptions = new Set([
      'CODEBUDDY_ENGINE_PATH' // in src/desktop/launcher.ts
    ]);

    const source = collectSource(srcPath) + collectSource(coworkSrcPath);
    for (const v of varsFound) {
      if (exceptions.has(v)) continue;
      expect(source.includes(v), `Variable ${v} not found in source`).toBe(true);
    }
  });
});
