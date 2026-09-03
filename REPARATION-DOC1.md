# Réparation DOC1 — vérité documentaire

Rapport de travail initialisé le 3 septembre 2026 avant toute inspection du dépôt.

## Cadre et méthode

- Mission : traiter chaque entrée `FAUX`, `OBSOLÈTE` ou `IMPRÉCIS` de
  `REVUE-DOCS-GEMINI.md` sans toucher au `CHANGELOG`.
- Règle appliquée : le comportement testé et cohérent gagne ; lorsqu’une
  documentation décrit un contrat encore porté par le reste du système, le code
  dérivé est réparé.
- Rouge de référence :
  `./node_modules/.bin/vitest run tests/docs/revue-gemini-docs.test.ts` a donné
  15 échecs sur 15. L’inspection a ensuite établi que neuf de ces tests ne
  lisaient pas le document qu’ils prétendaient vérifier.
- État initial : branche `fix/doc1-verite-doc-2026-09-03`, HEAD `af5840776`,
  seul `node_modules` était non suivi en plus de ce rapport créé en premier.

## Affirmation → verdict → voie → commit

| Entrée / affirmation G9 | Verdict prouvé | Voie (doc/code) | Commit |
|---|---|---|---|
| 8 — `YOLO_MODE` active la pleine autonomie | Imprécis : la variable seule avertit mais n’arme pas YOLO ; il faut `--yolo` ou `/yolo on`. | Doc | `b902d3968` |
| 21 — `BUDDY_SENSE_STT_MODEL_DIR` / `BUDDY_SENSE_STT_THREADS` règlent le worker Rust | Contrat voulu : Rust lisait déjà ces noms, mais le lanceur TypeScript les écrasait avant le spawn. Les alias documentés ont désormais priorité. | Code | `0d94212c8` |
| 23 — posture vocale résidente par défaut `plan` | Obsolète : la migration volontaire, README et les tests imposent `default`; `plan` reste explicite pour `buddy voice`. | Doc | `b902d3968` |
| 26 — fenêtre d’attention par défaut 30 000 ms | Obsolète : le réglage et le runtime testés utilisent 120 000 ms. | Doc | `b902d3968` |
| 31 — `CODEBUDDY_COMPANION_PROACTIVE_MIN_GAP_MS` suggéré par abréviation | Imprécis : le nom réel est `CODEBUDDY_COMPANION_MIN_GAP_MS`. | Doc | `b902d3968` |
| 44 — 50 tours standard, 400 en YOLO | Affirmation correcte, code CLI dérivé : Commander injectait 400 même hors YOLO alors que le cœur et ses tests imposent 50/400. | Code | `64f1667e2` |
| 58 — `buddy fleet tasks add` | Obsolète : les tâches appartiennent à `buddy autonomy` / `buddy colab`. | Doc | `45ed0870c` |
| 59 — `buddy dev explain <file>` serait documenté | Constat G9 faux : au commit audité, `getting-started.md` disait déjà `buddy dev explain` sans argument et décrivait le profil du dépôt. | Test/revue | `74433ad60`, `e2e37156a` |
| 60 — `buddy explain <file>` serait documenté | Constat G9 faux : le document audité disait déjà « repository explanation report » et l’aide expose `[chemin]`. | Test/revue | `74433ad60`, `e2e37156a` |
| 61 — `buddy import` importerait mémoire et historique | Constat G9 faux : le document audité disait déjà « project rules and MCP servers ». | Test/revue | `74433ad60`, `e2e37156a` |
| 62 — `CLAUDE.md` promettrait `nodes status/reject` | Constat G9 faux : cette ligne n’existait pas ; l’aide expose `list/pair/approve/describe/remove/invoke/pending`. | Test/revue | `74433ad60`, `e2e37156a` |
| 63 — `CLAUDE.md` promettrait `todo complete` | Constat G9 faux : cette ligne n’existait pas ; l’aide expose `done`. | Test/revue | `74433ad60`, `e2e37156a` |
| 64 — `CLAUDE.md` promettrait `secrets delete` | Constat G9 faux : cette ligne n’existait pas ; l’aide expose `remove`. | Test/revue | `74433ad60`, `e2e37156a` |
| 65 — `CLAUDE.md` promettrait `approvals revoke/grant` | Constat G9 faux : cette ligne n’existait pas ; l’aide expose `approve/deny/policy`. | Test/revue | `74433ad60`, `e2e37156a` |
| 66 — `CLAUDE.md` promettrait `tunnel stop/status` | Constat G9 faux : cette ligne n’existait pas ; seule la sous-commande `start` est exposée. | Test/revue | `74433ad60`, `e2e37156a` |
| 67 — `CLAUDE.md` promettrait `completions uninstall` | Constat G9 faux : cette ligne n’existait pas ; l’aide énumère les shells et `install`. | Test/revue | `74433ad60`, `e2e37156a` |
| 68 — `CLAUDE.md` promettrait `lsp start/stop` | Constat G9 faux : cette ligne n’existait pas ; l’aide expose `status` et `diagnostics`. | Test/revue | `74433ad60`, `e2e37156a` |
| 69 — `CLAUDE.md` promettrait `deploy preview/apply` | Constat G9 faux : cette ligne n’existait pas ; l’aide expose `platforms/init/nix`. | Test/revue | `74433ad60`, `e2e37156a` |
| 70 — `CLAUDE.md` promettrait `execpolicy clear` | Constat G9 faux : cette ligne n’existait pas ; l’aide expose les sept opérations réelles. | Test/revue | `74433ad60`, `e2e37156a` |
| 71 — `CLAUDE.md` décrirait `proxy start/stop/status/logs` | Constat G9 faux : cette ligne n’existait pas ; `proxy` est une commande directe à options. | Test/revue | `74433ad60`, `e2e37156a` |
| 72 — `CLAUDE.md` promettrait `cloud status/sync` | Constat G9 faux : cette ligne n’existait pas ; le routeur gère `submit/status/list/cancel/logs/delete`. | Test/revue | `74433ad60`, `e2e37156a` |
| 73 — `CLAUDE.md` promettrait `bundles pack/unpack/verify` | Constat G9 faux : cette ligne n’existait pas ; l’aide expose `list/create/show/remove`. | Test/revue | `74433ad60`, `e2e37156a` |
| 74 — `CLAUDE.md` décrirait `desktop start/install` | Constat G9 faux : cette ligne n’existait pas ; `desktop` est l’alias direct de `gui`. | Test/revue | `74433ad60`, `e2e37156a` |
| 87 — `CODEBUDDY_WIDGETS_AUTOGEN` autorise la génération automatique | Obsolète depuis le rendu déterministe des payloads structurés : le chemin automatique n’appelle plus de LLM ; la création authored explicite passe par `buddy widgets gen`. | Doc | `129e35c0d` |

