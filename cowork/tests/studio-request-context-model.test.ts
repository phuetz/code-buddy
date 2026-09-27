/** Modèle pur du contexte joint à une demande d'App Studio. */
import { describe, expect, it } from 'vitest';

import {
  buildContextBlock,
  cycleContextState,
  estimateRequestTokens,
  IMAGE_TOKEN_ESTIMATE,
  pickLogLines,
  targetBlock,
} from '../src/renderer/components/studio/request-context';

const location = { file: 'src/components/KpiCard.tsx', startLine: 11, endLine: 11, excerpt: '11|   <strong className="kpi-value">{value}</strong>', method: 'classe' as const };

describe('request-context', () => {
  it('élément local : modifier ces lignes seulement', () => {
    const block = targetBlock({ element: { tag: 'button', text: 'Ajouter' }, location: { ...location, file: 'src/Form.tsx' } });
    expect(block).toContain('- source : src/Form.tsx, lignes 11 à 11 (localisé par : classes CSS)');
    expect(block).toContain('Inutile de parcourir les autres fichiers.');
  });

  it('instance d’un composant réutilisé : prop + donnée, jamais « inutile de parcourir »', () => {
    const block = targetBlock({
      element: { tag: 'strong', text: '48 250 €' },
      location: { ...location, dataOrigin: { file: 'src/App.tsx', line: 6 } },
    });
    expect(block).toContain('composant RÉUTILISÉ');
    expect(block).toContain('(src/App.tsx, ligne 6)');
    expect(block).toContain('une classe CSS sans règle ne change rien');
    expect(block).not.toContain('Inutile de parcourir');
  });

  it('assemble cible, journaux, fichiers, exclusions, noms de secrets et image ; jamais de valeur', () => {
    const block = buildContextBlock({
      logs: [{ source: 'serveur', lines: ['[vite] error'] }],
      files: [{ path: 'a.ts', content: 'x' }],
      excluded: ['b.ts'],
      secretNames: ['VITE_API_KEY'],
      image: true,
    });
    expect(block).toContain('Journaux joints — serveur de dev (1 ligne(s))');
    expect(block).toContain('<fichier chemin="a.ts">\nx\n</fichier>');
    expect(block).toContain('Hors contexte — ne lis pas et ne modifie pas : b.ts');
    expect(block).toContain('VITE_API_KEY');
    expect(block).toContain('image de référence');
    expect(buildContextBlock({})).toBe('');
    expect(estimateRequestTokens('abcd', { image: true })).toBe(1 + IMAGE_TOKEN_ESTIMATE);
  });

  it('cycle de sélection et tri des journaux', () => {
    expect(cycleContextState(undefined)).toBe('inclus');
    expect(cycleContextState('inclus')).toBe('exclu');
    expect(cycleContextState('exclu')).toBeUndefined();
    expect(pickLogLines([{ level: 'info', message: 'ok' }, { level: 'error', message: 'ko', source: '/a.js', line: 3 }], true)).toEqual(['[error] ko (/a.js:3)']);
  });
});
