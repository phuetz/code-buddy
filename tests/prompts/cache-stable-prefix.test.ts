/**
 * Le préfixe stable du prompt système (tout ce qui précède la date, le dossier
 * et le nom de projet) doit être identique octet pour octet d'un dossier à
 * l'autre et d'un jour à l'autre. Sinon le cache du fournisseur est froid dès
 * la première requête.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBaseSystemPrompt,
  getChatOnlySystemPrompt,
  getChatOnlySystemPromptEN,
  getSystemPromptForMode,
} from '../../src/prompts/system-base.js';
import {
  detachVolatileContext,
  relocateVolatileSuffix,
  splitVolatileSuffix,
} from '../../src/prompts/cache-stable-prefix.js';

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Tout ce qui précède le bloc d'environnement. Vide si le bloc est absent. */
function stableHead(prompt: string): string {
  const at = prompt.indexOf('<context>');
  return at === -1 ? prompt : prompt.slice(0, at);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('préfixe de prompt stable pour le cache', () => {
  it('deux dossiers et deux dates partagent le même préfixe, et la date comme le dossier restent présents', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T15:00:00Z'));
    const jourA = getBaseSystemPrompt(false, '/tmp/dossier-alpha');
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    const jourB = getBaseSystemPrompt(false, '/tmp/dossier-beta');

    const teteA = stableHead(jourA);
    const teteB = stableHead(jourB);
    expect(teteA).toBe(teteB);
    expect(teteA).not.toContain('Current date:');
    expect(teteA).not.toContain('Working directory:');
    // Le bloc variable est un suffixe : le préfixe commun dépasse les consignes stables.
    expect(commonPrefixLength(jourA, jourB)).toBeGreaterThan(jourA.indexOf('<confirmation_system>'));
    expect(jourA.trimEnd().endsWith('</context>')).toBe(true);
    expect(jourB.trimEnd().endsWith('</context>')).toBe(true);

    expect(jourA).toContain('Current date: 2026-10-04');
    expect(jourA).toContain('Working directory: /tmp/dossier-alpha');
    expect(jourB).toContain('Current date: 2026-11-02');
    expect(jourB).toContain('Working directory: /tmp/dossier-beta');
  });

  it('un mode (yolo) ne repousse pas la date ni le dossier dans le préfixe stable', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T15:00:00Z'));
    const a = getSystemPromptForMode('yolo', false, '/tmp/dossier-alpha');
    vi.setSystemTime(new Date('2026-12-01T15:00:00Z'));
    const b = getSystemPromptForMode('yolo', false, '/tmp/dossier-beta');

    expect(stableHead(a)).toBe(stableHead(b));
    expect(stableHead(a)).toContain('<mode_override>');
    expect(stableHead(a)).not.toContain('Working directory:');
    expect(a).toContain('Current date: 2026-10-04');
    expect(a).toContain('Working directory: /tmp/dossier-alpha');
    expect(b).toContain('Working directory: /tmp/dossier-beta');
    expect(commonPrefixLength(a, b)).toBeGreaterThan(a.indexOf('</mode_override>'));
  });

  it('le prompt sans outils garde la date et le dossier après les consignes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T15:00:00Z'));
    const a = getChatOnlySystemPrompt('/tmp/dossier-alpha');
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    const b = getChatOnlySystemPrompt('/tmp/dossier-beta');

    expect(stableHead(a)).toBe(stableHead(b));
    expect(stableHead(a)).toContain('<capabilities>');
    expect(stableHead(a)).not.toContain('Répertoire de travail:');
    expect(a).toContain('Répertoire de travail: /tmp/dossier-alpha');
    expect(b).toContain('Répertoire de travail: /tmp/dossier-beta');
    expect(a.trimEnd().endsWith('</context>')).toBe(true);
  });

  it('le prompt anglais sans outils garde aussi la date après les consignes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T15:00:00Z'));
    const prompt = getChatOnlySystemPromptEN('/tmp/dossier-alpha');
    expect(stableHead(prompt)).toContain('<capabilities>');
    expect(stableHead(prompt)).not.toContain('Working directory:');
    expect(prompt).toContain('Working directory: /tmp/dossier-alpha');
    expect(prompt.trimEnd().endsWith('</context>')).toBe(true);
  });

  it('Project: et le dossier sortent du préfixe, et restent dans le message de fin', () => {
    const alpha = [
      'Consignes stables qui ne dépendent pas du dossier.',
      '',
      '<persistent_memory>',
      'Project: dossier-alpha',
      'Languages: ts',
      '</persistent_memory>',
      '',
      '<context>',
      '- Current date: 2026-10-04',
      '- Working directory: /tmp/dossier-alpha',
      '- Platform: linux',
      '</context>',
      '',
      'Suite stable.',
    ].join('\n');
    const beta = alpha
      .replace('dossier-alpha', 'dossier-beta')
      .replace('/tmp/dossier-alpha', '/tmp/dossier-beta')
      .replace('2026-10-04', '2026-11-02');

    const splitA = splitVolatileSuffix(alpha);
    const splitB = splitVolatileSuffix(beta);
    expect(splitA.stable).toBe(splitB.stable);
    expect(splitA.stable).not.toContain('Project:');
    expect(splitA.stable).not.toContain('Working directory:');
    expect(splitA.volatile).toContain('Project: dossier-alpha');
    expect(splitA.volatile).toContain('Working directory: /tmp/dossier-alpha');
    expect(splitB.volatile).toContain('Current date: 2026-11-02');

    const relocatedA = relocateVolatileSuffix(alpha);
    expect(relocatedA).toContain('Project: dossier-alpha');
    expect(relocatedA).toContain('Working directory: /tmp/dossier-alpha');
    expect(relocatedA.indexOf('Suite stable.')).toBeLessThan(relocatedA.indexOf('<context>'));

    const original = [
      { role: 'system' as const, content: alpha },
      { role: 'user' as const, content: 'Réponds uniquement le mot ok.' },
      { role: 'system' as const, content: '<runtime_settings ephemeral="true">{}</runtime_settings>' },
    ];
    const detached = detachVolatileContext(original);
    expect(original[0].content).toBe(alpha);
    expect(String(detached[0].content)).not.toContain('Working directory:');
    expect(String(detached[0].content)).not.toContain('Project:');
    expect(String(detached[0].content)).toContain('Suite stable.');
    expect(String(detached[detached.length - 1].content)).toContain('Working directory: /tmp/dossier-alpha');
    expect(String(detached[detached.length - 1].content)).toContain('Project: dossier-alpha');
    expect(String(detached[detached.length - 1].content)).toContain('Current date: 2026-10-04');

    const other = detachVolatileContext([
      { role: 'system' as const, content: beta },
      { role: 'user' as const, content: 'Réponds uniquement le mot ok.' },
    ]);
    expect(other[0].content).toBe(detached[0].content);
  });

  it('ne déplace pas un Project: indenté ni un context de middleware', () => {
    const prompt = [
      'stable',
      '  Project: indented',
      '<context type="middleware-hint">',
      '- Working directory: /tmp/secret',
      '</context>',
    ].join('\n');
    expect(relocateVolatileSuffix(prompt)).toBe(prompt);
  });
});
