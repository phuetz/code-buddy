import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');

describe('first-run wizard visibility', () => {
  it('stays open until onboardingCompleted, even after a provider is saved', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    // Proven GK1: saving Ollama set isConfigured and hid the wizard before
    // the workspace step, so the default Electron working dir was never
    // replaced and the first write was rejected as outside the workspace.
    expect(source).toMatch(/setShowOnboarding\(\s*!config\.onboardingCompleted\s*\)/);
    expect(source).not.toMatch(
      /setShowOnboarding\(!config\.onboardingCompleted && !config\.apiKey && !isConfigured\)/
    );
  });
});
