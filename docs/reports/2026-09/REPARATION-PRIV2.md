# REPARATION-PRIV2 — plus aucune donnée privée dans le dépôt public

**Mission** : PRIV2. Retirer du dépôt PUBLIC toute IP privée, tout nom de machine de
l'auteur, tout identifiant de projet tiers, tout solde de crédits / niveau d'abonnement
et tout sujet médical.

**Date** : 2026-09-04 · **Agent** : Fable 5.1 (Opus 5)
**Clone** : `~/DEV/cb-priv2-2026-09-04` · **Branche** : `fix/priv2-ip-machine-uuid-2026-09-04`
**Base** : branche `codex/audit-systeme-nerveux-2026-09-01`, HEAD de départ `7bfc3a85d`.

> Ce rapport est créé AVANT toute inspection. Il ne contient AUCUNE valeur sensible :
> les IP, noms de machine et UUID y sont tronqués ou décrits, jamais cités en clair.

## Plan

1. Réservation dans `docs/FABLE5-CODEX-COORDINATION.md` + copie assainie du rapport de revue.
2. Mesure : `git grep -n` par famille (a) IP privées, (b) nom de machine, (c) UUID Flow,
   (d) soldes/abonnement, (e) sujet médical, (f) chemins home encodés.
3. Remplacement avec discernement, famille par famille.
4. Extension du garde-fou `tests/security/donnees-personnelles.test.ts` + preuve des deux sens.
5. Vérifications et bilan.

## 1. Mesure avant nettoyage

_(à remplir)_

## 2. Remplacements

_(à remplir)_

## 3. Garde-fou

_(à remplir)_

## 4. Vérifications

_(à remplir)_

## 5. Ce qui reste

_(à remplir)_
