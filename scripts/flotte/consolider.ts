#!/usr/bin/env -S npx tsx
/**
 * Consolider les constats d'une vague de missions.
 *
 *   npx tsx scripts/flotte/consolider.ts <dossier>
 *
 * Le dossier contient un `<mission>.constats.json` par mission. Ce script les passe par la
 * porte d'attention et rend ce qui mérite d'être lu — le reste attend dans les rapports.
 */
import path from 'path';
import { collecter } from '../../src/fleet/consolidation/collecte.js';
import { consolider } from '../../src/fleet/consolidation/thalamus.js';
import { rendreDigest } from '../../src/fleet/consolidation/digest-texte.js';

const dossier = process.argv[2];
if (!dossier) {
  console.error('usage : consolider.ts <dossier contenant les *.constats.json>');
  process.exit(2);
}
const { constats, muets } = collecter(path.resolve(dossier));
if (constats.length === 0) {
  console.error(`aucun constat exploitable dans ${dossier}`);
  if (muets.length > 0) console.error(`fichiers lus sans constat : ${muets.join(', ')}`);
  process.exit(1);
}
console.log(rendreDigest(consolider(constats), constats.length));
if (muets.length > 0) {
  console.log(`\n⚠ ${muets.length} fichier(s) lus sans en tirer de constat : ${muets.join(', ')}`);
}
