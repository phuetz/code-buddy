/**
 * Le collecteur — ce qui donne au thalamus de quoi travailler.
 *
 * Un mécanisme d'attention qui n'est branché sur rien est du câblage mort : c'est
 * précisément le défaut que les audits de ce dépôt cherchent (« enregistré d'un côté, jamais
 * consommé de l'autre »). Ce module est la connexion.
 *
 * Deux voies, à dessein. Les missions FUTURES déposent un fichier `constats.json` : le format
 * est explicite, rien n'est deviné. Les rapports DÉJÀ écrits — dix rapports Markdown produits
 * dans la nuit du 25/08 — sont lus par extraction, avec une règle stricte : ce qui n'est pas
 * clairement identifiable n'est PAS inventé, il est signalé comme non extrait.
 *
 * @module fleet/consolidation/collecte
 */

import fs from 'fs';
import path from 'path';
import type { Constat, Consequence } from './types.js';

const CONSEQUENCES: readonly Consequence[] = [
  'regression-securite',
  'corruption-donnees',
  'perte-silencieuse',
  'promesse-non-tenue',
  'plantage',
  'friction',
  'cosmetique',
];

/** Ce qu'une lecture rend : ce qu'on a compris, et ce qu'on n'a pas su lire. */
export interface Recolte {
  readonly constats: readonly Constat[];
  /** Fichiers lus sans qu'on en tire un seul constat exploitable. Un silence doit se voir. */
  readonly muets: readonly string[];
}

function estConsequence(v: unknown): v is Consequence {
  return typeof v === 'string' && (CONSEQUENCES as readonly string[]).includes(v);
}

/**
 * Lit un `constats.json` déposé par une mission.
 *
 * Un objet qui ne porte pas les champs obligatoires est IGNORÉ, pas complété par défaut :
 * un constat sans conséquence déclarée deviendrait « cosmétique » et disparaîtrait du digest,
 * ou « sécurité » et réveillerait quelqu'un. Les deux sont pires que l'absence.
 */
export function lireConstatsJson(fichier: string): Recolte {
  let brut: unknown;
  try {
    brut = JSON.parse(fs.readFileSync(fichier, 'utf-8')) as unknown;
  } catch {
    return { constats: [], muets: [fichier] };
  }
  const liste = Array.isArray(brut) ? brut : [];
  const constats: Constat[] = [];
  for (const item of liste) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o.mission !== 'string' ||
      typeof o.angle !== 'string' ||
      typeof o.lignee !== 'string' ||
      typeof o.resume !== 'string' ||
      !estConsequence(o.consequence) ||
      typeof o.reproduit !== 'boolean'
    ) {
      continue;
    }
    constats.push({
      mission: o.mission,
      angle: o.angle,
      lignee: o.lignee,
      resume: o.resume,
      consequence: o.consequence,
      reproduit: o.reproduit,
      ...(typeof o.ou === 'string' ? { ou: o.ou } : {}),
      ...(typeof o.preuve === 'string' ? { preuve: o.preuve } : {}),
    });
  }
  return { constats, muets: constats.length === 0 ? [fichier] : [] };
}

/** Rassemble tous les `constats.json` d'un dossier (non récursif : une mission, un fichier). */
export function collecter(dossier: string): Recolte {
  if (!fs.existsSync(dossier)) return { constats: [], muets: [] };
  const constats: Constat[] = [];
  const muets: string[] = [];
  for (const nom of fs.readdirSync(dossier).sort()) {
    if (!nom.endsWith('.constats.json') && nom !== 'constats.json') continue;
    const r = lireConstatsJson(path.join(dossier, nom));
    constats.push(...r.constats);
    muets.push(...r.muets);
  }
  return { constats, muets };
}
