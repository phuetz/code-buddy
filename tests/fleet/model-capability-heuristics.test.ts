/**
 * inferTaskType — accents indicate the LANGUAGE of a task, not its TYPE.
 *
 * Pinned after a live misroute: a French-written technical task ("…fichiers
 * JSON… migrer vers SQLite ?") was classified `french` (accent fallback) and
 * got the Clarificateur/Critique/Synthèse roles instead of
 * Architect/Implementer/Reviewer.
 */
import { describe, expect, it } from 'vitest';
import { inferTaskType } from '../../src/fleet/model-capability-heuristics.js';

describe('inferTaskType', () => {
  it('recognises the five literary scoreboard categories before generic fallbacks', () => {
    expect(inferTaskType('Écris le chapitre 5 de ce roman en français')).toBe('redaction-fr');
    expect(inferTaskType("Tranche cet arbitrage d'auteur entre les deux versions")).toBe('arbitrage-litteraire');
    expect(inferTaskType('Juge ces quatre versions à l’aveugle')).toBe('jugement-litteraire');
    expect(inferTaskType('Attaque ce dispositif avec un audit adversarial')).toBe('audit-adversarial');
    expect(inferTaskType('Relis la typographie et la ponctuation')).toBe('relecture-typo');
    expect(inferTaskType('Rédige une synthèse claire')).toBe('redaction-fr');
    expect(inferTaskType('Tranche entre ces deux options')).toBe('arbitrage-litteraire');
  });

  it('routes French-written technical tasks to code, not french', () => {
    expect(
      inferTaskType(
        'Notre CLI Node.js stocke ses sessions en fichiers JSON individuels (~5000 sessions, écritures concurrentes possibles depuis 2 process). Faut-il migrer vers SQLite ? Tranche clairement oui ou non, puis donne le plan.',
      ),
    ).toBe('code');
    expect(inferTaskType('Faut-il migrer notre base de données vers PostgreSQL ?')).toBe('code');
    expect(inferTaskType("Quel est l'avantage principal de TypeScript ?")).toBe('code');
    expect(inferTaskType('Déploie le serveur sur la machine de prod')).toBe('code');
  });

  it('keeps the historical code/reasoning/vision routing', () => {
    expect(inferTaskType('Fix the bug in the login function')).toBe('code');
    expect(inferTaskType('Prove that this algorithm terminates')).toBe('reasoning');
    expect(inferTaskType('Analyse la stratégie de cette entreprise')).toBe('reasoning');
    expect(inferTaskType('Describe this screenshot')).toBe('vision');
  });

  it('still classifies non-technical French prose as french (accent fallback, LAST)', () => {
    expect(inferTaskType("Écris-moi un poème sur l'été en Provence")).toBe('french');
    expect(inferTaskType('Quelle est la météo prévue à Paris cet été ?')).toBe('french');
  });

  it('falls back to general for plain accent-free prose', () => {
    expect(inferTaskType('Combien de fois la lettre e apparait dans le mot anticonstitutionnellement ?')).toBe(
      'general',
    );
    expect(inferTaskType('What should I cook tonight?')).toBe('general');
  });
});
