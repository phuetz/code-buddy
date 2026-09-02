import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const newShellPath = path.resolve(process.cwd(), 'src/renderer/components/NewShell.tsx');
const titlebarPath = path.resolve(process.cwd(), 'src/renderer/components/Titlebar.tsx');
const wizardPath = path.resolve(process.cwd(), 'src/renderer/components/OnboardingWizard.tsx');

describe('first-run overlays and close controls', () => {
  it('defers the new-shell tour while the first-run wizard is active', () => {
    const app = fs.readFileSync(appPath, 'utf8');
    const newShell = fs.readFileSync(newShellPath, 'utf8');

    expect(app).toContain('<NewShell onboardingActive={showOnboarding} />');
    expect(newShell).toContain('onboardingActive: boolean');
    expect(newShell).toContain('open={!onboardingActive && show}');
  });

  it('keeps panel close distinct from the Electron window close control', () => {
    const titlebar = fs.readFileSync(titlebarPath, 'utf8');
    const wizard = fs.readFileSync(wizardPath, 'utf8');

    expect(titlebar).toContain('aria-label={`${t(\'window.close\')} ${APP_NAME}`}');
    expect(wizard).toMatch(/data-testid="onboarding-close"[\s\S]*?<X size=\{14\}/);
    expect(wizard).toContain('onClick={onClose}');
  });
});
