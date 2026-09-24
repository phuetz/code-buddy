# Réparation — jeton WebChat ignoré pendant la reconnexion

État **source** : `origin/main` `6f745f0e8`.
État **candidat** au départ : branche `test/catalogue-routes-http-2026-09-23`, HEAD `e4c52dc57`.
État **candidat** à la fin : même branche, commit `defb462ec` ajouté, historique non réécrit.
État **déployé** : inchangé. Aucun push, aucune fusion, aucun service réel, profil utilisateur non ouvert.

## Défaut

Dans la page WebChat, `sendAuth` ne retenait le jeton que si la socket était déjà ouverte. Après `Authentication failed`, le serveur ferme la socket et la page programme une reconnexion. Un jeton saisi dans cet intervalle était ignoré. À l'ouverture suivante, l'ancien jeton était renvoyé.

## Correctif

`sendAuth` retient d'abord le jeton saisi, puis n'envoie la trame que si la socket est ouverte. Sur `Authentication failed`, le jeton retenu est effacé : la reconnexion ne le renvoie pas. Une saisie explicite pendant la coupure le remplace et part à l'ouverture suivante. Une coupure sans refus conserve le jeton déjà accepté.

Commit : `defb462ec` `fix(webchat): mémoriser le jeton saisi pendant la reconnexion`.

## Preuves

Rouge, avant le correctif, filtre `page WebChat` : 2 échecs, 3 réussites, 83 ignorés (88). Messages :

`jeton corrigé ignoré pendant la reconnexion` — la seconde trame restait `mauvais` au lieu de `bon-jeton`.

`jeton refusé réutilisé` — la reconnexion renvoyait une seconde trame `mauvais`.

Vert, même filtre : 5 réussites, 83 ignorés. Puis les quatre fichiers du domaine et de l'appelant catalogue : 119 réussites, 0 échec.

| Fichier | Tests |
|---|---|
| `tests/channels/webchat.test.ts` | 88 |
| `tests/server/catalogue-routes-http-a.test.ts` | 15 |
| `tests/server/catalogue-routes-http-b.test.ts` | 13 |
| `tests/server/catalogue-routes-http-isolation.test.ts` | 3 |
| **Total** | **119** |

Mutant qui rétablit le retour avant mémorisation : `jeton corrigé ignoré pendant la reconnexion`, le bon jeton n'est pas envoyé. Mutant qui retire l'oubli du jeton refusé : `jeton refusé réutilisé`. Les deux fichiers ont été restaurés.

`npx tsc --noEmit` : 0. `eslint --quiet` sur les quatre fichiers touchés : 0. `tests/security/donnees-personnelles.test.ts` : 40 réussites sur l'arbre avant le commit documentaire.

Chromium headless, vrai canal sur un port lié : champ bloqué au départ, statut `Disconnected` après le mauvais jeton, puis `Connected` et champ actif après le bon jeton saisi pendant la coupure. L'accueil `Welcome to Catalogue WebChat!` suit `Authentication failed`.

Barrière Docker, réseau coupé, 27 contrôles, synthèse `BARRIERE_OK`. Dans cette copie, `tests/channels/webchat.test.ts` : 88 réussites.

## Ce que je n'ai pas pu vérifier

- Le push et l'état distant de la PR. Le commit reste local.
- Windows et macOS.
- La suite complète du dépôt.
- Le catalogue HTTP dans la barrière Docker de cette reprise. Sur l'hôte, les quatre fichiers sont verts. La barrière précédente avait déjà deux échecs `checks.database` sans rapport avec ce jeton ; ils n'ont pas été rejoués ici.
- Un navigateur autre que Chromium headless sous Linux.
