/**
 * Le thalamus cognitif — porte d'attention sur les rapports d'une flotte.
 *
 * Transposition de `buddy-sense/src/bus.rs` à l'étage cognitif. Trois principes repris tels
 * quels, un ajouté.
 *
 * REPRIS — un seuil d'escalade au-delà duquel rien n'est retenu ni fusionné ; un lot d'attention
 * BORNÉ (on ne remonte pas cinquante choses, on en remonte quelques-unes) ; les plus saillants
 * servis d'abord, l'ordre d'arrivée préservé à saillance égale.
 *
 * AJOUTÉ — dans un cerveau, deux capteurs qui signalent la même chose renforcent le signal ; ils
 * ne l'annulent pas. C'est aussi ce que fait le graphe de connaissance collectif : « un fait sur
 * lequel des agents indépendants s'accordent gagne en confiance ». Ici, un défaut trouvé par
 * DEUX ANGLES DIFFÉRENTS est donc plus saillant, pas moins — la coalescence fusionne la
 * répétition et ÉLÈVE le survivant.
 *
 * La corroboration ne compte qu'entre lignées de modèles distinctes : deux modèles du même
 * entraîneur se trompent souvent ensemble, les compter deux fois fabriquerait de la fausse
 * confiance.
 *
 * @module fleet/consolidation/thalamus
 */

import type { Constat, ConstatAdmis, Consequence, Digest } from './types.js';

/** Au-delà, un constat remonte immédiatement et n'est jamais fusionné ni retenu. */
export const SEUIL_ESCALADE = 128;

/** Combien de constats non escaladés remontent au plus dans un digest. */
export const LOT_ATTENTION = 12;

/** Saillance de base, par ce que le défaut COÛTE. */
const POIDS: Readonly<Record<Consequence, number>> = {
  'regression-securite': 150,
  'corruption-donnees': 140,
  'perte-silencieuse': 110,
  'promesse-non-tenue': 70,
  plantage: 60,
  friction: 35,
  cosmetique: 10,
};

/** Ce qu'ajoute chaque confirmation indépendante. Plafonné : trois avis ne valent pas dix. */
const BONUS_CORROBORATION = 25;
const MAX_CORROBORATION = 2;

/**
 * Un constat SUSPECTÉ ne peut pas escalader, quelle que soit sa gravité annoncée.
 *
 * Sans cette règle, une flotte de treize moteurs produit treize alarmes : il suffit qu'un
 * modèle écrive « faille critique possible » pour réveiller quelqu'un. La gravité annoncée
 * n'est pas une mesure ; la reproduction en est une.
 */
const PLAFOND_NON_REPRODUIT = SEUIL_ESCALADE - 1;

/**
 * Deux constats décrivent-ils le même défaut ?
 *
 * Une clé exacte ne suffit pas : deux moteurs qui trouvent la MÊME chose la formulent
 * différemment. Mesuré sur la moisson réelle du 25/08 — « le ledger jsonl est écrit par deux
 * processus sans atomicité garantie » et « le ledger jsonl est écrit sans atomicité par le
 * moteur rust » sont le même défaut, et une clé par mots triés les séparait. Zéro fusion sur
 * douze constats dont quatre étaient des doublons : la corroboration ne se déclenchait jamais,
 * donc la partie la plus utile du thalamus était morte.
 *
 * On compare donc par recouvrement de vocabulaire (Jaccard), avec un seuil, et on exige que le
 * lieu concorde quand les deux le renseignent — sinon deux défauts voisins dans des fichiers
 * différents fusionneraient à tort.
 */
function motsUtiles(texte: string): Set<string> {
  return new Set(
    texte
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((m) => m.length > 3),
  );
}

/** Au-dessous, ce sont deux défauts distincts. Réglé sur la moisson réelle. */
const SEUIL_SIMILARITE = 0.45;

function memeDefaut(a: Constat, b: Constat): boolean {
  const la = (a.ou ?? '').trim().toLowerCase();
  const lb = (b.ou ?? '').trim().toLowerCase();
  // Deux lieux connus et différents : jamais le même défaut, quelle que soit la formulation.
  if (la && lb && la !== lb) return false;
  const ma = motsUtiles(a.resume);
  const mb = motsUtiles(b.resume);
  if (ma.size === 0 || mb.size === 0) return false;
  let communs = 0;
  for (const m of ma) if (mb.has(m)) communs += 1;
  const union = ma.size + mb.size - communs;
  return union > 0 && communs / union >= SEUIL_SIMILARITE;
}

function saillance(c: Constat, corroborations: number): number {
  const base = POIDS[c.consequence];
  const bonus = Math.min(corroborations, MAX_CORROBORATION) * BONUS_CORROBORATION;
  const brute = base + bonus;
  return c.reproduit ? brute : Math.min(brute, PLAFOND_NON_REPRODUIT);
}

/**
 * Passe une moisson de constats par la porte d'attention.
 *
 * Rend ce qui doit interrompre maintenant (`escalades`), ce qui mérite d'être lu ensuite
 * (`admis`, borné au lot d'attention), et de quoi savoir ce qu'on n'a pas lu (`coalesces`,
 * `par_angle`, `par_consequence`) — car un digest qui cache ce qu'il a écarté ment par omission.
 */
export function consolider(constats: readonly Constat[]): Digest {
  // Regroupement par similarité : chaque constat rejoint le premier groupe dont il partage
  // le défaut. L'ordre d'arrivée est conservé, ce qui garde le tri stable plus bas.
  const groupes: Constat[][] = [];
  for (const c of constats) {
    const g = groupes.find((groupe) => groupe.some((autre) => memeDefaut(autre, c)));
    if (g) g.push(c);
    else groupes.push([c]);
  }

  const admis: ConstatAdmis[] = [];
  let coalesces = 0;

  for (const groupe of groupes) {
    coalesces += groupe.length - 1;
    // Le représentant est celui qui apporte la meilleure preuve : reproduit d'abord,
    // puis conséquence la plus lourde. Fusionner en gardant le plus vague perdrait la preuve.
    const tri = [...groupe].sort(
      (a, b) =>
        Number(b.reproduit) - Number(a.reproduit) || POIDS[b.consequence] - POIDS[a.consequence],
    );
    const chef = tri[0]!;
    const lignees = new Set(groupe.map((c) => c.lignee));
    const corroborations = Math.max(0, lignees.size - 1);
    const s = saillance(chef, corroborations);
    admis.push({
      ...chef,
      saillance: s,
      corrobore_par: groupe.filter((c) => c !== chef).map((c) => c.mission),
      escalade: s >= SEUIL_ESCALADE,
    });
  }

  // Les plus saillants d'abord ; à saillance égale, l'ordre d'arrivée est conservé —
  // `sort` est stable, et `admis` suit l'ordre des groupes, lui-même l'ordre d'insertion.
  admis.sort((a, b) => b.saillance - a.saillance);

  const escalades = admis.filter((c) => c.escalade);
  const reste = admis.filter((c) => !c.escalade).slice(0, LOT_ATTENTION);

  const compter = <K extends string>(cle: (c: ConstatAdmis) => K): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const c of admis) m[cle(c)] = (m[cle(c)] ?? 0) + 1;
    return m;
  };

  return {
    escalades,
    admis: reste,
    coalesces,
    par_angle: compter((c) => c.angle),
    par_consequence: compter((c) => c.consequence),
  };
}
