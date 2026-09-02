import { describe, expect, it } from 'vitest';
import { buildAiGenerationPrompt } from './studio-ai-generation.js';

describe('buildAiGenerationPrompt — design guide', () => {
  it('injects an executable anti-cliche design contract into every app generation prompt', () => {
    const prompt = buildAiGenerationPrompt({
      template: 'react-tailwind',
      prompt: 'un carnet de voyage en Islande',
      targetDir: '/tmp/iceland-journal',
      vars: {},
      stack: 'react-vite',
    });

    expect(prompt).toContain('palette tirée du sujet');
    expect(prompt).toContain('deux familles de polices');
    expect(prompt).toContain('Hiérarchie typographique');
    expect(prompt).toContain('WCAG AA');
    expect(prompt).toContain('thèmes clair ET sombre');
    expect(prompt).toContain('dégradé violet sur fond blanc');
    expect(prompt).toContain('tout centrer');
    expect(prompt).toContain('coins arrondis sur tous les éléments');
    expect(prompt).toContain('Inter par défaut');
    expect(prompt).toContain('emoji comme puce ou icône');
    expect(prompt).toContain('https://21st.dev/community/components');
    expect(prompt).toContain('web_search');
    expect(prompt).toContain('Ne bloque jamais la génération sur 21st.dev');
    expect(prompt).toContain('continue immédiatement avec les primitives locales');
  });
});
