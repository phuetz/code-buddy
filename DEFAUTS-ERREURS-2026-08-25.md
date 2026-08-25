# Défauts d'erreur — ce que dit l'outil quand ça se passe mal
# 2026-08-25

Inventaire réel : `buddy --help` expose **102** commandes de premier niveau.
Sondage : `node node_modules/tsx/dist/cli.mjs src/index.ts` (pas le `buddy`
global, qui peut pointer un `dist/` périmé). Aucun appel payant. Aucun
`git push`. Le serveur déjà à l'écoute sur 3000/3001 n'a pas été arrêté.

L'autre mission (chemin nominal) a posé `DEFAUTS-UX-2026-08-25.md` : **non
touché**. Idem `docs/FABLE5-CODEX-COORDINATION.md` (déjà dirty) et
`scripts/influencer/oauth-ambre.sh`.

Un message utile dit **quoi**, **où**, **quoi faire**. Une pile Node en pleine
figure est un défaut même si le comportement est correct.

---

## Déjà bon — rien à signaler

| Commande tapée | Sortie (extrait) | Pourquoi c'est suffisant |
|---|---|---|
| `buddy loop` | `error: missing required argument 'goal'` | Nomme l'argument. |
| `buddy film generate` | `error: missing required argument 'name'` | Idem. |
| `buddy this-is-not-a-command` | `Commande inconnue « this-is-not-a-command ». Voir buddy --help` | Nomme la commande, dit où regarder. |
| `buddy login not-a-provider` | `Unknown provider: "not-a-provider". Supported: \`chatgpt\`, \`xai\`.` | Valeur + liste. |
| `buddy --profile nimportequoi --help` | `Profile error: Profile "nimportequoi" not found. Available profiles: core, all, nvidia, nvidia-fast, omniroute` | Valeur + liste. |
| `buddy explain --depth nimportequoi` | `argument 'nimportequoi' is invalid. La profondeur doit être \`quick\` ou \`deep\`.` | Valeur + liste. |
| `buddy cost --by nimportequoi` | `` `--by` doit valoir `model`, `provider` ou `day`. `` | Valeur + liste. |
| `buddy loop x --permission-mode nimportequoi` | `Posture de permission inconnue : nimportequoi. Valeurs : default, plan, acceptEdits, dontAsk, bypassPermissions` | Déjà corrigé aujourd'hui (`19049d97`). |
| `buddy backup verify <absent>` | `Backup file not found: <chemin résolu>` | Le chemin cherché est là. |
| `buddy scrape` | `A URL is required unless --setup or --check is used.` | Dit quoi fournir. |
| `buddy science` | `error: missing required argument 'goal'` | Nomme l'argument. |
| `buddy changelog` hors git | `Ce dossier n’est pas un dépôt Git : /home/patrice` | Nomme le cwd. `src/commands/changelog.ts:123`. |
| `buddy vision-train` sans opt-in | Dit d'exporter `CODEBUDDY_VISION_TRAIN=true` et comment. | Actionnable. |

`logger.getLevel()` est déjà exposé à côté de `setLevel` (`src/utils/logger.ts:180,554`).
Rien à faire de plus sur ce point.

---

## Tableau — commandes, sorties, attendu, gravité

Les sorties « avant » sont celles du sondage **avant** les correctifs de ce lot,
sauf mention contraire.

