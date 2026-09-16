# RAPPORT-RELEASE2 — Documentation de la version 2.0.0 « Code Buddy 2 »

- **Date d'ouverture** : 2026-09-05
- **Agent** : Claude Fable 5.1
- **Clone de travail** : clone dédié hors dépôt principal (`cb-release2-2026-09-05`)
- **Branche** : `docs/release-2.0-2026-09-05`
- **Base** : `54cb2b2f0` (docs(cifix2): recoller la ligne CIFIX2 au tableau de coordination)
- **Zones en lecture seule** : copie de travail principale + profil `~/.codebuddy`
- **Consigne** : aucun push, `git add` nommément fichier par fichier

## Mission

1. Réécrire `README.md` en tête « Code Buddy 2 » (anglais, sans superlatif, chaque
   affirmation appuyée par un fichier du dépôt cité **ici**, pas dans le README).
2. Créer `docs/RELEASE-NOTES-2.0.0.md` (Highlights / New / Changed / Fixed /
   Breaking / Known issues) synthétisé depuis le CHANGELOG depuis v1.8.0.
3. Vérifications : `npm pack --dry-run` inclut le README, liens relatifs valides,
   `tests/security/donnees-personnelles.test.ts` vert, `git diff --check`.

## Livrables

| Fichier | Taille | État |
| --- | --- | --- |
| `README.md` | 11 201 o (153 → 214 lignes) | réécrit |
| `docs/RELEASE-NOTES-2.0.0.md` | 12 872 o | créé |
| `docs/reports/2026-09/RAPPORT-RELEASE2.md` | ce fichier | créé avant inspection |

## Échelle mesurée

| Mesure | Valeur | Commande |
| --- | --- | --- |
| Commits `v1.8.0..HEAD` | **1814** | `git log v1.8.0..HEAD --oneline \| wc -l` |
| Commits au moment du bump 2.0.0 | **575** (`v1.8.0..8c98359d8` = 576 avec le commit de release) | `git log v1.8.0..8c98359d8 --oneline \| wc -l` |
| Commits **après** le bump | **1238** | `git log 8c98359d8..HEAD --oneline \| wc -l` |
| Répartition (plage complète) | 661 `fix`, 537 `docs`, 234 `feat`, 170 `test`, 49 `chore` | `git log --pretty=%s \| sed -E … \| sort \| uniq -c` |
| Sujets `!:` (rupture) | **0** | `git log v1.8.0..HEAD --pretty=%s \| grep -cE '^[a-zA-Z]+(\(.*\))?!:'` |
| `BREAKING CHANGE` | **1 occurrence, qui la NIE** — corps du commit de release `8c98359d8` | `git log --grep='BREAKING CHANGE'` |

**Écart réconcilié** : le CHANGELOG et le commit de release annoncent « 575 commits depuis la
1.8.0 ». C'était exact **au 26/08/2026**, date du bump. La campagne de septembre (PRIV, VERIF,
DELEG, DGM, STRAT, CIFIX…) a fusionné 1238 commits **après** ce commit. Les notes de version
portent les deux chiffres plutôt que de recopier le seul 575, devenu faux sur cette branche.

## Table des preuves — chaque affirmation du README

