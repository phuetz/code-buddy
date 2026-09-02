import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const onboardingPath = path.resolve(process.cwd(), 'src/renderer/components/OnboardingWizard.tsx');

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
});
