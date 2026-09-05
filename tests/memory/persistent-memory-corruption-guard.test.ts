import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getMemoryManager,
  PersistentMemoryManager,
  resetMemoryManagerForTests,
} from '../../src/memory/persistent-memory.js';
import { ForgetTool, RecallTool } from '../../src/tools/registry/memory-tools.js';

const testRoot = path.join(process.cwd(), '.r28-tests');

describe('R28 D2/D4 — un magasin persistant illisible n’est jamais vide', () => {
  let dir: string;

  beforeEach(() => {
    fs.mkdirSync(testRoot, { recursive: true });
    dir = fs.mkdtempSync(path.join(testRoot, 'persistent-corrupt-'));
    resetMemoryManagerForTests();
  });

  afterEach(() => {
    resetMemoryManagerForTests();
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.rmdirSync(testRoot);
    } catch {
      // Un autre test R28 peut encore utiliser la racine partagée.
    }
  });

  it('D2 : refuse recall/replace/forget et signale le défaut au prompt après un échec I/O', async () => {
    const unreadableStore = path.join(dir, 'memory.md');
    fs.mkdirSync(unreadableStore);
    const manager = getMemoryManager({
      projectMemoryPath: path.join(dir, 'project.md'),
      userMemoryPath: unreadableStore,
      autoCapture: false,
    });
    await manager.initialize();

    expect(() => manager.recall('precieux', 'user')).toThrow(/unreadable|indisponible/i);
    await expect(manager.replace('precieux', 'nouveau', { scope: 'user' })).rejects.toThrow(/unreadable|indisponible/i);
    await expect(manager.forget('precieux', 'user')).rejects.toThrow(/unreadable|indisponible/i);
    expect(manager.getContextForPrompt()).toMatch(/MEMORY STORE ERROR.*user.*not empty/is);

    const recalled = await new RecallTool().execute({ key: 'precieux', scope: 'user' });
    const forgotten = await new ForgetTool().execute({ key: 'precieux', scope: 'user' });
    expect(recalled).toMatchObject({ success: false });
    expect(recalled.error).toMatch(/not an empty store/i);
    expect(forgotten).toMatchObject({ success: false });
    expect(forgotten.error).toMatch(/not an empty store/i);
  });

  it('D4 : refuse d’écraser un markdown non canonique et conserve chaque octet', async () => {
    const userPath = path.join(dir, 'memory.md');
    const manualNotes = '# Mes notes\n\nJe préfère le mode sombre.\nLe projet utilise Rust.\n';
    fs.writeFileSync(userPath, manualNotes);
    const manager = new PersistentMemoryManager({
      projectMemoryPath: path.join(dir, 'project.md'),
      userMemoryPath: userPath,
      autoCapture: false,
    });
    await manager.initialize();

    expect(() => manager.recall('theme', 'user')).toThrow(/non-canonical|non canonique/i);
    await expect(manager.remember('stack', 'Rust', { scope: 'user' })).rejects.toThrow(
      /unreadable|non-canonical|non canonique/i,
    );
    expect(fs.readFileSync(userPath, 'utf8')).toBe(manualNotes);
  });

  it('treats a blank memory file as a new empty store, not as corruption', async () => {
    const userPath = path.join(dir, 'memory.md');
    fs.writeFileSync(userPath, '  \n');
    const manager = new PersistentMemoryManager({
      projectMemoryPath: path.join(dir, 'project.md'),
      userMemoryPath: userPath,
      autoCapture: false,
    });
    await manager.initialize();

    expect(manager.getContextForPrompt()).not.toMatch(/MEMORY STORE ERROR/i);
    await expect(manager.remember('theme', 'sombre', { scope: 'user' })).resolves.toMatchObject({
      status: 'stored',
      key: 'theme',
    });
    expect(manager.recall('theme', 'user')).toBe('sombre');
  });
});
