# RÉPARATION VERIFIX3A — fermeture des trouvailles T1–T11 et T16–T21 de VERIF3

Date : 2026-09-04
Lane : VERIFIX3A (Fable 5.1)
Clone : `~/DEV/cb-verifix3a-2026-09-04`
Branche : `fix/verifix3a-harnais-2026-09-04`
Source : `docs/reports/2026-09/RAPPORT-VERIF3.md`, sections « Trouvailles » T1–T11 et T16–T21
HEAD de départ : `ee51f1096`

Ce rapport a été créé **avant** toute inspection.

## Périmètre

Dix-sept trouvailles, toutes de la famille « le harnais n'observe pas le
contrat » : assertions `toHaveBeenCalled()` nues, `stringContaining` trop
lâches, `mode: 0o600` non asserté, exception explicite non gardée, latence
neutralisée par le test lui-même.

| Trouvaille | Fichier de test |
|---|---|
| T1 | `tests/unit/migration-manager.test.ts` |
| T2 | `tests/unit/telemetry-config.test.ts` |
| T3 | `tests/unit/cost-tracker.test.ts` |
| T4 | `tests/unit/codebase-rag.test.ts` |
| T5 | `tests/unit/vector-store.test.ts` |
| T6 | `tests/unit/roi-tracker.test.ts` |
| T7 | `tests/unit/session-replay.test.ts` |
| T8 | `tests/unit/response-cache.test.ts` |
| T9 | `tests/unit/persistent-checkpoint-manager.test.ts` |
| T10 | `tests/features/tailscale-dashboard-nodes.test.ts` |
| T11 | `tests/channels/dm-pairing.test.ts` |
| T16 | `tests/unit/doctor-fix.test.ts` |
| T17 | `tests/sensory/agent-reply-routing.test.ts` |
| T18 | `tests/unit/auth.test.ts` |
| T19 | `tests/unit/misc-tools-part2.test.ts` |
| T20 | `tests/unit/memory.test.ts` |
| T21 | `tests/unit/workflows.test.ts` |

Hors périmètre (lane sœur VERIFIX3B) : T12 à T15.

## Méthode

Pour chaque trouvaille : (1) rejouer la mutation restée VERTE du rapport
VERIF3 et confirmer qu'elle est bien verte ; (2) renforcer le test pour qu'il
asserte le contrat réel (chemin exact, contenu sérialisé, mode `0o600` quand
la source le fixe, exception réellement levée) **sans toucher au code de
production** ; (3) rejouer la même mutation : ROUGE ; restaurer
(`git checkout -- <src>`) : VERT. Aucun `it.skip`, aucun test supprimé,
aucune assertion affaiblie. Un commit par trouvaille.

Préfixe d'exécution :

```bash
env HOME="$PWD/_qa/verifix3a/home" TMPDIR="$PWD/_qa/verifix3a/home/tmp" \
    XDG_CACHE_HOME="$PWD/_qa/verifix3a/home/cache" NO_COLOR=1 \
    npx vitest run <fichier de test> --reporter=dot
```

## Journal des réparations

Dix-sept trouvailles fermées, dix-sept commits fonctionnels. Pour chacune, la
mutation citée par VERIF3 a d'abord été rejouée **VERTE** sur le test d'origine,
puis **ROUGE** après renforcement, la source étant restaurée à chaque fois par
`git checkout -- <fichier>` (le harnais `_qa/verifix3a/mut.py` refuse un motif
non unique et restaure inconditionnellement).

| # | Commit | Mutations rejouées | Avant | Après |
|---|---|---|---|---|
| T1 | `test(migration-manager)` | historique vidé, chemin dévié, journal d'audit vidé, contenu restauré vidé, écriture supprimée, mode 0o644 | VERT | **ROUGE** (6/6) |
| T2 | `test(telemetry-config)` | mode 0o644, contenu `{}`, écriture supprimée, chemin dévié | VERT | **ROUGE** (4/4) |
| T3 | `test(cost-tracker)` | historique tronqué, chemin dévié, mode 0o644, chemin de config dévié | VERT | **ROUGE** (4/4) |
| T4 | `test(codebase-rag)` | `chunks.json` renommé, écriture des chunks supprimée, écriture des stats supprimée, file-index vidé, embeddings conservés | VERT | **ROUGE** (5/5) |
| T5 | `test(vector-store)` | vecteurs vidés, chemin dévié, contenu réduit à la version, version falsifiée, métadonnées perdues | VERT | **ROUGE** (5/5) |
| T6 | `test(roi-tracker)` | mode 0o644, tâches vidées, chemin dévié, écriture supprimée, `ensureDir` sur le fichier | VERT | **ROUGE** (5/5) |
| T7 | `test(session-replay)` | mode 0o644, événements vidés, chemin dévié, écriture supprimée, assainissement du nom retiré | VERT | **ROUGE** (5/5) |
| T8 | `test(response-cache)` | entrées vidées, chemin suffixé, `savedAt` absent, stats falsifiées | VERT | **ROUGE** (4/4) |
| T9 | `test(persistent-checkpoint-manager)` | mode d'index 0o644, contenu du checkpoint vidé, chemin du checkpoint dévié, mode du checkpoint 0o644 | VERT | **ROUGE** (4/4) |
| T10 | `test(device-node)` | persistance vidée, écriture supprimée, mode 0o644, chemin dévié, version du format falsifiée | VERT | **ROUGE** (5/5) |
| T11 | `test(dm-pairing)` | garde `senders === null` neutralisée, message d'erreur banalisé, `logger.warn` supprimé, garde d'entrée invalide neutralisée | VERT (la 1ʳᵉ) | **ROUGE** (4/4) |
| T16 | `test(doctor-fix)` | `ollama pull` → `ollama run`, modèle changé, sélection après téléchargement supprimée, échec du téléchargement avalé | VERT | **ROUGE** (4/4) |
| T17 | `test(agent-reply-routing)` | latence mesurée neutralisée, `minRuns` changé, latence mesurée ignorée au tri | VERT | **ROUGE** (3/3) |
| T18 | `test(auth)` | mode 0o644, chemin dévié, ancienne clé réécrite, écriture supprimée | VERT | **ROUGE** (4/4) |
| T19 | `test(misc-tools)` | chemin suffixé, chemin non résolu, encodage `latin1` | VERT (les 2 de chemin) | **ROUGE** (3/3) |
| T20 | `test(memory)` | index vidé, mode 0o644, chemin dévié, écriture supprimée | VERT | **ROUGE** (4/4) |
| T21 | `test(workflows)` | état sérialisé `{}`, mode 0o644, `stepResults` non sérialisées | VERT | **ROUGE** (3/3) |

