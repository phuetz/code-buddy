# Réparation PRIV1 — chemins de home et noms de dépôts privés hors du dépôt public

Clone : `~/DEV/cb-priv1-2026-09-03`
Branche : `fix/priv1-chemins-prives-2026-09-03`
Agent : Grok 4.6
Date : 2026-09-03
HOME temporaire : `_qa/priv1/home` (dans le clone uniquement)
Original `~/code-buddy` : interdit en écriture

Ce rapport a été créé **avant toute inspection du code**.

Source du constat : revue AGYSEC1. Le dépôt est public. Les fichiers suivis citaient le chemin absolu du home de l'auteur et des noms de dépôts privés. Le garde-fou `tests/security/donnees-personnelles.test.ts` ne les voyait pas.

Les extraits ci-dessous sont **déjà assainis** (`~/…`, désignations neutres). Le rapport ne reproduit aucun chemin `/home/<utilisateur>` ni aucun nom de dépôt privé.

## Mesure

`git grep -n` sur les fichiers suivis, avant nettoyage :

| Famille | Fichiers (garde-fou étendu, rouge avant) |
|---|---|
| documentation | 39 |
| rapport de lane | 86 |
| script | 27 |
| TS/JS source (commentaires / texte d'aide) | 16 |
| test | 26 |
| autre (config MCP, artefact de campagne) | 2 |
| **total** | **196** |

Termes trouvés (libellés neutres) : chemin-home-auteur 158 ; dépôt de passation 22 ; moteur explorer privé 16 ; outil éditorial privé 4 ; chemin Windows auteur 7 (certains fichiers cumulent plusieurs termes).

`git grep -l '/home/'` brut remontait davantage de fichiers : fixtures synthétiques (`/home/user`), image Docker (`/home/codebuddy`), et `_qa/*/home/` dans `.gitignore`. Le garde-fou vise le login de l'auteur, construit par concaténation, pas ces témoins.

### Liste des 196 fautifs (rouge avant), classée par famille

#### documentation (39)

`.gitignore` n'y figure pas. CHANGELOG est exempté du garde-fou mais a été nettoyé.

- cowork/DEV-LINUX.md → chemin-home-auteur
- cowork/pilot/README.md → chemin-home-auteur
- deep_research/filecommander-integration/final-summary.md → chemin-home-auteur
- docs/FABLE5-CODEX-COORDINATION.md → chemin-home-auteur, depot-passation, moteur-explorer-prive
- docs/PORTAGE-AUDITS-JUILLET-2026-08-02.md → chemin-home-auteur
- docs/archive/2026-q2-hermes-audits/openclaw-integration-audit.md → depot-passation
- docs/archive/internal/hermes-agent-strategy.md → moteur-explorer-prive
- docs/archive/internal/rust-daemon-strategy.md → moteur-explorer-prive
- docs/audits/2026-07-10-application-audit.md → chemin-home-auteur
- docs/audits/2026-07-15-code-buddy-2-vision.md → moteur-explorer-prive
- docs/audits/2026-08-25-etat-pr-ouvertes.md → moteur-explorer-prive
- docs/audits/2026-08-25-sante-depot-avant-push.md → chemin-home-auteur
- docs/audits/codex-security-comparison-2026-07-12.md → outil-editorial-prive
- docs/audits/composites-identite-2026-08-01.md → chemin-home-auteur
- docs/audits/realtime-voice-open-source-2026-07-11.md → chemin-home-auteur
- docs/cb2/multi-repo.md → moteur-explorer-prive
- docs/chaines/AMBRE-VIDEO-01-RAPPORT-V02.md → chemin-home-auteur
- docs/chaines/AMBRE-VIDEO-01-RAPPORT.md → chemin-home-auteur
- docs/chaines/AMBRE-VIDEO-02-RAPPORT.md → chemin-home-auteur
- docs/code-explorer-benchmark/tasks.json → chemin-home-auteur
- docs/cognitive-mesh.md → depot-passation
- docs/comfyui-use-cases.md → chemin-home-auteur
- docs/companion-guide.md → chemin-home-auteur
- docs/design-view.md → chemin-home-auteur
- docs/designs/code-buddy-tomorrow-plan.md → outil-editorial-prive
- docs/drafts/BILAN-REPRISE-OPUS-2026-08-24.md → chemin-home-auteur
- docs/fleet-guide.md → chemin-home-auteur, depot-passation
- docs/flow-studio.md → chemin-home-auteur
- docs/hermes-memory-providers-selfhost.md → chemin-home-auteur
- docs/lancement-chaines/AMBRE-SHORTS-V4-KIT-PUBLICATION-2026-08-02.md → chemin-home-auteur
- docs/lancement-chaines/CORRECTION-LISA-5-SIGNAUX-V4-2026-08-01.md → chemin-home-auteur
- docs/lancement-chaines/LISA-5-SIGNAUX-KIT-PUBLICATION-2026-08-01.md → chemin-home-auteur
- docs/plans/2026-07-18-mysoulmate-youtube-pipeline-status.md → chemin-home-auteur
- docs/proof.md → chemin-home-auteur
- docs/providers/omniroute-free-catalog-livecheck-2026-08-22.md → chemin-home-auteur
- docs/research/codex-autonomous-coding-notes.md → chemin-home-auteur
- docs/specs/cb2/INNOV-10-multi-repo.md → moteur-explorer-prive
- docs/studies/2026-07-27-format-chaine-ambre-voyage.md → chemin-home-auteur
- queue/10-app-studio-v2.md, queue/11-agentic-os-v2.md, queue/12-core-tools-v2.md → chemin-home-auteur

#### rapport de lane (86)

Les 86 rapports / réparations / revues / briefs / audits / défauts / bancs / études à la racine qui figuraient au rouge (AUDIT-BOUCLE…, AUTOPILOT-STATE, BANC-FIN-DE-TOUR, BILAN-SHARE, CODEX-*, CORE-AGENT-TOOLS-BRIEF, COWORK-*-BRIEF, DEFAUTS-*, ETUDE-PERCEPTION-*, RAPPORT-*, REPARATION-* sauf celui-ci, REVUE-*). AUTOPILOT-STATE cumulait les trois familles de noms. DEFAUTS-UX citait l'outil éditorial privé (copie d'aide CLI).

