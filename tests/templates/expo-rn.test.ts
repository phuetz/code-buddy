import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { existsSync, mkdtempSync } from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { getTemplateEngine, resetTemplateEngine } from '../../src/templates/project-scaffolding.js';

let tmpDir: string | undefined;

afterEach(async () => {
  resetTemplateEngine();
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    tmpDir = undefined;
  }
});

describe('expo-rn template', () => {
  it('is registered next to the built-in starters', () => {
    const names = getTemplateEngine().getTemplates().map((template) => template.name);
    expect(names).toEqual(expect.arrayContaining(['node-cli', 'react-ts', 'react-tailwind', 'express-api', 'expo-rn']));
    expect(getTemplateEngine().getTemplate('expo-rn')?.category).toBe('mobile');
  });

  it('scaffolds tabs, list/detail, theme, mocked tests and EAS config without installing', async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'codebuddy-expo-rn-'));
    const result = await getTemplateEngine().generate({
      template: 'expo-rn',
      projectName: 'expo-demo',
      outputDir: tmpDir,
      variables: { description: 'Mobile starter' },
      skipInstall: true,
      skipGit: true,
    });

    expect(result.success).toBe(true);
    expect(existsSync(result.projectPath)).toBe(true);
    expect(result.filesCreated).toEqual(expect.arrayContaining([
      'package.json',
      'app.json',
      'eas.json',
      'expo-env.d.ts',
      'app/(tabs)/_layout.tsx',
      'app/(tabs)/index.tsx',
      'app/(tabs)/about.tsx',
      'app/item/[id].tsx',
      'src/api/catalog.ts',
      'src/theme/tokens.ts',
      'tests/catalog.test.ts',
      'tests/theme.test.ts',
    ]));

    const packageJson = JSON.parse(await fs.readFile(path.join(result.projectPath, 'package.json'), 'utf8')) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(packageJson.name).toBe('expo-demo');
    expect(packageJson.scripts.test).toBe('vitest run');
    expect(packageJson.scripts.typecheck).toBe('tsc --noEmit');
    expect(packageJson.dependencies.expo).toMatch(/^~/);
    expect(packageJson.dependencies['expo-asset']).toBeDefined();
    expect(packageJson.dependencies['expo-router']).toBeDefined();
    expect(packageJson.dependencies['query-string']).toBeDefined();

    const eas = await fs.readFile(path.join(result.projectPath, 'eas.json'), 'utf8');
    expect(eas).toContain('"development"');
    expect(eas).toContain('"preview"');
    expect(eas).toContain('"production"');
    expect(eas).not.toMatch(/EXPO_TOKEN|password|secret|projectId/i);

    const appJson = await fs.readFile(path.join(result.projectPath, 'app.json'), 'utf8');
    expect(appJson).not.toContain('projectId');
    expect(appJson).toContain('"userInterfaceStyle": "automatic"');

    const catalogTest = await fs.readFile(path.join(result.projectPath, 'tests', 'catalog.test.ts'), 'utf8');
    expect(catalogTest).toContain('injected fetcher');
    expect(catalogTest).toContain('never talks to the network');
    expect(catalogTest).not.toMatch(/globalThis\.fetch\s*=/);

    const feed = await fs.readFile(path.join(result.projectPath, 'app', '(tabs)', 'index.tsx'), 'utf8');
    expect(feed).toContain('loadCatalog');
    expect(feed).toContain('router.push');

    const about = await fs.readFile(path.join(result.projectPath, 'app', '(tabs)', 'about.tsx'), 'utf8');
    expect(about).toContain('setPreference');
    expect(about).toContain('expo-demo');

    const readme = await fs.readFile(path.join(result.projectPath, 'README.md'), 'utf8');
    expect(readme).toContain('eas login');
    expect(readme).toContain('first');
  });
});
