import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const onboardingPath = path.resolve(process.cwd(), 'src/renderer/components/OnboardingWizard.tsx');
const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');

describe('OnboardingWizard companion permission cards', () => {
  it('opens the companion panel from the step-3 permission cards', () => {
    const source = fs.readFileSync(onboardingPath, 'utf8');
    const start = source.indexOf('data-testid="onboarding-companion-permissions"');
    const end = source.indexOf('{step === 4 &&', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain('onClick={onOpenCompanion}');
    expect(block).toContain('<button');
    expect(block).not.toMatch(/<div\s+key=\{testId\}/);
  });

  it('wires onOpenCompanion to open the companion panel', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const start = source.indexOf('onOpenCompanion={() => {');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, start + 220);
    expect(block).toContain('setShowCompanionPanel(true)');
  });
});
