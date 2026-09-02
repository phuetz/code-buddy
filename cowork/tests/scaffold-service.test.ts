import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader.js';
import { ScaffoldService } from '../src/main/studio/scaffold-service.js';

vi.mock('../src/main/utils/core-loader.js', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('ScaffoldService', () => {
  it('lists the built-in App Studio templates', () => {
    const service = new ScaffoldService();

    expect(service.listTemplates().map((template) => template.id)).toEqual([
      'react-tailwind',
      'react-ts',
      'express-api',
      'node-cli',
    ]);
    expect(service.listTemplates().length).toBeGreaterThanOrEqual(4);
  });

  it('delegates generation to the core TemplateEngine', async () => {
    const generate = vi.fn().mockResolvedValue({
      success: true,
      projectPath: '/tmp/my-app',
      filesCreated: ['package.json', 'src/App.tsx'],
    });
    mockedLoadCoreModule.mockResolvedValue({ getTemplateEngine: () => ({ generate }) });
    const service = new ScaffoldService();

    await expect(service.scaffoldProject({
      template: 'react-ts',
      targetDir: '/tmp/my-app',
      vars: { description: 'Demo app' },
    })).resolves.toEqual({
      ok: true,
      data: { projectDir: '/tmp/my-app', files: ['package.json', 'src/App.tsx'] },
    });
    expect(generate).toHaveBeenCalledWith({
      template: 'react-ts',
      projectName: 'my-app',
      outputDir: '/tmp',
      variables: { description: 'Demo app', projectName: 'my-app' },
    });
  });

  it('lands the project EXACTLY in targetDir even when vars.projectName differs', async () => {
    // Regression: the core engine builds `join(outputDir, projectName)`, so the
    // directory name must be basename(targetDir) — not vars.projectName — or the
    // project lands in the wrong folder (/home/patrice/ws/app instead of the
    // /home/patrice/ws/my-cool-app the user picked). The chosen name still drives
    // interpolation (package.json name, README) via the variable.
    const generate = vi.fn().mockResolvedValue({
      success: true,
      projectPath: '/home/patrice/ws/my-cool-app',
      filesCreated: ['package.json'],
    });
    mockedLoadCoreModule.mockResolvedValue({ getTemplateEngine: () => ({ generate }) });
    const service = new ScaffoldService();

    await service.scaffoldProject({
      template: 'node-cli',
      targetDir: '/home/patrice/ws/my-cool-app',
      vars: { projectName: 'app', description: 'Tool' },
    });

    expect(generate).toHaveBeenCalledWith({
      template: 'node-cli',
      // Directory name = basename(targetDir) so join(outputDir, projectName) === targetDir.
      projectName: 'my-cool-app',
      outputDir: '/home/patrice/ws',
      // Interpolation keeps the user's chosen name.
      variables: { projectName: 'app', description: 'Tool' },
    });
  });
});
