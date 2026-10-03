# Reprise 1 — pare-feu ECC, 03/10/2026

Les deux bloquants sont acceptés et corrigés. La réserve sur les substitutions Markdown était également un défaut : elle est corrigée. Les nouveaux tests reproduisent les trous de la tête relue avant correction ; huit mutations sont tuées par assertion. La barrière ciblée passe avec les rapports suivis ; le rejeu après les commits est joint au reçu de livraison.

Branche `fix/pare-feu-import-ecc-2026-10-03`, départ `8ec6ff16b3c9a1740da28dbf69021a8b7f1c65b2`, Linux / Node 24.14.1. Relecture adverse et mission d'origine lues intégralement. Rapport créé dans le dépôt avant les corrections ; copie destinée à `Partage/20261003-cb-pare-feu-ecc/reprise-1/sol61/RAPPORT.md`. Les preuves de reprise sont sous `_qa/pare-feu-ecc/reprise-1/` et seront recopiées avec le rapport. Les anciens livrables du partage sont conservés.

## Bloquants et réserves

| Point de la relecture | Traitement | Preuve |
|---|---|---|
| Bloquant 1 : chemin privé dans le rapport suivi ; les 1 831 verts précédaient son suivi Git | Chemin remplacé par une référence relative ; première livraison explicitement invalidée pour la tête `8ec6ff16b`. Aucun changement ni exemption du garde de confidentialité. Tous les nouveaux fichiers sont ajoutés nommément avant la barrière, puis la suite est rejouée après les commits. | `privacy-red.log` : 1 échec / 39 verts. Mutation `reviewed-private-report` : même échec. Validation finale sur HEAD ci-dessous. |
| Bloquant 2 : `helper.eval`, `this.eval`, `self.eval`, `runtime.eval`, `$eval` et scripts autorisés | Restauration de `\beval\s*\(`. Seule la mention Markdown de `model.eval()` sans argument, en contexte Python ou texte, devient documentaire et impose une revue. Les scripts et les autres appels restent critiques. | 9 charges × manifeste et script, modèle avec argument, faux bloc Python, script `model.eval()`, import avec/sans `includeReview` : quarantaine attendue. `scanner-red.log` : 20 rouges / 3 verts ; vert corrigé dans `initial-green.log`. |
| Substitutions arbitraires en Markdown : six `$(curl …)` importables avec `--include-review` | Exception bornée à `mktemp` seul, lecture `jq` d'un champ et expression `echo` vers `bc`, sans sous-commande. Les formes inconnues gardent les pénalités initiales ; six substitutions restent en quarantaine, score 40. | 5 charges répétées, dont sous-commande imbriquée et `mktemp; curl`, plus import avec/sans revue. CLI réelle `--apply --include-review` : 2 quarantaines, seul le témoin bénin copié (`hostile-cli.json`, `hostile-cli-assertions.json`). |
| Tests B trop faibles (`not quarantine`) | Huit verdicts exacts exigés ; PyTorch devient `review`, pas `allow`. | Tableau de régression dans `skill-firewall-ecc.test.ts`, huit tests rouges sous le scanner de la base initiale, rejeu réel des huit dossiers ci-dessous. |
| Test Node pris par l'ancienne règle `child_process` | Cas existant conservé et nommé comme tel ; ajout de `spawnSync(cmd)` sans mention du module. | Mutant `scanner-original` : 24 échecs, dont le nouveau cas Node ; correction : 35/35 verts. |
| Protection des skills auto-écrits, Exchange et registre insuffisamment prouvée | Tests des consommateurs réels sans mock du scanner, signature Ed25519 réelle en profil temporaire, registre sans watcher et garde d'écriture. Motif `eval` restauré identique au second scanner ; celui-ci conserve sa prudence pour PyTorch. | `helper.eval`, `runtime.eval`, `$eval` refusés par Exchange, registre et garde ; paquet bénin vérifié et chargé. 4/4 verts ; retour à la tête relue : ces 3 tests adverses rouges. |
| Frontmatter cassé sans `tools` | Le comportement historique des agents locaux sans politique déclarée est conservé. Ce cas ne perd aucune allowlist déclarée. L'import externe impose un frontmatter valide et une liste lisible ; ajout d'un test du cas cassé sans clé `tools`. | `skill-import-ecc.test.ts` : agent refusé, aucun fichier préparé. `agent-tools-ecc.test.ts` conserve le refus d'une liste déclarée illisible, ainsi que les 17 tests des chargeurs. Limite locale explicitée ci-dessous. |
| Dédoublonnage des traductions non mesuré dans ECC canonique | Affirmation bornée au test synthétique ; aucune locale sous `skills/` dans ce commit ECC. | 641 copies hors racine ignorées par CLI réelle ; test `skills/fr/demo` et mutant importeur rouge. |
| Trois commits historiques, deux nommés | Troisième commit ajouté au rapport historique. | Première livraison : `71e5f055c`, `994ff7415`, `8ec6ff16b`. Reçu de reprise séparé avec la tête finale et tous les nouveaux commits. |

