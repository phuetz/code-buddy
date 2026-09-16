import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const onboardingPath = path.resolve(process.cwd(), 'src/renderer/components/OnboardingWizard.tsx');
const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const configModalPath = path.resolve(process.cwd(), 'src/renderer/components/ConfigModal.tsx');
const apiStatePath = path.resolve(process.cwd(), 'src/renderer/hooks/useApiConfigState.ts');

describe('OnboardingWizard brain cards', () => {
  it('opens API settings from the local/custom brain cards', () => {
    const source = fs.readFileSync(onboardingPath, 'utf8');
    const start = source.indexOf('data-testid="onboarding-brain-options"');
    const end = source.indexOf('{connectionPanel}', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain('<button');
    expect(block).not.toMatch(/<div\s+key=\{testId\}/);
  });

  it('Local runtimes opens API settings on Ollama, not the shared OpenRouter default', () => {
    const source = fs.readFileSync(onboardingPath, 'utf8');
    const localStart = source.indexOf("testId: 'onboarding-brain-local'");
    const customStart = source.indexOf("testId: 'onboarding-brain-custom'");
    expect(localStart).toBeGreaterThan(-1);
    expect(customStart).toBeGreaterThan(localStart);
    const localCard = source.slice(localStart, customStart);
    // Proven GK1: the three cards shared onClick={onOpenApiSettings}, so
    // "Local runtimes" opened Set Up API still pinned on OpenRouter (Needs key).
    expect(localCard).toMatch(/providerHint:\s*'ollama'/);
    expect(source).toContain('onOpenApiSettings(providerHint)');
  });

  it('forwards the Local runtimes hint into ConfigModal / API state', () => {
    const app = fs.readFileSync(appPath, 'utf8');
    const modal = fs.readFileSync(configModalPath, 'utf8');
    const apiState = fs.readFileSync(apiStatePath, 'utf8');
    expect(app).toContain('preferredProvider={configProviderHint}');
    expect(modal).toContain('preferredProvider');
    expect(apiState).toContain('preferredProvider');
    expect(apiState).toContain('profileKeyFromProvider(preferredProvider)');
  });
});
