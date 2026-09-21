import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  extractRealEntries,
  isPlaceholderEntry,
  reviveMemory,
  loadRevivedSummary,
} from './memory-reviver.js';

function seedWorkspace(root: string) {
  const agentDir = path.join(root, '.codebuddy', 'agent-memory', 'alice');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'MEMORY.md'),
    ['## 2026-04-06', '', 'done', '', '## 2026-04-07', '', 'done', '', '## 2026-09-03', '', 'Patrice préfère les tests en français.', '', '## 2026-09-04', '', 'Utilise toujours pnpm, jamais npm.', ''].join('\n'),
    'utf8',
  );
  fs.mkdirSync(path.join(root, '.codebuddy'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.codebuddy', 'CODEBUDDY_MEMORY.md'),
    '# Code Buddy Memory\n\n## Custom\n\n---\n',
    'utf8',
  );
}

describe('memory-reviver', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-reviver-'));
    seedWorkspace(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('detects placeholder entries', () => {
    expect(isPlaceholderEntry('## 2026-04-06\n\ndone\n')).toBe(true);
    expect(isPlaceholderEntry('## 2026-09-03\n\nPatrice préfère les tests.\n')).toBe(false);
  });

  it('extracts only real entries', () => {
    const content = fs.readFileSync(
      path.join(root, '.codebuddy', 'agent-memory', 'alice', 'MEMORY.md'),
      'utf8',
    );
    const real = extractRealEntries(content);
    expect(real).toHaveLength(2);
    expect(real[0]?.text).toContain('français');
    expect(real[1]?.text).toContain('pnpm');
  });

  it('revives memory: drops placeholders, promotes facts, writes summary', () => {
    const result = reviveMemory({ workDir: root });
    expect(result.agentsScanned).toBe(1);
    expect(result.realEntriesFound).toBe(2);
    expect(result.promoted).toBe(2);
    expect(result.placeholdersDropped).toBeGreaterThan(0);
    expect(result.summaryWritten).toBe(true);

    const cleaned = fs.readFileSync(
      path.join(root, '.codebuddy', 'agent-memory', 'alice', 'MEMORY.md'),
      'utf8',
    );
    expect(cleaned).not.toMatch(/\ndone\n/);
    expect(cleaned).toContain('français');

    const global = fs.readFileSync(path.join(root, '.codebuddy', 'CODEBUDDY_MEMORY.md'), 'utf8');
    expect(global).toContain('pnpm');
    expect(global).toContain('français');

    const summary = loadRevivedSummary(root);
    expect(summary).toContain('Living memory');
    expect(summary).toContain('pnpm');
  });

  it('is idempotent', () => {
    reviveMemory({ workDir: root });
    const second = reviveMemory({ workDir: root });
    expect(second.promoted).toBe(0);
    expect(second.realEntriesFound).toBe(2);
  });
});