Les tests supplémentaires sont dans `tests/security/skill-firewall-ecc-reprise.test.ts` et `tests/skills/skill-firewall-ecc-consumers.test.ts`. Les tests A/B antérieurs restent présents. Les hooks sont exclus ; aucun fichier de leur lane n'est modifié.

## Rejeu réel complet

Clone existant vérifié à `ef648e01899ba3e8dc6371642deaaf64b4477775`. Deux imports réellement appliqués, dans des HOME neufs sous `_qa/pare-feu-ecc/home/reprise-1-before` puis `reprise-1-after`, avec `CODEBUDDY_HOME` isolé :

```sh
node_modules/.bin/tsx src/index.ts skills import --dir <clone-ECC> --apply --agents --json
node_modules/.bin/tsx scripts/qa/scan-ecc.ts <clone-ECC> <sortie-json>
```

| Mesure | Tête relue avant reprise | Après reprise |
|---|---:|---:|
| Manifestes parcourus | 934 | 934 |
| Scanner complet : allow / review / quarantine | 696 / 143 / 95 | 690 / 145 / 99 |
| Import canonique `skills/` : copiés / quarantaine / revue | 208 / 42 / 43 | 206 / 44 / 43 |
| Ignorés avec raison « outside canonical » | 641 | 641 |
| Agents : revue désactivée / quarantaine / refus | 55 / 11 / 2 | 55 / 11 / 2 |

Les assertions relisent aussi les fichiers effectivement copiés dans chaque HOME : 208 avant, 206 après (`replay-assertions.json`). Les 293 manifestes canoniques se répartissent entièrement entre copiés, quarantaine et revue. Les 641 ignorés sont 518 copies sous `docs/` et 123 sous `pi/` ; aucune copie de ces racines n'est installée. Le parcours existant exclut les répertoires cachés. Ces nombres décrivent ce commit exact et ce parcours ; ils ne comptent pas des traductions dédoublonnées à l'intérieur de `skills/`.

| Cas original | Verdict après reprise | Score |
|---|---|---:|
| A : skill-comply | quarantine | 0 |
| A : homelab-wireguard-vpn | quarantine | 0 |
| A : social-publisher | review | 56 |
| B : pytorch-patterns | review | 100 |
| B : kotlin-patterns | allow | 100 |
| B : deep-research | review | 100 |
| B : tdd-workflow | review | 99 |
| B : safety-guard | review | 100 |
| B : defi-amm-security | allow | 90 |
| B : github-ops | review | 98 |
| B : healthcare-eval-harness | review | 100 |

Aucun cas A n'est importé ni autorisé avant ou après cette reprise. La reproduction initiale sur `70bcab004` (825 copiés, 63 quarantaines, 46 revues) est conservée dans le rapport historique ; elle n'est pas présentée comme un nouveau rejeu de la reprise.

Sept changements de verdict sur les 934 manifestes, dont trois canoniques :

| Chemin ECC | Avant → après | Score avant → après |
|---|---|---|
| `skills/generating-python-installer` | review → quarantine | 100 → 0 |
| `skills/pytorch-patterns` | allow → review | 100 → 100 |
| `skills/redis-patterns` | allow → quarantine | 91 → 46 |
| `docs/ja-JP/skills/redis-patterns` | allow → quarantine | 92 → 47 |
| `docs/zh-CN/skills/pytorch-patterns` | allow → review | 100 → 100 |
| `pi/core/skills/pytorch-patterns` | allow → review | 100 → 100 |
| `pi/core/skills/redis-patterns` | allow → quarantine | 91 → 46 |

Redis utilise un autre récepteur `eval` et l'installateur contient des substitutions hors exception : ils restent prudents. Aucune rétrogradation de quarantaine vers `allow`. Liste complète avec motifs dans `verdict-changes.json` et `CHANGEMENTS-VERDICTS.md`.

Rejeu des trois vrais agents via `scripts/qa/verify-ecc-agents.ts`, deux chargeurs et filtre des alias : planner a `view_file, search` et refuse Bash / `shell_exec` ; tdd-guide a les cinq outils attendus et les accepte ; security-reviewer a `view_file, search, bash`. Tous refusent Docker. Les copies préparées portent `disabled: true` ; zéro agent préparé actif. Preuve `agents-live.json`.

