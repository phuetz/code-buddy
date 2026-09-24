import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ToolSearchTool, initToolSearchIndex } from '../../src/tools/tool-search.js';

describe('ToolSearchTool', () => {
  let homeDir: string;
  let originalHome: string | undefined;
  let originalCodebuddyHome: string | undefined;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'home-'));
    originalHome = process.env.HOME;
    originalCodebuddyHome = process.env.CODEBUDDY_HOME;
    process.env.HOME = homeDir;
    process.env.CODEBUDDY_HOME = path.join(homeDir, '.codebuddy');
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalCodebuddyHome !== undefined) process.env.CODEBUDDY_HOME = originalCodebuddyHome;
    else delete process.env.CODEBUDDY_HOME;
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('trouve un outil connu via une requête en français et en anglais', async () => {
    // Initialisation d'un registre de test (pour ne pas dépendre du registre complet)
    const mockTools = [
      {
        name: 'test_runner',
        description: 'Execute les tests unitaires et le framework vitest',
        keywords: ['test', 'run', 'vitest']
      },
      {
        name: 'lint_project',
        description: 'Verifie le formatage et le code',
        keywords: ['lint', 'format', 'eslint']
      }
    ];
    initToolSearchIndex(mockTools);

    const tool = new ToolSearchTool();

    // Test avec requête anglaise
    const resultEn = await tool.execute({ query: 'test runner' });
    expect(resultEn.success).toBe(true);
    // On affirme inconditionnellement sur resultEn.data
    const dataEn = resultEn.data as { names: string[] };
    expect(dataEn.names).toContain('test_runner');

    // Test avec requête française (mappée via QUERY_EQUIVALENTS dans le code)
    // Par exemple "lancer" équivaut à ["run", "execute"] selon le code de l'outil.
    const resultFr = await tool.execute({ query: 'lancer' });
    expect(resultFr.success).toBe(true);
    const dataFr = resultFr.data as { names: string[] };
    // "test_runner" possède le terme "run" (keywords) et "execute" (description), il devrait donc matcher
    expect(dataFr.names).toContain('test_runner');
  });
});