| # | Commande | Sortie observée | Ce qui devrait sortir | Gravité | Fichier:ligne |
|---|---|---|---|---|---|
| E1 | `buddy research x --permission-mode acceptEdits` (idem `goal`, `flow`, `film status`, `improve status`, `skills list`, `dev plan`, `run list`, `backup list`, `cost`, `changelog`) | `error: unknown option '--permission-mode'` — **sans dire que l'option existe avant la sous-commande**. `loop` l'accepte déjà après. | Nommer le flag, dire de le placer **avant** la sous-commande, donner un exemple, lister les valeurs. | **bloquant** | `src/index.ts:1231` (`enablePositionalOptions`) ; correctif `src/cli/unknown-option-hint.ts:69` |
| E2 | `buddy loop x --max-turns abc` / `--max-turns 0` | `error: --max-turns must be a positive integer` | Reprendre `abc` / `0` et dire « entier ≥ 1 ». | **gênant** | `src/commands/goal-cli.ts:292-298` |
| E3 | `buddy loop x --budget -5` / `--budget abc` | `error: --budget must be a positive number` | Reprendre la valeur reçue. | **gênant** | `src/commands/loop-cli.ts:31-36` |
| E4 | `buddy research x --workers abc` | Lançait Wide Research avec **Items: 5** (clamp silencieux) puis crash `Unhandled promise rejection` + fichier dans `~/.codebuddy/recovery/`. | Refuser `abc`, citer `--workers` et la plage 1–20. | **bloquant** | `src/commands/research/index.ts:87` |
| E5 | `buddy server --port abc` / `--port -1` | Démarre métriques/WS puis `ERROR Failed to start server {"errorName":"RangeError",...,"errorStack":"RangeError [ERR_SOCKET_BAD_PORT]: ... Received type number (NaN).\\n    at Server.listen..."}` | Refuser **avant** `listen`. Nommer la valeur et la plage 1–65535. Pas de pile. | **bloquant** | `src/index.ts:2506-2516` ; `src/cli/listen-port.ts:10` |
| E6 | `buddy -d <absent> -p hi` | `ERROR ... {"errorName":"Error","errorMessage":"ENOENT: ...","errorStack":"Error: ENOENT...\\n    at wrappedChdir...\\n    at Command.<anonymous> (.../src/index.ts:1649:17)"}` | Une ligne : le chemin, ENOENT, pas de pile. | **gênant** | `src/index.ts:1650-1657` et `2297-2304` |
| E7 | `buddy --profile --help` | `Profile error: Profile "--help" not found. Available profiles: ...` | `--profile` exige un nom ; `--help` n'en est pas un. Lister les profils. | **gênant** | `src/cli/requested-profile.ts:13` ; `src/index.ts:3858` |
| E8 | `buddy backup restore` / `verify` (sans fichier) | `Usage: backup restore <file>` **exit 0** | Le même texte, **exit 1**. | **gênant** | `src/commands/handlers/backup-handlers.ts:223` |
| E9 | `buddy backup create` dans un dossier vide | `No .codebuddy/ directory found in current project.` (pas le chemin) ; exit 0 avant ce lot | Chemin cherché + `buddy --init`. Exit 1. | **gênant** | `src/commands/handlers/backup-handlers.ts:76-81` |
| E10 | `buddy voice --mode nimportequoi` | `⚠️ Unknown --mode 'nimportequoi', falling back to 'default'` puis **lance la session** (timeout, STT, pile Python). | Refuser, lister les modes, **exit 1**, ne pas enregistrer. | **bloquant** | `src/index.ts:2538-2546` |
| E11 | `buddy intent nimportequoi` | `Unhandled promise rejection` + crash recovery. `buddy intent view nimportequoi` lit `view` comme vue. | `unknown view '…'. Expected: graph, proofs, …` sans crash. | **bloquant** | `src/commands/intent.ts:36-43` |
| E12 | `buddy goal x --permission-mode acceptEdits` | `error: unknown option '--permission-mode'` | Comme `loop` : accepter après la sous-commande ; valeur inconnue listée. | **gênant** | `src/commands/goal-cli.ts:341-361` |
| E13 | `buddy remind add` / `done` / `rm` ; `buddy rules enable` / `rm` | Usage imprimé, **exit 0** | Exit 1. | **gênant** | `src/index.ts:2567+` |
| E14 | `buddy remind add test --at 25:99` | `❌ invalid time '25:99' (expected HH:MM)` — **exit 0** | Le texte est bon ; exit 1. | **cosmétique** | `src/index.ts` catch remind |
| E15 | `buddy update not-a-sub` | `Installing codebuddy-cli@latest... Update complete.` **exit 0** — un argument inconnu **installe**. | Refuser le sous-ordre inconnu, lister `stable\|beta\|dev`, ne rien installer. | **bloquant** | `src/commands/update.ts` — **à trancher** (logique d'update, pas seulement un texte) |
| E16 | `buddy share` sans argument | Écrit un HTML dans le cwd, exit 0 | Demander un id / `--last` / confirmer avant d'écrire. | **gênant** | **à trancher** (comportement métier) |
| E17 | `buddy share --out <dir-absent>/out.html` | **Crée** le dossier et écrit le fichier | Dire que le dossier n'existe pas, ou le créer en le nommant. | **gênant** | **à trancher** |
| E18 | `buddy import` sans argument | Importe `CLAUDE.md` du cwd (a créé `CODEBUDDY.md` ici — nettoyé) | Exiger `--dir` / une source, ou un `--dry-run`. | **gênant** | **à trancher** |
| E19 | `buddy explain` sans argument | Écrit `codebuddy-explain-*.md` dans le cwd | Annoncer le chemin **avant**, ou exiger `--out`. | **cosmétique** | le chemin est loggé ; **à trancher** si on refuse l'écriture implicite |
| E20 | `buddy improve loop --max abc` | Ignore `abc`, tourne, **exit 0** | Refuser `abc`. | **gênant** | `src/commands/cli/improve-command.ts:473` — **à trancher** (parser `--max`) |
| E21 | `buddy film generate demo --engine nimportequoi --assemble-only` | `✗ No scene plan provided…` — **ne mentionne pas** `engine` | Si `--engine` est invalide, le dire (`xfade`/`gl`). | **gênant** | `src/commands/film.ts` — **à trancher** |
| E22 | `buddy knowledge add <absent>` | Invite `Title:` et exit 0 | Le fichier n'existe pas : le dire, exit 1. | **bloquant** | **à trancher** (invite interactive vs fichier) |
| E23 | `buddy config set` | `error: unknown command 'set' (Did you mean get?)` | Soit `set` existe et l'aide le dit, soit l'aide ne promet pas `/config set`. | **gênant** | **à trancher** (surface `config`) |
| E24 | `buddy skills install` | `error: unknown command 'install'` | Pointer `skills` réel (`import`, `exchange`, …). | **gênant** | **à trancher** |
| E25 | `buddy meeting <fichier>` | `error: unknown command '<fichier>'` | `Usage: buddy meeting notes <input>` | **gênant** | `src/commands/meeting.ts:22` — **à trancher** (raccourci vs sous-commande) |
| E26 | `buddy ws add <chemin>` | `error: missing required argument 'path'` (le chemin a été pris pour `name`) | `Usage: buddy ws add <name> <path>` | **gênant** | déjà dans l'aide ; le message de missing ne rappelle pas l'ordre |
| E27 | `buddy flow x --max-retries abc` | `Planning Flow: "x"` puis `404 model '…' not found` | `abc` n'est pas un entier ; ne pas appeler le modèle. | **gênant** | **à trancher** (validation vs réseau) |
| E28 | `buddy --permission-mode nimportequoi --help` | Aide affichée, **exit 0**, pas de mention de la valeur | Soit refuser (exit 1), soit l'aide + un warning qui nomme la valeur. Aujourd'hui `--help` court-circuite. | **cosmétique** | `src/index.ts:1768` (validation seulement dans l'action chat) |
| E29 | `buddy --security-mode nimportequoi --help` / `--output-format` / `--max-price -5` / `--max-tool-rounds abc` | Aide, exit 0, **aucune validation** | Valider ou ignorer ostensiblement. | **gênant** | options racine sans parser — **à trancher** (ne pas changer le chat pour `--help`) |
| E30 | `buddy loop x --model qwen3:8b` (modèle absent) | 20 tours `judge error: Error` ; le 404 est noyé dans les logs | Un 404 modèle doit **arrêter** et citer le modèle. | **bloquant** | boucle goal/loop — **à trancher** (logique métier / réseau) |
| E31 | `buddy reminder agenda --ahead abc` | `Rien de prévu…` exit 0 (`Number('abc')` → NaN → 7) | Refuser `abc`. | **gênant** | `src/index.ts:2601` — **à trancher** |
| E32 | `buddy film assemble demo --music <absent>` | `error: unknown option '--music'` | `--music` est sur `generate`, pas `assemble`. Le dire. | **cosmétique** | `src/commands/film.ts` |

Hors dépôt git, `buddy changelog` est déjà clair (E-bon ci-dessus). Un dossier
vide **à l'intérieur** de ce repo n'est pas « hors git » : git remonte au
`.git` parent, donc `changelog` réussit — ce n'est pas un défaut d'erreur.

---

Commits locaux (non poussés) : `b2865cbf` (CLI racine), `2ab5a3b1` (backup),
`fa653429` (loop/goal), `80216860` (research), `8f9aac27` (intent).

## Corrigé dans ce lot

Uniquement des **messages** / validations d'entrée, avec tests. Pas la
sécurité, pas les permissions métier, pas le réseau.

| # | Correctif | Preuve |
|---|---|---|
| E1 | Si le flag inconnu existe sur le programme principal, le message dit de le mettre **avant** la sous-commande, avec exemple et valeurs. | `tests/cli/unknown-option-hint.test.ts` ; spawn `tests/cli/cli-error-messages.test.ts` (« BEFORE the subcommand ») |
| E2 E3 | `--max-turns` / `--budget` citent la valeur reçue. | `tests/commands/loop-cli-options.test.ts` ; `tests/commands/goal-cli.test.ts` ; spawn `--max-turns abc` |
| E4 | `--workers abc` (et `--items` / `--concurrency` / `--rounds` non entiers) refusés. Le clamp numérique `0`→1, `99`→20 **inchangé** (tests existants). | `tests/commands/research/integer-options.test.ts` ; `tests/commands/research/checkpoint-flags.test.ts` toujours vert |
| E5 | `--port` validé avant `listen`. | `tests/cli/listen-port.test.ts` ; spawn : pas de `WebSocket server enabled`, pas de `errorStack` |
| E6 | `-d` inexistant : une ligne stderr, le chemin, pas de pile. | spawn `tests/cli/cli-error-messages.test.ts` |
| E7 | `--profile --help` n'est plus un profil nommé `--help`. | `tests/cli/requested-profile.test.ts` ; spawn |
| E8 E9 | backup usage / fichier / `.codebuddy` manquant : chemin + exit 1 + `buddy --init`. | `tests/commands/backup-handlers.test.ts` ; spawn `backup restore` ; repro vide : `No .codebuddy/ directory found at …/empty-workdir/.codebuddy` |
| E10 | `--mode` voix inconnu : exit 1, pas de session. | spawn : pas de `falling back`, pas de `Voice commands` |
| E11 | Vue `intent` inconnue : message Commander, pas de crash dump. | `tests/commands/intent.test.ts` |
| E12 | `goal` déclare `--permission-mode` comme `loop`. Valeur inconnue listée. | `tests/commands/goal-cli-options.test.ts` ; `buddy goal x --permission-mode nimportequoi` → `Unknown permission mode: nimportequoi. Values: …` |
| E13 E14 | `remind` / `rules` : usage et erreurs en exit 1. | câblé dans `src/index.ts` ; pas de nouveau fichier de test dédié (spawn backup/voice couvrent le même contrat d'exit) |

Vérifications :

- `npx tsc --noEmit -p tsconfig.json` → **exit 0** avant et après.
- `npx eslint <fichiers touchés>` → **0 erreur** (warnings préexistants `any` / `logger` inutilisé).
- Tests ciblés verts (pas la suite ~27k) : helpers CLI 31, goal+intent+research 46, spawn error-messages **7/7**, help-output **5/5** (avec `FORCE_COLOR` retiré, sinon le stderr du test existant se plaint du warning Node — préexistant à l'environnement de session).

---

## À trancher

Hors périmètre « messages seulement », ou changement de comportement métier /
réseau / sécurité.

1. **`buddy update not-a-sub` installe** (`codebuddy-cli@latest`). Un typo devient
   une mise à jour. Corriger = changer le contrat d'`update`, pas un texte.
2. **404 modèle** (`loop`/`goal`/`research`/`flow`) : aujourd'hui ça tourne, crashe,
   ou répète `judge error: Error`. Arrêter au premier 404 est de la logique de
   boucle, pas un libellé.
3. **`share` / `import` / `explain` écrivent dans le cwd** sans le demander.
   `share --out` crée les dossiers manquants. Décision produit.
4. **`improve --max abc`**, **`--engine` film**, **`--ahead` remind**,
   **`--max-retries` flow** : clamp ou ignore. Aligner sur le refus explicite
   d'E4, mais chaque parser a sa politique (research **clamp** les entiers hors
   plage volontairement, tests `checkpoint-flags`).
5. **`config set` / `skills install` / `meeting <fichier>` / `ws add <path>`** :
   surface d'aide vs argv. Changer l'alias ou le raccourci n'est pas un message.
6. **Options racine invalides + `--help`** : Commander affiche l'aide et sort 0.
   Valider malgré `--help` casserait un réflexe (`buddy --output-format nimportequoi --help`
   pour découvrir les valeurs).
7. **`knowledge add` fichier absent** → invite `Title:`. UX interactive vs
   fail-closed.

---

## Fichiers laissés / artefacts du sondage

- Non touchés : `DEFAUTS-UX-2026-08-25.md`, `scripts/influencer/oauth-ambre.sh`.
- `docs/FABLE5-CODEX-COORDINATION.md` : déjà dirty (CB1) ; ligne CB2 ajoutée dans
  le working tree, **non commitée** pour ne pas emporter la réservation de l'autre.
- Artefacts du sondage **supprimés** : `CODEBUDDY.md` (import),
  `codebuddy-explain-*.md`, `codebuddy-session-*.html`,
  `this-path-does-not-exist-cb2-xyzzy/`.
- `buddy server --port abc` n'a **pas** pris 3000 (échec avant `listen`). Le
  `node` déjà sur 3000 (pid 3598) n'a pas été tué.
- `scratch-cb2-error-probe.py` / `scratch-cb2-error-probe/` : notes de sondage,
  pas dans git.
