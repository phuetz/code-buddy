import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const welcomePath = path.resolve(process.cwd(), 'src/renderer/components/WelcomeView.tsx');
const projectSelectorPath = path.resolve(process.cwd(), 'src/renderer/components/ProjectSelector.tsx');
const onboardingPath = path.resolve(process.cwd(), 'src/renderer/components/OnboardingWizard.tsx');
const mainPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('welcome project selector', () => {
  it('renders the project selector in WelcomeView', () => {
    const source = fs.readFileSync(welcomePath, 'utf8');
    expect(source).toContain("import { ProjectSelector }");
    expect(source).toContain('<ProjectSelector />');
  });

  it('exposes a stable project selector test id', () => {
    const source = fs.readFileSync(projectSelectorPath, 'utf8');
    expect(source).toContain('data-testid="project-selector-button"');
  });

  it('uses a directory-only picker for every workspace choice', () => {
    const projectSelector = fs.readFileSync(projectSelectorPath, 'utf8');
    const onboarding = fs.readFileSync(onboardingPath, 'utf8');
    const main = fs.readFileSync(mainPath, 'utf8');

    expect(projectSelector).toContain('api.selectDirectory');
    expect(onboarding).toContain('electronAPI?.selectDirectory');
    expect(main).toContain("ipcMain.handle('dialog.selectDirectory'");
    expect(main).toContain("properties: ['openDirectory']");
  });

  it('persists the onboarding folder as defaultWorkdir, not a dropped key', () => {
    const onboarding = fs.readFileSync(onboardingPath, 'utf8');
    expect(onboarding).toContain('defaultWorkdir: folder');
    expect(onboarding).not.toContain('defaultWorkspacePath');
  });

  it('applies the onboarding folder as the live workdir for the next chat', () => {
    const onboarding = fs.readFileSync(onboardingPath, 'utf8');
    // Proven GK1: saving defaultWorkdir alone left new sessions on
    // userData/default_working_dir, so the first write was rejected as
    // outside the workspace.
    expect(onboarding).toContain("type: 'workdir.set'");
    expect(onboarding).toContain('path: folder');
  });
});
