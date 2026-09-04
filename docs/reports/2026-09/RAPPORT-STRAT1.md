# RAPPORT STRAT1 — couche « stratégies » de la Darwin-Gödel Machine (04/09/2026, Fable 5.1)

Créé AVANT toute modification. Worktree `~/DEV/cb-strat1-2026-09-04`, branche
`feat/strat1-couche-strategies-2026-09-04`, base `0f5d5542c`.

## Pourquoi
La DGM de Code Buddy fait évoluer trois choses : leçons, outils, skills. Rien ne fait évoluer
**la façon dont l'agent exécute** : plafond de tours, plafond de coût, niveau de raisonnement,
exigences de vérification, consignes de méthode. Or la journée du 04/09 a montré que ce sont
précisément ces réglages que le pilote a dû corriger à la main (limite de 50 tours en headless →
300 ; « preuve = tests des fichiers touchés » ; « commiter après chaque point »). La proposition 4
de `AUDIT-DGM2.md` demandait cette couche, avec un schéma strict et un pare-feu ; elle n'existait
pas. Ce chantier la livre, avec une porte EMPIRIQUE et non un simple schéma.

## Contrat
- Aucune écriture dans `src/` par la machine : une stratégie est un JSON sous
  `.codebuddy/strategies/`, validé par un schéma Zod STRICT (toute clé inconnue rejetée).
- Aucun champ ne permet de désactiver un garde-fou : par construction, le schéma n'expose que des
  bornes (tours 1–400, coût 0–100 $), un niveau de raisonnement, deux exigences de vérification et
  au plus cinq consignes courtes, passées au pare-feu des skills (injection de prompt,
  exfiltration) plus une liste de verbes interdits (désactiver/contourner un garde-fou).
- Porte empirique : rejeu contrefactuel déterministe sur les expériences (journaux de lanes) +
  test de signe bayésien apparié de `paired-gate.ts` ; un évaluateur « live » (runs appariés)
  est injectable. Une candidate identique à sa mère est rejetée (inerte).
- Consommation opt-in : `CODEBUDDY_SELF_IMPROVE_STRATEGIES=true` seulement ; sans la variable,
  comportement octet pour octet identique (testé).

## Points (mis à jour au fil du travail)
