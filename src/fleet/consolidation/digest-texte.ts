/**
 * Rendre le digest lisible — la sortie du « global workspace ».
 *
 * Ce texte remplace la lecture de douze rapports. Il doit donc être honnête sur ce qu'il ne
 * montre pas : un digest qui cache ses omissions ment par construction, et c'est plus grave
 * qu'un rapport long, parce qu'il inspire confiance.
 *
 * @module fleet/consolidation/digest-texte
 */

import type { ConstatAdmis, Digest } from './types.js';

function ligne(c: ConstatAdmis): string {
  const corr =
    c.corrobore_par.length > 0
      ? `  ↳ confirmé indépendamment par ${c.corrobore_par.join(', ')}`
      : '';
  const lieu = c.ou ? `  (${c.ou})` : '';
  const preuve = c.reproduit ? '' : '  ⚠ NON REPRODUIT';
  return `  ${String(c.saillance).padStart(3)} · ${c.consequence.padEnd(20)} ${c.resume}${lieu}${preuve}${corr}`;
}

export function rendreDigest(d: Digest, total: number): string {
  const l: string[] = [];
  const retenus = d.escalades.length + d.admis.length;
  l.push(`MOISSON — ${total} constats, ${d.coalesces} doublon(s) fusionné(s)`);
  l.push('');

  if (d.escalades.length > 0) {
    l.push(`⚠️  À TRAITER MAINTENANT (${d.escalades.length})`);
    for (const c of d.escalades) l.push(ligne(c));
    l.push('');
  } else {
    l.push('Rien qui exige une interruption.');
    l.push('');
  }

  if (d.admis.length > 0) {
    l.push(`À LIRE ENSUITE (${d.admis.length})`);
    for (const c of d.admis) l.push(ligne(c));
    l.push('');
  }

  // Ce qui n'a pas été montré doit être DIT, pas tu. Sans cette ligne, le digest laisse croire
  // qu'il a tout rendu — et une découverte écartée devient une découverte perdue.
  const ecartes = total - d.coalesces - retenus;
  if (ecartes > 0) {
    l.push(`${ecartes} constat(s) de moindre saillance non détaillés ici — ils restent dans les rapports.`);
  }
  const parAngle = Object.entries(d.par_angle)
    .sort((a, b) => b[1] - a[1])
    .map(([a, n]) => `${a}:${n}`)
    .join(' · ');
  l.push(`Angles : ${parAngle}`);
  return l.join('\n');
}