## Commits produits

- `f26a2d087` — réservation et initialisation du rapport.
- `64f1667e2` — limite CLI standard 50, YOLO 400.
- `0d94212c8` — alias modèle/threads STT honorés de bout en bout.
- `b902d3968` — valeurs compagnon et armement YOLO documentés fidèlement.
- `45ed0870c` — commande goal-mode déplacée vers `autonomy`.
- `129e35c0d` — variable widgets obsolète retirée.
- `74433ad60` — tests convertis en contrats doc↔CLI et étendus aux 24 entrées.
- `e2e37156a` — faux constats et méthode G9 rectifiés.

## Vérifications finales

- `npm run typecheck` : code 0 (projet principal + configuration GPU Node).
- Union ciblée Vitest DOC1, agents, STT, compagnon et sécurité : 9 fichiers,
  410 tests passés, 0 échec.
- `./node_modules/.bin/vitest run tests/docs/revue-gemini-docs.test.ts` :
  23/23 verts ; ces 23 tests couvrent les 24 entrées, avec un cas commun pour
  `proxy` et `desktop`.
- `./node_modules/.bin/vitest run tests/security/donnees-personnelles.test.ts` :
  1/1 vert.
- Tests voisins exécutés pendant les lots : 215 tests agent, 67 tests STT et
  104 tests configuration/voix, tous verts.
- `git diff --check` : code 0 avant rédaction finale.

## Points ouverts

Aucun défaut DOC1 connu ne reste ouvert. La suite Vitest complète n’a pas été
lancée : la mission demandait les tests ciblés. `node_modules` reste le seul
chemin non suivi préexistant ; il n’a pas été ajouté ni modifié par les commits.
Aucun push, service ou appel d’API n’a été effectué.