#### script (27)

`_qa/gk4/run-from-prompt.sh` et `-b.sh` ; `scripts/fix-research.sh` ; `scripts/gpuNode-dev.sh` ; `scripts/gpuNode/*` (mjs/ts/py/sh/ps1) ; `scripts/influencer/*` concernés ; `scripts/mysoulmate/render-youtube-short-batch.ts` ; `scripts/overnight-lisa.sh` et `overnight-lisa-pipeline.sh` ; `start-with-mcp.ps1` ; `cowork/pilot/_chat_shot.mjs` et `_goal_run.mjs`.

#### TS/JS source (16)

Commentaires et texte d'aide : `src/agent/autonomous/fleet-task-types.ts`, `fleet-tick-handler.ts`, `src/agent/execution/agent-executor.ts`, `src/agent/facades/message-history-manager.ts`, `src/codebuddy/stream-retry.ts`, `src/commands/handlers/{daily-reset,fleet,heartbeat}-handler.ts`, `src/config/toml-config.ts`, `src/context/{auto-compact-threshold,tool-pair-preserver}.ts`, `src/fleet/colab-store.ts`, plus commentaires Cowork `HealthBadge` / `MessageComposer` / `use-backend-status` / `use-textarea-autogrow`.

#### test (26)

Dont `tests/docs/gk35-mcp-docs.test.ts` (assertions qui citaient le chemin privé qu'elles cherchaient), `tests/companion/gk23-harness.ts`, `tests/tools/gk21-web-test-reel.test.ts`, fixtures `/home/<auteur>` dans privacy-lint, vision, subprocess-env, etc.

#### autre (2)

`.codebuddy/mcp.json` (chemins absolus vers l'outil éditorial) ; `apps/codebuddy-real-campaign/.../call_*.txt`.

## Remplacements

- Documentation, rapports, CHANGELOG, queue : `/home/<utilisateur>/…` → `~/…`. Noms de dépôts privés → « le dépôt privé de passation » / `private-handover-repo` / `code-explorer` (nom public) / « un outil éditorial tiers ».
- Liens `file:///…/clone/tests/…` dans les revues → chemins relatifs `tests/…` (un `file://~` n'est pas une URL).
- Scripts shell : `$HOME/…`. `_qa/gk4` : `ROOT` dérivé du script, plus un autre clone. `gpuNode-dev.sh` : plus de défaut Windows d'auteur ; `GPU_NODE_HOTE_SSH` / `GPU_NODE_DEPOT` exigés.
- Python : `os.path.expanduser('~/…')` (`from __future__` reste en tête).
- JS/mjs : `` `${process.env.HOME}/…` `` ; e2e Cowork : `path.join(os.homedir(), 'code-buddy', 'dist')`.
- Tests : fixtures `/home/user` ; gk35 `not.toMatch(/\/home\/[^/]+\//)` ; gk23/gk21 : `os.homedir()`.
- `.codebuddy/mcp.json` : args = variable d'environnement du stdio MCP éditorial, serveurs éditoriaux `enabled: false`. Identifiants de serveur inchangés (pont produit, fichiers non renommables).
- `start-with-mcp.ps1` : binaire `code-explorer` sur PATH / `CODE_EXPLORER_BIN`.

Non touché (hors périmètre ou preuve insuffisante pour un changement de comportement) : `Dockerfile` / `docker-compose` (`/home/codebuddy`) ; fixtures synthétiques `/home/user` ; artefacts `src-sidecar/target/` (exclus du garde-fou). Le pont MCP éditorial (skill bundlée, `campaign`, tests d'identifiant) reste nommé dans le code : le garde-fou l'exempte **par chemin de fichier**, pas par silence global.

## Garde-fou

Ajouts dans `INTERDITS`, tous par concaténation :

- `/` + `home` + `/` + login auteur
- `c:/users/` + login Windows ; variante antislash
- nom du dépôt de passation
- nom privé de l'ancien moteur Code Explorer
- nom de l'outil éditorial privé (insensible à la casse via `toLowerCase`)

CHANGELOG reste exempté (nettoyé quand même). `src-sidecar/target/` ignoré (artefacts).

### Rouge avant (sortie, extraits)

```
npx vitest run tests/security/donnees-personnelles.test.ts
 FAIL  tests/security/donnees-personnelles.test.ts
 Test Files  1 failed (1)
      Tests  1 failed (1)
 Duration  943ms
```

196 fichiers fautifs (liste classée ci-dessus). Première ligne du tableau reçu : `.codebuddy/mcp.json → chemin-home-auteur`. Dernière : `tests/unit/subprocess-env.test.ts → chemin-home-auteur`.

### Vert après

```
npx vitest run tests/security/donnees-personnelles.test.ts
 Test Files  1 passed (1)
      Tests  1 passed (1)
 Duration  1.42s
```

Mutation gk35 : une ligne `See /home/someone/DEV/code-explorer` dans `docs/code-explorer-integration.md` fait échouer `not.toMatch(/\/home\/[^/]+\//)` ; fichier restauré ensuite, 3/3 verts.

## Preuves

- `npx vitest run tests/docs tests/security` : **50 files / 940 tests passed** (après `npx tsc -p .` pour `dist/index.js`, exigé par `revue-gemini-docs` qui exécute le CLI compilé ; sans `dist/` ce fichier est rouge MODULE_NOT_FOUND, préexistant).
- Tests touchés relancés : gk35 3/3 ; privacy-lint, subprocess-env, vision, sensory-workspace, comfy-health, navigate-ssrf, lead-scout, route-peer, shadow-cli, auto-compact, tool-pair-preserver, subagents-explore, gk21, env-files Cowork, gk23 store/telegram/remind-cli 5/5. Cowork 4 fichiers / 35 tests.
- Préexistants, hors mission : `tests/unit/hook-manager.test.ts` 8 rouges seul (commentaire seulement modifié) ; `tests/agent/autonomous/fleet-tick-handler.test.ts` `mkdir '/fake'` (déjà noté IMPROVE1).
- `npx tsc --noEmit -p .` code 0. `npx tsc -p .` emit 0 (dist non commité).
- `npx eslint <ts src/tests/scripts modifiés> --max-warnings=0` code 0. `src/codebuddy/stream-retry.ts` : 1 warning préexistant unused `eslint-disable no-constant-condition` sur `while (true)` (seul le commentaire d'audit a changé). ESLint Cowork : plugin `eslint-plugin-react-hooks` absent de ce clone (pas de `cowork/node_modules`) ; tests Cowork 35/35.
- `git diff --check` code 0.
- `bash -n` : overnight-lisa, overnight-lisa-pipeline, rerender-ghost-contour-clips, gpuNode-dev, fix-research, `_qa/gk4/run-from-prompt{,-b}.sh`.
- `node --check` sur les mjs gpuNode/pilot. `python3 -m py_compile` sur les py touchés.
- Scripts overnight / gpuNode / gpuNode-dev **non exécutés en live** (ComfyUI 8188, SSH machine Windows) : syntaxe seulement.

Aucun push. `node_modules` du clone est un lien vers l'original : aucune écriture via ce lien.

## Ouvert

- Le pont produit vers l'outil éditorial (noms de serveur MCP, skill, CLI `campaign`) reste dans le dépôt public : le renommer casserait l'API et les fichiers, interdit par la mission.
- `src-sidecar/target/` suivi contient encore des chemins Windows d'auteur dans des `.d` de compilation ; exclus du scan, pas nettoyés (binaires / artefacts).
- `gpuNode-dev.sh` refuse désormais de partir sans `GPU_NODE_HOTE_SSH` et `GPU_NODE_DEPOT`.
- `.codebuddy/mcp.json` : serveurs éditoriaux désactivés ; l'opérateur local doit fournir le chemin stdio par variable d'environnement s'il les réactive chez lui, hors dépôt public.
