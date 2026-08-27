/**
 * Alignement prompt/exécution — volet prompt système.
 *
 * Sur un hôte Windows, les commandes du tool `bash` s'exécutent en PowerShell
 * (getShellConfiguration) : la section BASH COMMANDS du prompt doit le dire au
 * modèle, sinon il rédige du POSIX. Sur un hôte POSIX, la section reste
 * identique à l'octet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getBaseSystemPrompt } from '../../src/prompts/system-base.js';

const realPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  setPlatform(realPlatform);
});

describe('getBaseSystemPrompt — alignement shell', () => {
  it('sous win32, la section BASH COMMANDS annonce PowerShell, pas le POSIX', () => {
    setPlatform('win32');
    const prompt = getBaseSystemPrompt(false, '/tmp/project');
    expect(prompt).toContain('Shell: PowerShell');
    expect(prompt).toMatch(/BASH COMMANDS:[\s\S]{0,400}PowerShell/);
    expect(prompt).toMatch(/write PowerShell syntax, not POSIX bash/i);
  });

  it('sur un hôte POSIX, la section BASH COMMANDS reste identique à l’octet', () => {
    setPlatform('linux');
    const prompt = getBaseSystemPrompt(false, '/tmp/project');
    expect(prompt).toContain(
      '3. BASH COMMANDS:\n   - Use for: git, npm, searching, navigation, system info\n   - Avoid: destructive commands (rm -rf, format) without explicit request',
    );
    expect(prompt).not.toMatch(/not POSIX bash/);
  });
});
