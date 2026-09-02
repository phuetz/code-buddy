/**
 * Garde-fou : ce dépôt est PUBLIC, la situation personnelle de son auteur n'y entre pas.
 *
 * `phuetz/code-buddy` est ouvert et sert de carte de visite. Le 25/08/2026, 31 fichiers
 * non poussés y nommaient l'indemnisation chômage, le cumul ARE et le client public de
 * l'auteur — dans le code, les README, la documentation, et jusque dans les fixtures de
 * tests, où « France Travail » servait de sujet d'essai. Rien n'était encore poussé ;
 * un push l'aurait rendu définitif, un commit ultérieur n'effaçant pas l'historique.
 *
 * Une consigne se perd. Un test échoue. C'est pourquoi cette règle est écrite ici plutôt
 * que dans un document que personne ne relira.
 *
 * Le mécanisme d'exclusion éditoriale reste, lui, parfaitement légitime : un créateur ne
 * traite pas les sujets où il est partie prenante. C'est la LISTE qui n'a pas sa place
 * dans un dépôt public, puisqu'elle dit exactement ce qu'elle sert à taire. Elle vit dans
 * `INFLUENCER_EXCLUDED_TOPICS` (voir `scripts/influencer/editorial_policy.py`).
 *
 * Pour un test qui a besoin d'un sujet écarté, utiliser un témoin neutre — « organisme
 * témoin » — et poser la politique dans le test lui-même.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const RACINE = join(__dirname, '..', '..');

/** Ce qui identifie la situation personnelle ou l'infrastructure privée de l'auteur. */
const INTERDITS = [
  'france travail',
  'pôle emploi',
  'pole emploi',
  'assurance chômage',
  'assurance chomage',
  'cumul are',
  'prestataire de la ccas',
  'demandeur d\'emploi',
  '100.73.',
  'darkstar',
];

/** Ce fichier cite forcément les termes : c'est son objet. */
const EXEMPTS = new Set(['CHANGELOG.md', 'tests/security/donnees-personnelles.test.ts']);

function fichiersSuivis(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: RACINE, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXEMPTS.has(f))
    // Les binaires n'ont pas de texte à inspecter, et leur lecture coûterait cher.
    .filter((f) => !/\.(png|jpe?g|gif|mp[34]|wav|webm|mov|pdf|zip|woff2?|ico|onnx|bin)$/i.test(f));
}

describe('aucune donnée personnelle dans un dépôt public', () => {
  it('aucun fichier suivi ne nomme la situation ou l’infrastructure privée de l’auteur', () => {
    const fautifs: string[] = [];

    for (const fichier of fichiersSuivis()) {
      let contenu: string;
      try {
        contenu = readFileSync(join(RACINE, fichier), 'utf8').toLowerCase();
      } catch {
        continue; // fichier supprimé ou illisible : rien à inspecter
      }
      const trouves = INTERDITS.filter((terme) => contenu.includes(terme));
      const cheminNormalise = fichier.toLowerCase();
      for (const terme of INTERDITS) {
        if (cheminNormalise.includes(terme) && !trouves.includes(terme)) {
          trouves.push(terme);
        }
      }
      if (trouves.length > 0) {
        fautifs.push(`${fichier} → ${trouves.join(', ')}`);
      }
    }

    expect(
      fautifs,
      'Ce dépôt est public. Ces termes désignent la situation ou l’infrastructure privée de son auteur et ' +
        'ne doivent pas y figurer — pas même comme sujet d’essai dans un test.\n' +
        'Pour un test : utiliser « organisme témoin » et poser INFLUENCER_EXCLUDED_TOPICS ' +
        'dans le test lui-même.\n' +
        'Pour un document de travail : le dépôt privé phuetz/claude-et-patrice.\n\n' +
        fautifs.join('\n'),
    ).toEqual([]);
  });
});
