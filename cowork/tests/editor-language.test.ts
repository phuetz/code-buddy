import { describe, expect, it } from 'vitest';
import { languageForPath } from '../src/renderer/components/studio/utils/editor-language.js';

describe('languageForPath', () => {
  it('detects JavaScript and TypeScript family files', () => {
    expect(languageForPath('src/App.tsx')).toBe('javascript');
    expect(languageForPath('src/index.jsx')).toBe('javascript');
    expect(languageForPath('vite.config.mjs')).toBe('javascript');
  });

  it('detects supported document languages', () => {
    expect(languageForPath('index.html')).toBe('html');
    expect(languageForPath('styles.css')).toBe('css');
    expect(languageForPath('package.json')).toBe('json');
  });

  it('falls back to text', () => {
    expect(languageForPath('README.md')).toBe('text');
  });
});