Total : **72 mutations** appliquées isolément et restaurées. Aucune n'est
conservée. **Aucun fichier de `src/` n'est modifié** par ce chantier : aucun
défaut de production n'a été découvert, les dix-sept trouvailles étaient bien
des défauts d'observation du harnais.

Trois corrections de harnais méritent d'être signalées parce qu'elles vont
au-delà d'une assertion :

* `tests/unit/persistent-checkpoint-manager.test.ts` et
  `tests/unit/workflows.test.ts` : le double de `writeJsonAtomicSync` **jetait**
  l'argument `mode`. Il le propage désormais au faux disque, ce qui rend 0o600
  observable pour ces deux familles de fichiers.
* `tests/sensory/agent-reply-routing.test.ts` : le scoreboard du test renvoyait
  toujours `null` sur `measuredTurnLatency`. Il est désormais programmable, et
  un test vérifie que la latence mesurée renverse bien l'ordre heuristique.
* `tests/channels/dm-pairing.test.ts` : `vi.restoreAllMocks()` en `afterEach`
  empêche un espion laissé par un test en échec de contaminer le suivant.

## Vérifications finales

| Commande | Résultat |
|---|---|
| `npx vitest run tests/unit tests/features tests/channels tests/sensory` | **504 fichiers · 18 417 tests · 18 406 verts, 4 en échec, 4 ignorés, 1 todo** — voir la réserve ci-dessous |
| `npx vitest run tests/security/donnees-personnelles.test.ts` | **7/7 verts** |
| `npx tsc --noEmit -p .` | **code 0** |
| `npx eslint --max-warnings=0 <20 fichiers modifiés>` | **code 1 — 38 avertissements, tous PRÉEXISTANTS** (voir réserve) |
| `git diff --check` | **code 0** |
| `git status --short` | **propre** |
| Balayage du diff (`/home/<utilisateur>`, noms de machines, adresses IP) | **aucune occurrence** |

### Réserve 1 — quatre tests en échec, tous préexistants

Les quatre échecs sont dans des fichiers que ce chantier **ne touche pas** :

* `tests/unit/tools-core.test.ts` — `GitTool > isGitRepo`, `GitTool > autoCommit`,
  `TextEditorTool > Path Validation`
* `tests/channels/telegram.test.ts` — rendu d'un widget en PNG

Ils ont été rejoués **au commit de base `ee51f1096`**, dans un worktree détaché :
**les quatre échouent déjà**, à l'identique. `git diff --name-only ee51f1096..HEAD`
confirme qu'aucun de ces deux fichiers n'est modifié. Un cinquième échec observé
lors du premier passage (`tests/unit/ui-components.test.ts`, dépassement du délai
de 15 s à l'import de `ChatInterface`) ne se reproduit pas en exécution isolée :
c'est un effet de charge machine, pas une régression.

### Réserve 2 — eslint `--max-warnings=0` échoue sur de la dette préexistante

Les 38 avertissements sont tous des `@typescript-eslint/no-unused-vars` sur des
imports de types et des variables locales **déjà présents avant ce chantier**.
Comparaison mécanique des sorties JSON d'eslint entre `ee51f1096` et la branche,
sur les vingt fichiers modifiés :

* avertissements **introduits** par VERIFIX3A : **0**
* avertissements **supprimés** par VERIFIX3A : **5** (des imports jusque-là
  inutilisés servent désormais aux nouvelles assertions)

Nettoyer les 33 restants supposerait de retoucher des lignes sans rapport avec
les trouvailles, dans neuf fichiers de test ; le chantier s'y refuse et signale
la dette plutôt que d'élargir son périmètre.

## Bilan

1. Dix-sept trouvailles visées (T1–T11, T16–T21), **dix-sept fermées**, aucune laissée ouverte.
2. Dix-sept commits fonctionnels, un par trouvaille, fichiers ajoutés nommément.
3. 72 mutations rejouées : vertes avant renforcement, rouges après, source restaurée à chaque fois.
4. Aucun `it.skip`, aucun test supprimé, aucune assertion affaiblie ; 34 tests nets ajoutés.
5. **Aucun fichier de `src/` modifié** — aucune trouvaille ne cachait un défaut de production.
6. Deux doubles atomiques jetaient l'argument `mode` : corrigés, 0o600 est désormais observable.
7. `tsc` code 0, privacy 7/7, `git diff --check` code 0, `git status` propre.
8. Réserve 1 : quatre tests en échec, prouvés préexistants au commit de base, dans des fichiers non touchés.
9. Réserve 2 : eslint `--max-warnings=0` échoue sur 38 avertissements préexistants ; VERIFIX3A en introduit 0 et en supprime 5.
10. Zone T12–T15 laissée intacte pour la lane sœur VERIFIX3B.
