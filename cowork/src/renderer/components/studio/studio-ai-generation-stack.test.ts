/**
 * buildAiGenerationPrompt honours the chosen generation stack: the plan block's
 * stack field, the intro label and the stack guidance come from the catalog,
 * with 'static' as the default when no stack is set.
 */
import { describe, expect, it } from 'vitest';
import { buildAiGenerationPrompt } from './studio-ai-generation.js';
import { findStack } from './generation-stacks.js';

function req(stack?: string) {
  return { template: 'react-ts' as const, prompt: 'une app de notes', targetDir: '/tmp/x', vars: {}, ...(stack ? { stack } : {}) };
}

describe('buildAiGenerationPrompt — stacks', () => {
  it('defaults to the static stack when none is chosen', () => {
    const out = buildAiGenerationPrompt(req());
    expect(out).toContain('"stack":"HTML/CSS/JS"');
    expect(out).toContain('(Static web)');
  });

  it('injects the Expo stack (mobile) plan tag, label and guidance', () => {
    const out = buildAiGenerationPrompt(req('expo'));
    const expo = findStack('expo')!;
    expect(out).toContain(`"stack":"${expo.planStack}"`);
    expect(out).toContain(`(${expo.label})`);
    expect(out).toContain(expo.guidance);
    expect(out).toContain(expo.previewNote);
  });

  it('injects the React + Vite stack', () => {
    const out = buildAiGenerationPrompt(req('react-vite'));
    expect(out).toContain('"stack":"React + Vite"');
  });
});