## Mutations et barrière

| Retour temporaire à l'ancien code | Assertions rouges | Restauration |
|---|---:|---|
| Scanner de `70bcab004` | 24 / 35 | octets restaurés dans `finally` |
| Importeur de `70bcab004` | 4 / 4 | idem |
| Chargeur Markdown de `70bcab004` | 9 / 17 | idem |
| Chargeur de définitions de `70bcab004` | 11 / 17 | idem |
| Chargeur YAML de `70bcab004` | 5 / 17 | idem |
| Filtre vide de `70bcab004` | 1 / 17 | idem |
| Scanner de la tête relue `8ec6ff16b` | 23 / 27 | octets et SHA-256 restaurés |
| Rapport privé de `8ec6ff16b` | 1 / 40 | octets et SHA-256 restaurés |

Ces rouges sont des échecs d'assertion, pas des erreurs de compilation ou des timeouts. Scripts reproductibles : `scripts/qa/verify-ecc-mutations.py <répertoire-sortie>` et `scripts/qa/verify-ecc-reprise-mutations.py`. Les anciens journaux sont conservés ; les preuves nouvelles ont leurs répertoires distincts. Aucun test normal ne tourne pendant une mutation des sources.

| Vérification | Résultat |
|---|---|
| Suite ciblée, tous les rapports déjà suivis | 116 fichiers verts, 1 ignoré ; 1 860 tests verts, 3 ignorés ; code 0 (`tests-tracked.log`) |
| Rejeu de cette même suite après les commits | Journal `tests-head.log` et tête exacte dans `LIVRAISON.json` ; condition de livraison : code 0 et Git propre |
| `npm run typecheck` | Code 0 ; racine, identité gpuNode et companion-core (`typecheck.log`) |
| `npm run lint` | Code 0 ; 0 erreur, 2 601 avertissements (`lint.log`) |
| `git diff --check` | Code 0 ; reçu final |

Les trois tests ignorés sont les skips déjà présents. Les 29 tests ajoutés à la première livraison portent le total de 1 831 à 1 860. Aucun test de confidentialité n'est assoupli. Les sources validées avant commit sont identiques à celles du commit de sécurité ; empreintes de restauration et reçu final fournis.

Commande ciblée (jamais la suite complète) :

```sh
node_modules/.bin/vitest run --configLoader runner --maxWorkers 2 \
  tests/security tests/skills tests/agents \
  tests/agent/custom-agent-loader-hermes.test.ts \
  tests/agent/custom-agent-tool-filter.test.ts \
  tests/agent/custom-agent-runtime.test.ts \
  tests/agent/teams-and-definitions.test.ts
npm run typecheck
npm run lint
```

Deux commits de reprise : `b5a491fba` — `fix(security): fermer les trous eval et borner les substitutions`, puis `docs(qa): corriger le rapport et prouver la reprise du pare-feu ECC`. L'identifiant de ce second commit documentaire figure dans `LIVRAISON.json` avec la liste exhaustive des commits, les codes de sortie et le statut Git. Ce rapport ne peut pas porter son propre hash de commit. Aucun push, aucune tâche détachée. Les preuves de tests, de mutations et d'import sont livrées dans le répertoire `preuves/` du partage, avec un manifeste SHA-256 et un reçu Git final.

## Ce que je n'ai pas pu vérifier

- Windows et macOS non exécutés ; réseau GitHub non revérifié dans la reprise, clone exact déjà disponible.
- Suite complète interdite par la mission et non lancée. Build non rejoué dans la reprise ; la CLI source réelle est exécutée via `tsx`.
- Aucun modèle ni script ECC exécuté ; la preuve porte sur le scan, l'import, les vrais chargeurs, le registre, la vérification d'échange et la garde d'écriture. Le suivi effectif d'une consigne par un modèle n'est pas mesuré.
- Le scanner reste statique : il ne prouve pas la détection de toutes les constructions indirectes telles que `getattr`, `obj["eval"]` ou `(0, eval)`.
- Un agent local sans politique d'outils déclarée peut historiquement disposer de tous les outils, y compris un texte dont le frontmatter non fermé ne contient aucune clé `tools` ou `disallowedTools`. L'import externe refuse ce cas ; les agents sans politique locale ne sont pas durcis dans cette reprise.
- La revue humaine et l'activation manuelle des agents préparés ne sont pas exécutées. Les hooks de l'autre lane ne sont ni modifiés ni exécutés.
- Dédoublonnage de locales internes à la racine canonique vérifié par fixture synthétique, pas par ECC qui n'en contient pas à ce commit.
