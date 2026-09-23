# Découpage de la PR #186 en PR thématiques — 23/09/2026

Agent : Opus 5.5 (Claude Code), à la demande de Patrice.

## Constat de départ

La PR #186, intitulée `fix(deps): trois paquets importés à l'exécution vivaient en devDependencies`,
portait en réalité **44 commits sur 40 fichiers** (tête `5d947f8c`) : la branche avait accumulé des
scripts de génération de médias, des scripts de flotte, des
rapports et plusieurs correctifs du produit. La fusion a été refusée par GitHub (conflits sur 9
fichiers après les fusions #189-#193 du jour). Sans ce conflit, tout ce contenu serait parti sur le
dépôt public sous un titre `fix(deps)`.

## Méthode

- Worktree dédié issu de `origin/main` (`08818884`), l'arbre de travail principal n'est pas touché.
- Un commit repris n'est porté que s'il a été relu ; les conflits sont résolus à la main.
- Les lignes du tableau de coordination portées par ces commits ne sont pas reprises (le tableau de
  `main` a été nettoyé par la #191).

## Découpage

Les 44 commits ont été classés par fichiers touchés, puis chaque correctif du
produit a été **rejoué contre `main`** avant d'être repris : trois étaient déjà
couverts par le travail du 13-14/09, et une lecture seule du code l'aurait fait
croire pour un quatrième qui ne l'était pas.

| Branche | Contenu | Origine #186 |
|---|---|---|
| `split186/deps` | `vscode-languageserver` et `-textdocument` passent en `dependencies` (`typescript` y était déjà depuis la #189) ; lock régénéré par npm | 18cef95f |
| `split186/tool-search` | mots-vides et 7 équivalents français portés sur la réécriture BM25 de `main` ; banc français ajouté | 7f8f56d0 |
| `split186/correctifs` | générateur d'intentions ancré dans le dépôt réel (+ 2 tests, absents de la #186) ; commentaire de types corrigé ; `.gitignore` des skills tierces | d0a43f31 (src), 5d947f8c, 3d17527a |
| `split186/docs` | inventaire des fonctionnalités, bancs Jev et porte de revue, verdict CI Windows, ce rapport | 5425f4d8, d0a43f31 (docs), e1729624, b9625fe7, 11d32ab6, 0869ab6d |
| `split186/flotte` | `deleguer.sh` (4 réglages dont MemoryMax=40G) ; `lane_lib.sh` + doc + test | 0ea0b834, 1103fb4f, 45f39a70, 7daa5a28, a01f08c6 |

### Écartés parce que `main` les couvre déjà

- `fix(self-improvement)` (2dc3c74c) : même hachage sha256 et même lecture
  héritée depuis `ab9920c8` (13/09). Le test de la #186 échoue sur `main`, mais
  les messages d'assertion montrent pourquoi : `main` a durci `read()`
  (`targetScenarioId`, `gate.scenarioId`, `gate.proposalId`) et les données du
  test ne les portent pas. Le test de collision propre à `main` passe (8/8).
- `test(sensory)` (859ecdba) : `main` isole un profil complet, dont
  `CODEBUDDY_SENSORY_STATUS_FILE`, depuis `eb2ffc85` (14/09).
- `.codebuddy/TOOLS.md` (c847cfd3) : auto-généré au démarrage depuis le
  registre ; un instantané du 21/09 serait déjà périmé.
- Lignes du tableau de coordination (4 commits) : `main` l'a nettoyé en #191.

### Non publiés : dépôt public inadapté

- **Médias** (25 commits) : pilotes de génération audio et vidéo, leurs fichiers
  de tâches, leurs rapports, et des éléments de comptes de publication. Ce sont
  des outils de production personnels, pas le produit.
- **Rapports d'infrastructure privée** : audits des scripts `_qa/lanes/`
  (répertoire ignoré par git), rapport de garde mémoire (machines, ssh,
  passations). L'audit qwen3.7-flash contient d'ailleurs un faux positif :
  il juge dangereux `pgrep -f 'opencode ru[n]'`, qui est précisément la parade
  à l'auto-détection.

Ces commits restent intacts sur la branche distante
`fix/dependances-execution-2026-09-19` et sur la branche locale
`feat/index-vectoriel-rust-2026-09-21` : rien n'est perdu.

### Défauts trouvés en reprenant

- `tests/scripts/lane_lib.test.sh` chargeait la bibliothèque par un chemin
  absolu vers un worktree d'audit personnel : il ne tournait que sur une
  machine, et y testait une copie figée. Chemin rendu relatif.
- Banc `tool-search` de la #186 : exigeait `view_file` en tête pour « voir le
  contenu », alors que `read_file` (outil distinct) est une réponse aussi
  juste. Assertion corrigée, pouvoir de détection conservé.
- Chemins et noms de dépôts personnels : un dans un banc, un dans un
  commentaire de `deleguer.sh`, un dans un message de commit ; reformulés.

## Vérifications

Toutes exécutées dans le worktree, sur `origin/main` = `08818884` :

- `split186/deps` : dépendances vérifiées dans `package.json` ; import
  d'exécution confirmé (`createConnection` dans `src/lsp/server.ts`).
- `split186/tool-search` : 11/11 sur les deux bancs ; banc français rejoué
  contre `main` → 1 échec (il prouve donc quelque chose) ; 5 fichiers voisins,
  61 tests verts ; `tsc --noEmit` 0.
- `split186/correctifs` : `tests/intents` 18/18 ; nouveau test rejoué contre
  l'ancienne logique → tombe ; `git check-ignore` sur les trois chemins, skill
  projet `code-buddy` toujours suivi ; `tsc --noEmit` 0.
- `split186/docs` : clé Jev absente des fichiers **et de tout l'historique
  git** (recherche sur un préfixe de la clé réelle).
- `split186/flotte` : `bash -n scripts/deleguer.sh` ; `lane_lib.test.sh` lancé
  depuis /tmp → 21 OK, 0 KO.
- Les cinq branches fusionnées ensemble sur `main` : aucun conflit,
  `tsc --noEmit` 0.

Non exécuté : la suite Vitest complète (~27 000 tests) ; la CI des PR en
tiendra lieu.

## Décisions laissées à Patrice

1. Pousser les cinq branches et ouvrir les cinq PR.
2. Fermer la #186 en renvoyant vers elles.
3. Où ranger les 25 commits médias : un dépôt privé.