| # | Affirmation du README | Fichier qui l'appuie |
| --- | --- | --- |
| 1 | « 64 providers behind one router » | `src/providers/provider-catalog.ts` — union `RuntimeProviderId` (l. 24) = 64 membres ; `RUNTIME_PROVIDER_CATALOG` (l. 145-1184) = 64 entrées `id:`. Les deux concordent. |
| 2 | « 220+ tools selected per query » | `src/tools/metadata.ts` — `TOOL_METADATA` = **229** noms uniques, sur-ensemble strict des **196** définitions statiques de `src/codebuddy/tool-definitions/` (45 fichiers). Sélection par requête : `src/codebuddy/tools.ts` (RAG + `filterToolNamesForSurface`). |
| 3 | « no `BREAKING CHANGE` in the 2.0 range » | `git log v1.8.0..HEAD` : 0 sujet `!:` ; unique occurrence = le commit `8c98359d8` qui la nie. |
| 4 | `peer.chat`, `peer.chat-session.*`, `peer.tool.invoke` | `src/fleet/peer-chat-bridge.ts:202` ; `src/fleet/peer-session-bridge.ts:491,553` ; `src/fleet/peer-tool-bridge.ts:366` (+ `.stream` l. 370). |
| 5 | Trois portes + racine de workspace **fail-closed** | `src/fleet/peer-tool-bridge.ts` ; `fleetSafe` dans `src/tools/metadata.ts` ; `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` lu dans `src/`. |
| 6 | Cowork = Electron, Node ≥ 22 | `cowork/package.json` — `"name": "@phuetz/codebuddy-cowork"`, `engines.node: ">=22"`, Electron `^35.7.5`. |
| 7 | Dix innovations opt-in | `docs/cb2/README.md` (tableau des 10 + variable d'activation) ; répertoires vérifiés : `src/speculative/`, `src/sessions/timeline.ts`, `src/intents/`, `src/fleet/peer-ckg-bridge.ts:29`, `src/agent/self-improvement/continuous-benchmark.ts`, `src/context/segment-archive.ts`, `src/widgets/`, `src/sensory/error-watch-reaction.ts`, `src/skills/skill-exchange.ts`, `src/workspace/` — 10/10 présents. |
| 8 | Quatre surfaces apprenables | `src/agent/self-improvement/` : `engine.ts`+`empirical-gate.ts` (leçons), `tool-engine.ts`+`tool-gate.ts` (outils), `skill-engine.ts`+`skill-gate.ts` (skills), `strategy-engine.ts`+`strategy-gate.ts` (stratégies). `strategy-types.ts:2` se décrit comme « the FOURTH learnable surface ». |
| 9 | « never edits `src/` — a scanned invariant » | `tests/agent/self-improvement/evolution/protected-paths.test.ts`. |
| 10 | Council + tableau de bord des modèles | `src/council/` (`council-engine.ts`, `judge.ts`, `conductor.ts`, `deliberation-health.ts`) ; le scoreboard est en `src/fleet/model-scoreboard.ts` (572 l.), importé par `src/council/conductor.ts:8`. |
| 11 | Démon de perception en Rust | `buddy-sense/Cargo.toml` (`name = "buddy-sense"`, edition 2021, 17 `.rs`) ; schéma `buddy-sense/docs/architecture.svg` (affiché dans le README). |
| 12 | `npm i -g @phuetz/code-buddy` | `package.json` — `"name": "@phuetz/code-buddy"`, `"bin": {"buddy": "dist/index.js"}`, `engines.node >= 18.0.0`. |
| 13 | `buddy login` (ChatGPT, $0) | `src/index.ts:3162` `.command("login [provider]")`, défaut `chatgpt`, `loginInteractive()` de `src/providers/codex-oauth.ts` ; accepte aussi `xai`. |
| 14 | `buddy` seul = session interactive | `src/index.ts` — argument `[message...]`, aucune sous-commande requise. |
| 15 | `buddy doctor --fix` choisit un modèle Ollama et le justifie | `src/commands/cli/utility-commands.ts:22` (`doctor`), `:25` (`--fix`) ; CHANGELOG DOCTOR1. |
| 16 | `buddy loop … --verify-cmd` | `src/commands/loop-cli.ts:101` (`createLoopCommand`), `:117` (`--verify-cmd`), `:203` (`makeShellVerifier`). |
| 17 | `buddy cost --latency` | `src/commands/cost.ts:398`. |
| 18 | `buddy install-gui` / `buddy gui` | `src/index.ts:3029` / `:2999`. |
| 19 | `/batch`, `CODEBUDDY_BATCH_CONCURRENCY` défaut 1 | `src/agent/delegation/thread-delegation.ts` ; variable lue dans `src/` (vérifié). |
| 20 | `buddy improve` propose-only, `--apply` exige `CODEBUDDY_SELF_IMPROVE` | `src/commands/cli/improve-command.ts:147` (parent), `:317` `status`, `:335` `cycle`, `:383` `tools`, `:426` `skills`, `:467` `strategies`, `:628` `loop`. |
| 21 | `CODEBUDDY_INCLUDE_INTEROP_CONTEXT` admet 4 fichiers | `src/services/prompt-builder.ts:170` (`STARTUP_PROJECT_CONTEXT_FILES = ['AGENTS.md','CODEBUDDY.md']`) et `:521-524` ; élargissement par omission vers `DEFAULT_CONTEXT_FILE_NAMES` (`src/context/instruction-excludes.ts:50-57`) = `CLAUDE.md`, `GEMINI.md`, `CONTEXT.md`, `INSTRUCTIONS.md`. |
| 22 | « Only the Linux CI legs are blocking » | `.github/workflows/ci.yml:24` — `continue-on-error: ${{ matrix.os != 'ubuntu-latest' }}`, commentaire l. 19-23. |
| 23 | « The test toolchain needs Node ≥ 20 » | `.github/workflows/ci.yml` — matrice `node-version: [20.x, 22.x]` + commentaire (Vitest 4 / Vite 7) ; `package.json` garde `engines.node >= 18`. |
| 24 | PTY macOS = problème ouvert | `docs/reports/2026-09/REPARATION-CIFIX1.md:25-27` (« décision de ne pas corriger à l'aveugle »). |
| 25 | BSL 1.1, bascule Apache 2.0 le 2030-08-31 | `LICENSE` ; `package.json` `"license": "BUSL-1.1"`. |

## Affirmations écartées faute d'appui (non écrites dans le README)

| Affirmation candidate | Pourquoi elle est écartée |
| --- | --- |
| « 15 providers » (`CLAUDE.md`) | **Périmé.** Le catalogue en compte 64. `CLAUDE.md` nomme un sous-ensemble strict. À corriger dans une autre lane. |
| « ~110 tool definitions dans `src/codebuddy/tools.ts` » (`CLAUDE.md`) | **Faux sur le compte ET sur l'emplacement.** `src/codebuddy/tools.ts` (922 l.) ne contient qu'**une** définition (`CONTEXT_EXPAND_TOOL`, l. 135) ; les définitions vivent dans `src/codebuddy/tool-definitions/` (196). |
| « 30 free-tier or local $0 » (`package.json`) | **Défendable seulement au sens large.** Sur les 30 entrées portant `freeTier:`, 5 sont local/$0 et 15 des paliers gratuits récurrents, mais **10 sont des crédits d'inscription uniques**. Le README ne reprend donc pas ce chiffre. |
| « 36 154 tests verts » (CHANGELOG, 03/09) | **Non revérifié** : la suite complète n'a pas été relancée. Le dépôt compte 2083 fichiers `tests/**/*.test.ts` (~2113 avec ceux hors `tests/`). Aucun taux de réussite n'est cité, ni dans le README ni dans les notes. |
| `CODEBUDDY_WIDGETS_AUTO`, `CODEBUDDY_SKILL_EXCHANGE`, `CODEBUDDY_SELF_IMPROVE_STRATEGIES`, `CODEBUDDY_COUNCIL_ROUTING`, `CODEBUDDY_NATIVE_SANDBOX` | **Réellement lues**, mais via une constante nommée (`export const X_ENV = '…'`) ou un objet `env.X` destructuré, jamais par un `process.env.X` littéral. `tests/docs/readme-truth.test.ts` ne détecte que la forme littérale : les citer ferait **rougir** le test. Elles sont donc renvoyées vers `docs/cb2/README.md` et `docs/security.md`. Preuves : `src/agent/self-improvement/strategy-runtime.ts:14`, `src/widgets/auto-widget.ts:43`, `src/skills/skill-exchange.ts:28`, `src/agent/facades/model-routing-facade.ts:162`, `src/security/native-sandbox.ts:16`. |

## Contrat de test que le README devait respecter (découvert avant réécriture)

`tests/docs/readme-truth.test.ts` (GK31), `tests/docs/doctor1-entrypoints.test.ts`,
`tests/docs/public-screenshots.test.ts`, `tests/docs/serv2-ports-serveur.test.ts` :

- titres `^## License`, `^## Opt-in`, `^## Not ready` ; mention `docs/getting-started.md` ;
  chaîne « Business Source License 1.1 » ;
- toute commande `buddy <nom>` citée doit figurer dans `buddy --help` **et** répondre
  `--help` avec code 0 ;
- toute variable `CODEBUDDY_*` / `OLLAMA_HOST` / `JWT_SECRET` / `YOLO_MODE` citée doit être lue
  par un `process.env.X` littéral dans `src/` ;
- présence obligatoire de `/batch`, `CODEBUDDY_BATCH_CONCURRENCY`, `buddy improve`,
  `CODEBUDDY_SELF_IMPROVE`, `propose-only` ;
- 1 à 9 images locales, toutes valides (signature + dimensions) et > 1 000 o ; liens et ancres
  relatifs résolvables ; aucune mention du port de passerelle de flotte comme port de `buddy
  server` ; aucun chemin absolu de répertoire personnel (racines Linux ou Windows) ; pas de nom
  personnel.

## Vérifications finales

| Vérification | Résultat |
| --- | --- |
| `npm pack --dry-run --ignore-scripts` | **README.md inclus, 11,2 kB** (5 fichiers : LICENSE, README.md, examples/…, package.json) |
| `tests/security/donnees-personnelles.test.ts` | **vert** (lancé avec 3 tests de doc : 4 fichiers / 58 tests passés) |
| `tests/docs/readme-truth.test.ts` | **vert** (4/4) — commandes citées présentes dans `--help` et `--help` à 0 |
| `tests/docs/doctor1-entrypoints.test.ts`, `public-screenshots.test.ts`, `serv2-ports-serveur.test.ts` | **verts** |
| Liens relatifs README | 22 résolus, 7 ancres résolues, 3 images valides |
| Liens relatifs notes de version | 4 résolus, 1 ancre résolue |
| `git diff --check` | **propre** |
| `buddy --help` | 104 commandes ; les 12 citées par le README y figurent |

Contrôles menés sous HOME isolé `_qa/release2/home` (gitignoré). Aucun fichier écrit hors du
clone ; le répertoire de test `node_modules/.gk31-readme-home` du dépôt principal préexistait aux
exécutions et n'a pas été créé par cette mission.

## Observations à transmettre (hors périmètre, non corrigées)

1. **`CLAUDE.md` est périmé sur deux chiffres structurants** (15 providers, ~110 outils dans
   `tools.ts`). Ces valeurs orientent toute lane qui les lit.
2. **Quatre sources TypeScript sont vues comme binaires par `grep`/ripgrep** à cause d'un `\x00`
   littéral servant de séparateur de clé composite :
   `src/fleet/model-scoreboard.ts:467`, `src/review/review-engine.ts:48`,
   `src/scheduler/pre-check-runner.ts:229`, `src/sensory/tts-cache.ts:98`. C'est du TypeScript
   valide, mais tout audit par `grep` les saute en silence. Un séparateur non nul (par exemple `\u001f`) ou une note
   `.gitattributes` supprimerait le piège.
3. **`tests/docs/readme-truth.test.ts` écrit dans `node_modules/.gk31-readme-home`**, donc dans
   l'arbre de dépendances partagé quand `node_modules` est un lien. Un `mkdtemp` serait cohérent
   avec l'hygiène TESTWRITE1/BRANCH1 déjà appliquée ailleurs.
4. **`docs/RELEASE-NOTES-2.0.0.md` est en anglais**, comme le README, `docs/getting-started.md` et
   `docs/install.md` — pages d'entrée du paquet npm. Le CHANGELOG reste en français. À arbitrer
   par Patrice si une version française des notes est souhaitée.
