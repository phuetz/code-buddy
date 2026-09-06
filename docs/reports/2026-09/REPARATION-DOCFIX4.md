# Réparation DOCFIX4 — corrections CLAUDE.md suite audit AGYDOC4

Statut : TERMINÉ

Ce fichier trace la vérification et l'application des corrections signalées par
`RAPPORT-AGYDOC4.md` (copié à côté, chemins de home remplacés par `~/…`) sur
`CLAUDE.md`. Chaque affirmation du rapport a été re-vérifiée dans le code
avant toute modification ; les items marqués VRAI par AGYDOC4 n'ont pas été
touchés (pas de correction sans défaut confirmé).

## Méthode

1. Lecture de `RAPPORT-AGYDOC4.md`.
2. Pour chaque item FAUX / IMPRÉCIS / ABSENT, ouverture du fichier:ligne cité
   et confirmation directe dans le code de ce clone (branche
   `codex/audit-systeme-nerveux-2026-09-01`).
3. Écriture de la phrase de remplacement seulement après confirmation ; si la
   proposition d'AGYDOC4 elle-même ne collait pas au code vérifié, elle a été
   ajustée ou écartée (voir « Écarts » ci-dessous).
4. Un commit par section corrigée.

## Corrections appliquées (vérifiées dans le code avant écriture)

1. **Tableau des middlewares incomplet (L.83-93, IMPRÉCIS)** — vérifié dans
   `src/agent/codebuddy-agent.ts` : `pipeline.use(createVerificationEnforcementMiddleware())`
   à la ligne 441 (priorité 155), `pipeline.use(new VisualValidationMiddleware())`
   à la ligne 450 (priorité 156), `pipeline.use(createPlanCompletionAuditMiddleware())`
   à la ligne 461 (priorité 157). Les trois lignes manquaient au tableau.
   Ajoutées avec les priorités et les numéros de ligne réels.
2. **`AutoObservationMiddleware` "registered separately, ~line 1503" (L.91,
   IMPRÉCIS)** — la ligne 1503 actuelle ne contient plus ce code (fin de
   `processUserMessage`, sans rapport). L'enregistrement réel est
   `pipeline.use(new AutoObservationMiddleware(config))` dans la méthode
   `enableAutoObservation()`, ligne 1985, appelée uniquement pour les agents
   custom taggés `computer-use` (`src/index.ts:2162`). Corrigé en conséquence.
3. **`VerificationEnforcementMiddleware` "wired (`codebuddy-agent.ts:~393`)"
   (L.95, IMPRÉCIS)** — l'appel `pipeline.use(...)` réel est à la ligne 441.
   Corrigé.
4. **« The table plus … AutoObservationMiddleware is now the exhaustive wired
   set » (L.95, FAUX)** — faux : `VisualValidationMiddleware` (156) et
   `PlanCompletionAuditMiddleware` (157) tournent réellement (voir point 1) et
   n'étaient dans aucune liste. Corrigé : le tableau complété (12 entrées) est
   désormais l'ensemble exhaustif ; précision que `AutoObservationMiddleware`
   est le seul enregistré hors du bloc constructeur principal.
5. **`QualityGateMiddleware` délégation (L.93)** — AGYDOC4 marque VRAI mais
   signale que la délégation passe désormais par `ThreadTaskRunner` /
   `ThreadDelegation`. Vérifié dans
   `src/agent/middleware/quality-gate-middleware.ts` (import de
   `../delegation/thread-task-runner.js` et `../delegation/thread-delegation.js`,
   `new ThreadTaskRunner(...)` ligne 375). Confirmé et ajouté au tableau
   (colonne Purpose) pour éviter que le lecteur imagine un appel direct aux
   agents comme avant DELEG3.
6. **Diagramme « Tool calls (max 50, YOLO 400) » (L.51, IMPRÉCIS)** — vérifié :
   `src/agent/codebuddy-agent.ts:142`
   (`this.maxToolRounds = maxToolRounds || (this.yoloMode ? 400 : 50);`),
   flag CLI `--max-tool-rounds` (`src/index.ts:1418`, `:2451`), et un même
   tour peut lancer plusieurs appels d'outils en parallèle
   (`canRunInParallel`, `src/agent/execution/agent-executor.ts:659` et boucle
   `while (toolRounds < maxToolRounds)` ligne 1350). Renommé « Tool rounds ».
7. **Vitest `--max-old-space-size=8192` (L.29, IMPRÉCIS)** — vérifié
   `vitest.config.ts:141` :
   `` `--max-old-space-size=${process.platform === 'win32' ? 4096 : 8192}` ``.
   Précisé « (4096 on Windows) ».
8. **Chemins des rapports (ABSENT)** — vérifié `docs/reports/README.md` :
   « Les nouveaux rapports vont dans `docs/reports/<AAAA-MM>/` » et
   l'arborescence réelle (`docs/reports/2026-06`, `2026-08`, `2026-09`).
   Absent de CLAUDE.md. Ajouté une phrase dans la section « Coordination
   Fable 5 / Codex ».

## Vérifié, VRAI confirmé, AUCUNE modification (conformément à la consigne
« ne corriger que FAUX / IMPRÉCIS / ABSENT »)

