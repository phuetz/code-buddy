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

    expect(service.listTemplates().map((template) => template.id)).toEqual(['react-ts', 'express-api', 'node-cli']);
    expect(service.listTemplates().length).toBeGreaterThanOrEqual(3);
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
});
