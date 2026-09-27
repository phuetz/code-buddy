/**
 * Tours d'itération d'App Studio : édition ciblée, verrous, mode discussion,
 * et bulle de chat qui n'affiche que la demande.
 */
import { describe, expect, it } from 'vitest';

import {
  IMPLEMENT_PLAN_PROMPT,
  buildIterationPrompt,
  isPathLocked,
  lockedPathsTouched,
  revertNote,
  toggleLock,
} from '../src/renderer/components/studio/iteration-prompt';
import { sessionToStudioMessages, visibleUserText } from '../src/renderer/components/studio/studio-chat-adapter';

describe('buildIterationPrompt', () => {
  it('mode construire : consigne d’édition ciblée + demande en fin', () => {
    const p = buildIterationPrompt('  Ajoute un bouton  ');
    expect(p.startsWith('[App Studio — modification ciblée]')).toBe(true);
    expect(p).toContain('str_replace');
    expect(p).toContain('ne réécris pas un fichier entier');
    expect(p.endsWith('Demande :\nAjoute un bouton')).toBe(true);
    expect(p).not.toContain('VERROUILLÉS');
  });

  it('rappelle les fichiers verrouillés', () => {
    const p = buildIterationPrompt('x', { lockedFiles: ['src/theme.css', 'src/api'] });
    expect(p).toContain('VERROUILLÉS');
    expect(p).toContain('- src/theme.css\n- src/api');
  });

  it('mode discussion : interdit toute modification et propose un plan', () => {
    const p = buildIterationPrompt('Et si on ajoutait un mode sombre ?', { mode: 'discuss' });
    expect(p.startsWith('[App Studio — mode discussion]')).toBe(true);
    expect(p).toContain('Ne modifie AUCUN fichier');
    expect(p).toContain('plan numéroté');
    expect(p).not.toContain('str_replace');
  });
});

describe('verrous', () => {
  it('fichier exact ou dossier parent', () => {
    expect(isPathLocked('src/App.tsx', ['src/App.tsx'])).toBe(true);
    expect(isPathLocked('src/api/client.ts', ['src/api'])).toBe(true);
    expect(isPathLocked('src/apiX.ts', ['src/api'])).toBe(false);
    expect(isPathLocked('src\\api\\client.ts', ['./src/api/'])).toBe(true);
  });

  it('lockedPathsTouched ne garde que les chemins verrouillés, triés, sans doublon', () => {
    expect(lockedPathsTouched(['b.ts', 'src/App.tsx', 'src/App.tsx', 'a/x.ts'], ['src/App.tsx', 'a'])).toEqual([
      'a/x.ts',
      'src/App.tsx',
    ]);
    expect(lockedPathsTouched(['x'], [])).toEqual([]);
  });

  it('toggleLock ajoute puis retire', () => {
    const once = toggleLock([], 'src/App.tsx');
    expect(once).toEqual(['src/App.tsx']);
    expect(toggleLock(once, 'src/App.tsx')).toEqual([]);
  });

  it('revertNote', () => {
    expect(revertNote([], 'build')).toBeNull();
    expect(revertNote(['a.ts'], 'build')).toContain('verrouillé');
    expect(revertNote(['a', 'b', 'c', 'd'], 'discuss')).toContain('Mode discussion : 4 modification(s) annulée(s) (a, b, c…)');
  });
});

describe('bulle de chat', () => {
  it('affiche la demande, pas l’enveloppe', () => {
    expect(visibleUserText(buildIterationPrompt('Ajoute un bouton', { lockedFiles: ['a.ts'] }))).toBe('Ajoute un bouton');
    expect(visibleUserText(buildIterationPrompt('Idée ?', { mode: 'discuss' }))).toBe('💬 Idée ?');
    expect(visibleUserText(buildIterationPrompt(IMPLEMENT_PLAN_PROMPT))).toBe(IMPLEMENT_PLAN_PROMPT);
    expect(visibleUserText('message libre')).toBe('message libre');
    const out = sessionToStudioMessages([
      { id: '1', role: 'user', content: [{ type: 'text', text: buildIterationPrompt('Rends-le bleu') }] },
    ]);
    expect(out).toEqual([{ id: '1', role: 'user', text: 'Rends-le bleu' }]);
  });
});