- **AgentRegistry/Verifier (L.40)** — vérifié `src/agent/specialized/agent-registry.ts` :
  `executeVerifierOnDelegate()` route bien vers un `ThreadTaskRunner` en
  contexte neuf, avec `VERIFIER_DELEGATION_PARENT_BUDGET = { maxTurns: 12,
  maxCostUsd: 1, maxContextTokens: 32_000 }` (ligne 51). **Écart avec la
  consigne de mission** qui suggérait de vérifier un budget « 6 tours / 0,50
  USD / 16K tokens » : ce chiffre ne correspond à rien trouvé dans le code
  (recherche large sur `ThreadParentBudget`, `maxTurns`, `maxCostUsd`) ; les
  seuls chiffres réels sont 12 tours / 1 USD / 32 000 tokens. Le
  `verifier-agent.ts:282-287` confirme bien « jamais CONFIRMED sans oracle »
  (un verdict CONFIRMED déclaré sans `oracleCount > 0` est rétrogradé en
  NEEDS REVIEW). La ligne CLAUDE.md actuelle ne cite aucun chiffre erroné —
  elle ne détaille juste pas le budget — et AGYDOC4 la marque VRAI ; par
  prudence (chiffres de la consigne non retrouvés dans le code, et
  instruction de ne pas rallonger CLAUDE.md sans défaut avéré), **aucune
  modification n'a été appliquée** à cette ligne.
- **Permission modes / `dontAsk` (L.331, L.272)** — vérifié
  `src/security/permission-modes.ts:179,234-242` (`dontAsk` : outils
  destructeurs → confirmation, sinon auto-approuvé) et
  `src/sandbox/execpolicy.ts:196-238` (règle `builtin-git-safe` autorisant
  `git -C <chemin> status|log|diff|...`, règle `builtin-git-boundary`
  excluant explicitement ces mêmes lectures de la frontière `ask`). Confirmé
  cohérent avec le correctif HEADLESS2 (`docs/reports/2026-09/REPARATION-HEADLESS2.md`).
  VRAI, aucune modification.
- **« Tests live in tests/ only » (L.29)** — `find src -name "*.test.ts"` → 0
  résultat dans ce clone. VRAI, aucune modification.
- **YOLO 400 tool rounds, $100 cap (L.329)** — VRAI, aucune modification.
- **Vitest setup jest-compat (L.29)** — VRAI, aucune modification.

## Écarts avec AGYDOC4 (proposition non appliquée telle quelle)

- **Lien `dreaming.svg` (L.160, AGYDOC4 : FAUX)** — dans ce clone, CLAUDE.md
  contient déjà `` [`dreaming.svg`](buddy-sense/docs/dreaming.svg) `` (lien
  correct, fichier présent à cet emplacement). AGYDOC4 décrivait un lien cassé
  `[`dreaming.svg`](dreaming.svg)` qui n'existe pas dans cette version du
  fichier — probablement déjà corrigé par une autre lane entre l'audit et ce
  clone, ou audit sur une copie différente. **Non appliqué : rien à corriger,
  le fichier est déjà correct.**
- **Budget Verifier "6 tours / 0,50 USD / 16K tokens"** (mentionné dans la
  consigne de mission, pas dans le tableau AGYDOC4 lui-même) — voir section
  précédente : chiffres introuvables dans le code, chiffres réels 12/1$/32K
  déjà cohérents avec AGYDOC4. Non appliqué.

## Hors périmètre (observé, non traité)

- `docs/agents.md:37` affiche « Specialized Agents (8 Built-in) » et ne liste
  pas Verifier, alors que `CLAUDE.md` en cite 9 (avec Verifier) — vérifié
  cohérent avec `src/agent/specialized/agent-registry.ts`. Ce n'est pas une
  phrase dupliquée de celles corrigées ici (aucune des 4 sections retouchées
  dans CLAUDE.md n'a d'équivalent littéral dans `docs/agents.md`), donc hors
  du mandat DOCFIX4 tel que cadré (« corriger, pas allonger », périmètre =
  phrases de la mission). Signalé pour une lane dédiée.

## Commits

1. `f5fbe258c` — mise en place (rapport + réservation coordination) + tableau
   des middlewares complété.
2. `3c7fd04d5` — libellé du diagramme d'architecture (« Tool rounds »).
3. `f2bc753a4` — précision Windows du plafond mémoire Vitest.
4. `4dd41a68d` — mention des chemins `docs/reports/<AAAA-MM>/`.

## Vérifications

- `npx vitest run tests/docs tests/security` : **934 réussis / 16 échecs / 950
  total** (1 fichier échoué sur 51). Les 16 échecs sont dans
  `tests/docs/revue-gemini-docs.test.ts` (`dev explain --help`, `proxy
  --help`, `desktop --help`, `bundles --help` retournent un code de sortie
  non nul via `runCli`) et **préexistent avant toute modification** :
  reproduits à l'identique avec `git stash` (working tree remis à l'état
  d'avant DOCFIX4), donc non causés par ce travail. Non corrigés — hors
  mandat (contenu CLAUDE.md uniquement, pas de code CLI).
- `git diff --check` et `git diff --cached --check` : aucun conflit de fin de
  ligne / espace, exit 0.
- `git status` : propre après le dernier commit (voir historique).
- Aucun push, aucun `git add -A`, aucun fichier hors du périmètre modifié.
