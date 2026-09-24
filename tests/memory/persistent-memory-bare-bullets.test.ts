import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

// Shape of a real user file (2026-09-24): the untouched template, then one
// preference appended by hand as a bare bullet, after the footer. It used to be
// declared corrupt, which blocked every user-memory save for ten days.
const TEMPLATE = `# Code Buddy Memory

This file stores persistent memory for the Code Buddy agent.
It is automatically managed but can be manually edited.

## Project Context
<!-- Key information about this project -->

## User Preferences
<!-- Coding style, conventions, preferences -->

## Decisions
<!-- Important architectural or design decisions -->

## Patterns
<!-- Code patterns and conventions used -->

## Custom
<!-- User-defined memories -->

---
*Last updated: 2026-09-04T00:01:14.846Z*
`;
const HAND_WRITTEN = 'Préférence explicite : déposer les livrables dans le dossier partagé.';

describe('persistent memory — hand-written bullets', () => {
  let dir: string;
  let userPath: string;

  function manager(): PersistentMemoryManager {
    return new PersistentMemoryManager({
      projectMemoryPath: path.join(dir, 'project.md'),
      userMemoryPath: userPath,
      autoCapture: false,
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-memory-bullets-'));
    userPath = path.join(dir, 'memory.md');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('recovers a bare bullet appended after the footer instead of blocking the store', async () => {
    fs.writeFileSync(userPath, `${TEMPLATE}\n- ${HAND_WRITTEN}\n`);
    const m = manager();
    await m.initialize();

    const entries = m.listMemories('user');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.value).toBe(HAND_WRITTEN);
    expect(entries[0]!.key).toMatch(/^note-[a-z0-9-]+-[0-9a-f]{6}$/);
    expect(m.recall(entries[0]!.key, 'user')).toBe(HAND_WRITTEN);
  });

  it('keeps the recovered bullet across a save and rewrites it canonically', async () => {
    fs.writeFileSync(userPath, `${TEMPLATE}\n- ${HAND_WRITTEN}\n`);
    const first = manager();
    await first.initialize();
    const recoveredKey = first.listMemories('user')[0]!.key;

    await first.remember('langue', 'français', { scope: 'user' });

    const written = fs.readFileSync(userPath, 'utf8');
    expect(written).toContain(`- **${recoveredKey}**: ${HAND_WRITTEN}`);
    expect(written).toContain('- **langue**: français');
    expect(written).not.toMatch(/^- Préférence/m);

    const second = manager();
    await second.initialize();
    expect(second.recall(recoveredKey, 'user')).toBe(HAND_WRITTEN);
    expect(second.recall('langue', 'user')).toBe('français');
  });

  it('still blocks saves when a bullet sits beside prose a save would lose', async () => {
    const mixed = `${TEMPLATE}\nUne note libre, sans puce, que le chargeur ne sait pas relire.\n- ${HAND_WRITTEN}\n`;
    fs.writeFileSync(userPath, mixed);
    const m = manager();
    await m.initialize();

    await expect(m.remember('langue', 'français', { scope: 'user' })).rejects.toThrow(
      /unreadable|non-canonical|would be lost/i,
    );
    expect(fs.readFileSync(userPath, 'utf8')).toBe(mixed);
  });
});
