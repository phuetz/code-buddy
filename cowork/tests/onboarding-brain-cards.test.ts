import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const onboardingPath = path.resolve(process.cwd(), 'src/renderer/components/OnboardingWizard.tsx');

describe('OnboardingWizard brain cards', () => {
  it('opens API settings from the local/custom brain cards', () => {
    const source = fs.readFileSync(onboardingPath, 'utf8');
    const start = source.indexOf('data-testid="onboarding-brain-options"');
    const end = source.indexOf('{connectionPanel}', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain('onClick={onOpenApiSettings}');
    expect(block).toContain('<button');
    expect(block).not.toMatch(/<div\s+key=\{testId\}/);
  });
});
