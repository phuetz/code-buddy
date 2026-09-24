import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { JSReplTool, resetJSRepl } from '../../src/tools/js-repl.js';

describe('JSReplTool', () => {
  let homeDir: string;
  let originalHome: string | undefined;
  let originalCodebuddyHome: string | undefined;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'home-'));
    originalHome = process.env.HOME;
    originalCodebuddyHome = process.env.CODEBUDDY_HOME;
    process.env.HOME = homeDir;
    process.env.CODEBUDDY_HOME = path.join(homeDir, '.codebuddy');
    resetJSRepl();
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalCodebuddyHome !== undefined) process.env.CODEBUDDY_HOME = originalCodebuddyHome;
    else delete process.env.CODEBUDDY_HOME;
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('exécute du code JS et conserve les variables entre les appels', async () => {
    const tool = new JSReplTool();

    // Exécution initiale
    const res1 = await tool.execute({ action: 'execute', code: 'let a = 10; a + 5;' });
    expect(res1.success).toBe(true);
    expect(res1.output).toBe('15');

    // Vérification de la persistance (on réutilise 'a')
    const res2 = await tool.execute({ action: 'execute', code: 'a * 2;' });
    expect(res2.success).toBe(true);
    expect(res2.output).toBe('20');
  });
});
