/**
 * Seed coverage benchmark for self-authored SKILLS. Each scenario is a situation
 * the agent should have reusable guidance for; an authored skill "covers" it when
 * its content surfaces the expected terms. Curated separately from any proposer.
 *
 * @module agent/self-improvement/skill-benchmark
 */

import type { SkillBenchmarkScenario } from './skill-types.js';

export const SEED_SKILL_SCENARIOS: SkillBenchmarkScenario[] = [
  {
    id: 'git-bisect',
    query: 'find which commit introduced a regression',
    expectIncludes: ['git bisect', 'good', 'bad'],
    description: 'guidance for bisecting a regression',
  },
  {
    id: 'safe-delete',
    query: 'delete files safely without losing data',
    expectIncludes: ['backup', 'dry run', 'confirm'],
    description: 'guidance for deleting files safely',
  },
  {
    id: 'relecture-typographique-francaise',
    query:
      'Relecture typographique française de premier passage pour documentation technique, rapports et fichiers markdown. ' +
      'Règles à appliquer : détection et correction des guillemets français « » avec leurs espaces, ' +
      'insertion d\'espaces insécables devant toute ponctuation double (; : ? !), ' +
      'remplacement de l\'apostrophe droite \' par l\'apostrophe typographique ’, ' +
      'correction de la virgule à l\'anglaise dans les nombres (distinguer virgule décimale française et séparateurs de milliers anglo-saxons), ' +
      'et sanctuarisation absolue des blocs de code clôturés par triples backticks ``` qui doivent être rigoureusement épargnés.',
    description: 'guidance pour la relecture typographique française de premier passage',
    visibleIncludes: ['guillemets', 'ponctuation', 'apostrophe', 'blocs de code'],
    heldOutIncludes: ['insécable', 'virgule'],
    expectIncludes: ['guillemets', 'ponctuation', 'apostrophe', 'blocs de code', 'insécable', 'virgule'],
  },
  {
    id: 'mission-contrat-lane',
    query:
      'Formaliser la méthode de travail rigoureuse pour une mission-contrat de lane d\'ingénierie logicielle autonome. ' +
      'Processus exigé : travailler dans un clone dédié pour isoler le travail (interdiction stricte d\'écrire dans l\'original), ' +
      'création du rapport d\'intervention avant toute inspection, ' +
      'isolation de l\'environnement de test avec HOME isolé, ' +
      'commits atomiques nommés après chaque point d\'étape (aucun git add global), ' +
      'fourniture de la preuve par l\'exécution des tests sur l\'ensemble des fichiers touchés, ' +
      'et rédaction finale d\'un bilan de dix lignes synthétique.',
    description: 'formalisation de la méthode de travail pour mission-contrat de lane',
    visibleIncludes: ['clone', 'rapport', 'commit', 'touché'],
    heldOutIncludes: ['home', 'lignes'],
    expectIncludes: ['clone', 'rapport', 'commit', 'touché', 'home', 'lignes'],
  },
];
