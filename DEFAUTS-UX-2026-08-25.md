# Défauts UX vus par un nouvel utilisateur — 2026-08-25

## Verdict

L’audit a exécuté le vrai lanceur `buddy`, pas seulement les tests ou les fabriques Commander. Les 102 aides de premier niveau exposées par `buddy --help` ont été lancées et sont sorties avec le code 0. Les sept consultations demandées ont aussi été exécutées sans appel LLM : `doctor`, `skills list`, `skills doctor`, `whoami`, `improve status`, `autonomy status` et `run list`.

Le résultat le plus coûteux n’est pas un crash de code : le lanceur local pointait sur un `dist/` vieux de douze heures et ne contenait pas encore le correctif `19049d97` pourtant présent au HEAD. Après reconstruction, le correctif est bien effectif. Les autres défauts prouvés se répartissent entre une portée d’options globales volontairement stricte mais initialement muette, des erreurs d’entrée silencieusement ignorées, de faux avertissements dans `doctor`, des diagnostics `skills` non directement actionnables et de la télémétrie dans quatre aides. L’audit transversal des erreurs exécuté sur la même branche est consigné séparément dans [`DEFAUTS-ERREURS-2026-08-25.md`](DEFAUTS-ERREURS-2026-08-25.md).

## Tableau classé par coût pour un nouvel utilisateur

| ID | Commande exacte | Symptôme reproduit | Gravité | Fichier:ligne en cause |
|---|---|---|---|---|
| D1 | `buddy loop objectif --permission-mode valeur-invalide` avant `npm run build` | Le vrai `buddy` répondait encore `unknown option` alors que le HEAD contenait le correctif ; le lanceur exécutait un `dist/` antérieur. | bloquant | hors Git : `~/.local/bin/buddy:4-7`, `dist/commands/loop-cli.js` antérieur à `src/commands/loop-cli.ts:97` |
| D2 | `buddy doctor unexpected`, `buddy whoami unexpected`, `buddy improve status unexpected`, `buddy run list --limit not-a-number` | Les trois arguments superflus sont ignorés avec exit 0 ; la limite non numérique répond `No runs found.` avec exit 0. L’utilisateur reçoit un succès mensonger au lieu d’une correction. | gênant | `src/commands/cli/utility-commands.ts:21-26`, `src/index.ts:3015-3018`, `src/commands/cli/improve-command.ts:266-270`, `src/commands/run-cli/index.ts:38-44` |
| D3 | `buddy doctor --permission-mode default` (même rejet sur les six autres consultations) | Une option documentée au niveau principal est refusée après la sous-commande. Initialement, le message ne disait pas où la placer ; le premier correctif tronquait en plus les chemins imbriqués (`… list` au lieu de `… skills list`) et oubliait `doctor`. | gênant | portée voulue : `src/index.ts:1225-1231` ; conseil corrigé : `src/cli/unknown-option-hint.ts:68-124`, `src/index.ts:3245-3255` |
| D4 | `buddy --profile core --help` | Le profil présenté comme surface cœur expose encore 91 commandes sur 102 ; le nouveau venu doit parcourir presque tout le produit avancé. | gênant | `src/config/feature-surface.ts:27-44`, `src/config/toml-config.ts:861-875` |
| D5 | `buddy doctor` | Un compte ChatGPT connecté était accompagné de quatre avertissements « API key … not set » et d’un avertissement sur `.codebuddy/config.json`, fichier legacy sans consommateur de production trouvé. | gênant | corrigé dans `src/doctor/index.ts:78-150` et `src/doctor/index.ts:218-225` |
| D6 | `buddy skills list`, puis `buddy skills doctor` | La liste disait `4 enabled / 4 total` malgré deux `missing SKILL.md`, renvoyait l’humain vers `--json`, puis le doctor proposait la syntaxe interne `skill_manage` au lieu de la commande CLI déjà calculée. | gênant | corrigé dans `src/commands/skills-cli/index.ts:70-91`, `:142-170`, `:268-277` |
| D7 | `buddy mcp --help`, `buddy campaign --help`, `buddy hermes --help`, `buddy tools --help` | Chaque aide commençait par `INFO [self-improve] reloaded 5 authored tool(s)…`. `buddy --quiet --profile core doctor` affichait aussi `INFO Applied config profile: core`. | cosmétique | corrigé dans `src/codebuddy/tools.ts:287-291` et `src/config/toml-config.ts:1266-1276` |
| D8 | `buddy improve status` puis `buddy autonomy status` | `improve status` affiche `Autonomy: propose-only`, alors que la commande `autonomy status` désigne une file Fleet complètement différente. Une même notion apparente nomme deux sous-systèmes. | cosmétique | `src/commands/cli/improve-command.ts:266-281`, `src/commands/cli/native-engine-commands.ts:995-1018` |
| D9 | `buddy --help` et les aides de sous-commandes | La page commence en français, passe immédiatement à une description/options en anglais, puis mélange commandes françaises (`loop`, `share`, `cost`) et anglaises (`goal`, `doctor`, `skills`). | cosmétique | descriptions distribuées dans `src/index.ts` et `src/commands/**` ; aucune politique de locale trouvée |
| D10 | `buddy --help` | `--max-tool-rounds` affiche deux fois sa valeur : `(default: 400) (default: "400")`. `research --help` fait de même pour `--rounds` et `--worker-timeout-ms`. | cosmétique | `src/index.ts:1259-1263`, descriptions dans `src/commands/research/index.ts` |
| D11 | `buddy skills doctor` | Deux paquets manquants sont signalés, mais la commande sort avec le code 0. C’est lisible pour un humain, ambigu pour un health-check automatisé. | cosmétique | `src/commands/skills-cli/index.ts:263-278` |

## Défauts reproduits

### D1 — la source corrigée n’était pas le programme exécuté

Avant reconstruction :

```text
$ stat -c '%y %n' src/commands/loop-cli.ts dist/commands/loop-cli.js
2026-08-25 18:06:36 +0200 src/commands/loop-cli.ts
2026-08-25 06:04:27 +0200 dist/commands/loop-cli.js

$ buddy loop objectif --permission-mode valeur-invalide
error: unknown option '--permission-mode'
exit 1
```

Après `npm run build` :

```text
$ buddy loop objectif --permission-mode valeur-invalide
Loop error: Posture de permission inconnue : valeur-invalide. Valeurs : default, plan, acceptEdits, dontAsk, bypassPermissions
exit 1
```

Ce qui devrait se passer : le lanceur utilisé pour une démonstration du checkout actif doit exécuter les artefacts correspondant au HEAD, ou détecter clairement qu’ils sont périmés. La forme valide avec `acceptEdits` n’a pas été relancée : elle aurait démarré une boucle LLM, interdite par la mission. Le validateur invalide suffit à prouver que l’option corrigée est désormais câblée.

### D2 — de mauvaises valeurs produisent un faux succès

```text
$ buddy doctor unexpected
🔍 Code Buddy Doctor
…
Summary: 14 passed, 7 warnings, 0 errors
exit 0

$ buddy whoami unexpected
ChatGPT: ✅ connected
…
exit 0

$ buddy improve status unexpected
Autonomy: propose-only
…
exit 0

$ buddy run list --limit not-a-number
No runs found.
exit 0
```

Ce qui devrait se passer : refuser l’argument superflu ou la valeur non numérique, citer l’entrée fautive et montrer la commande d’aide pertinente. Ces quatre cas restent ouverts après la lane d’erreurs ; celle-ci a corrigé d’autres validateurs sans changer ce contrat général de Commander.

### D3 — les options globales ont une position cachée

Test réel, sans `--help`, sur les sept commandes de consultation :

```text
doctor --permission-mode default         exit 1  error: unknown option '--permission-mode'
skills list --permission-mode default    exit 1  error: unknown option '--permission-mode'
skills doctor --permission-mode default  exit 1  error: unknown option '--permission-mode'
whoami --permission-mode default         exit 1  error: unknown option '--permission-mode'
improve status --permission-mode default exit 1  error: unknown option '--permission-mode'
autonomy status --permission-mode default exit 1 error: unknown option '--permission-mode'
run list --permission-mode default       exit 1  error: unknown option '--permission-mode'
```

Les mêmes sept commandes refusent `--quiet` après la sous-commande. Pour `--profile`, le comportement est encore plus déroutant :

```text
$ buddy doctor --profile core
INFO Applied config profile: core
error: unknown option '--profile'
exit 1
```

Ce qui devrait se passer : soit accepter les options globales dans la position naturelle, soit dire explicitement `placez --profile/--quiet/--permission-mode avant la sous-commande`. Le commentaire source explique que le cloisonnement est intentionnel pour empêcher une option racine d’absorber une option locale homonyme. Le lot conserve ce cloisonnement et corrige seulement le message.

Le premier correctif transversal n’était pas complet. Le rejeu du vrai `buddy` après build a reproduit deux défauts supplémentaires avant `0cff11a5` :

```text
$ buddy doctor --permission-mode default
error: unknown option '--permission-mode'

$ buddy skills list --permission-mode default
error: unknown option '--permission-mode'

'--permission-mode' is a global option: place it BEFORE the subcommand.
  buddy --permission-mode <value> list …
```

La sortie finale cite désormais le chemin complet et couvre aussi les commandes utilitaires chargées en groupe :

```text
$ buddy skills list --permission-mode default
error: unknown option '--permission-mode'

'--permission-mode' is a global option: place it BEFORE the subcommand.
  buddy --permission-mode <value> skills list …
Values: default, plan, acceptEdits, dontAsk, bypassPermissions
exit 1
```

Les 102 variantes `buddy <commande> --permission-mode default --help` sont toutes sorties à 0, mais elles ne prouvent rien : Commander traite l’aide avant l’action et masque le rejet réel. Elles ne sont pas comptées comme validation.

### D4 — le profil `core` reste une surface de 91 commandes

```text
$ buddy --help                 → 102 commandes
$ buddy --profile core --help  → 91 commandes
$ buddy --profile all --help   → 102 commandes
```

Ce qui devrait se passer : si `core` est la porte d’entrée destinée au nouveau venu, son aide devrait contenir une surface réellement courte, ou être nommée autrement. Le code ne masque aujourd’hui que onze commandes rattachées à cinq capacités avancées ; ce choix produit est à trancher.

### D5 — `doctor` signalait comme problèmes des choix valides

Sortie initiale exacte :

```text
🔍 Code Buddy Doctor

  ⚠️ sox (voice input): not found
  ⚠️ ICM (infinite context memory): not found
  ⚠️ API key: GROK_API_KEY: not set
  ⚠️ API key: OPENAI_API_KEY: not set
  ⚠️ API key: ANTHROPIC_API_KEY: not set
  ⚠️ API key: GOOGLE_API_KEY: not set
  ⚠️ config.json: not found

  Summary: 14 passed, 7 warnings, 0 errors
```

Dans la même session, `buddy whoami` confirmait pourtant `ChatGPT: connected`. Les clés fournisseur sont des alternatives, pas sept prérequis cumulatifs. De plus, `GEMINI_API_KEY` et `XAI_API_KEY`, documentées par le dépôt, n’étaient pas reconnues par ce résumé. Le correctif conserve les contrôles live des clés présentes, classe l’absence comme facultative, regroupe les alias de variables, qualifie `config.json` de legacy et explique l’impact des dépendances optionnelles.

### D6 — `skills doctor` donnait une instruction réservée à l’agent

Sorties initiales exactes :

```text
$ buddy skills list
Installed skills (4 enabled / 4 total):
  ! research-cli-reviewed-workflow v0.1.0 (local)  missing SKILL.md
  ! learned-real-review v1.0.0 (local)  missing SKILL.md
  + pdfcommander v0.0.0 (local)
  + browser-automation v0.0.0 (local)

Health: 2 ok / 2 issue(s). Run buddy skills doctor --json.
```

```text
$ buddy skills doctor
Skill package doctor: 2 issue(s) across 4 installed package(s).
  2 missing entries point inside the OS temp directory.
  ! research-cli-reviewed-workflow v0.1.0: missing-file
      next: This lockfile entry points inside the OS temp directory and SKILL.md is gone; delete the stale entry after reviewer approval unless you intentionally want to reconstruct it.
      command: skill_manage action=delete name=research-cli-reviewed-workflow approved_by=<reviewer>
  ! learned-real-review v1.0.0: missing-file
      next: This lockfile entry points inside the OS temp directory and SKILL.md is gone; delete the stale entry after reviewer approval unless you intentionally want to reconstruct it.
      command: skill_manage action=delete name=learned-real-review approved_by=<reviewer>
```

Ce qui devrait se passer : distinguer « activé » de « utilisable », garder le JSON pour l’automatisation et donner à l’humain une vraie commande `buddy skills …`. Le code calculait déjà `preferredCommand` mais ne l’affichait pas.

### D7 — quatre aides et l’application d’un profil parlaient de l’implémentation

```text
$ buddy mcp --help
[2026-08-25T16:14:30.235Z] INFO [self-improve] reloaded 5 authored tool(s): …
Usage: buddy mcp [options] [command]
…

$ buddy --quiet --profile core doctor
[2026-08-25T16:19:35.539Z] INFO Applied config profile: core {"source":"ConfigManager"}
🔍 Code Buddy Doctor
…
```

`--quiet` ne pouvait pas aider : ces événements étaient émis avant l’action Commander qui applique le niveau de log. Ils sont désormais en `DEBUG`. Un test de processus réel charge un outil persisté factice en `NODE_ENV=development` afin que la régression ne soit pas cachée par le silence automatique des tests.

### D8 à D11 — incohérences laissées ouvertes

- `improve status` devrait dire au minimum `Improvement autonomy` ou `Self-improvement mode`, pour ne pas être confondu avec `buddy autonomy`.
- Une politique de langue doit être choisie. Traduire trois commandes isolées de plus ne rendrait pas cohérente une surface de 102 commandes.
- Les doubles défauts de `--max-tool-rounds`, `research --rounds` et `research --worker-timeout-ms` viennent d’une valeur écrite dans la description puis ajoutée automatiquement par Commander. Ils sont cosmétiques et n’ont pas été corrigés.
- Il faut décider si `skills doctor` est une consultation qui sort toujours à 0 ou un health-check qui sort non-zéro lorsque `ok=false`.

## Corrigé dans ce lot

| Commit | Correction | Test qui verrouille le comportement |
|---|---|---|
| `4854f96a` | Les rechargements d’outils persistés et l’application d’un profil passent de `INFO` à `DEBUG`. | `tests/cli/help-output.test.ts` : 5/5, dont processus réel avec magasin persisté sous le dépôt. |
| `7a85ff8c` | `doctor` ne transforme plus l’absence de quatre moyens d’authentification facultatifs ni d’un fichier legacy en panne ; alias XAI/Gemini reconnus, dépendances optionnelles expliquées. | `tests/doctor/doctor.test.ts` : 8/8. |
| `4de83f89` | `skills list` affiche le nombre utilisable et `skills doctor` propose des commandes CLI humaines sans forcer `--json`. | `RUN_REAL_TESTS=1 … tests/commands/skills-command-real.test.ts` : 13/13. |
| `b2865cbf`, puis `0cff11a5` | Une option globale mal placée explique sa position ; le complément conserve le chemin imbriqué complet et couvre les commandes utilitaires comme `doctor`. | `tests/cli/unknown-option-hint.test.ts` + `tests/cli/cli-error-messages.test.ts` : 14/14. |
| environnement local, sans commit | `npm run build` a réaligné `dist/` sur le HEAD avant la suite des smokes. | Le validateur `buddy loop … --permission-mode valeur-invalide` donne ensuite la liste des valeurs. |

Les autres correctifs de la lane d’erreurs sur la même branche sont détaillés dans [`DEFAUTS-ERREURS-2026-08-25.md`](DEFAUTS-ERREURS-2026-08-25.md) : backup (`2ab5a3b1`), valeurs loop/goal (`fa653429`), entiers research (`80216860`) et vue intent (`8f9aac27`).

## À trancher

1. **Portée des options globales.** La position stricte protège les options locales homonymes. Le message est désormais actionnable ; accepter réellement les options partout toucherait la surface de permissions et reste un choix distinct.
2. **Contrat des erreurs.** Les quatre faux succès de D2 restent ouverts. La lane d’erreurs a corrigé d’autres validateurs, détaillés dans son rapport, sans imposer globalement `.allowExcessArguments(false)` ni un parseur numérique commun.
3. **Politique de construction du lanceur de développement.** Le script stable devrait-il reconstruire, vérifier un manifeste source/dist, ou seulement avertir qu’il est périmé ? Une reconstruction implicite à chaque commande serait trop coûteuse ; aucun choix n’a été imposé.
4. **Surface `core`.** 91 commandes ne constituent pas une aide d’accueil courte. Le choix des commandes à masquer est un choix produit.
5. **Vocabulaire et langue.** `Autonomy` recouvre deux concepts et français/anglais alternent sans réglage de locale.
6. **Code de sortie de `skills doctor`.** Garder 0 privilégie la consultation humaine ; retourner 1 quand `ok=false` privilégie CI et scripts.

## Ce qui n’a pas été testé

- CB1 n’a exécuté aucun appel LLM, council, recherche distante, génération média, publication, push, tunnel, serveur, login/logout, modification de compte ou commande `--fix`/réparation.
- Les 102 aides **de premier niveau** ont été exécutées. Les centaines d’aides imbriquées ne l’ont pas toutes été ; seules celles nécessaires aux consultations demandées (`skills list/doctor`, `improve status`, `autonomy status`, `run list`) sont incluses intégralement ci-dessous.
- La position des options globales en exécution réelle a été testée sur les sept consultations sûres. Pour les autres commandes, elle est **suspectée, non reproduite** : les lancer sans `--help` aurait pu payer, publier, modifier un compte ou démarrer un service.
- `buddy loop objectif --permission-mode acceptEdits` n’a pas été relancé après reconstruction, car il appelle un LLM. La variante invalide a prouvé le câblage sans démarrer la boucle.
- L’adresse affichée par `whoami` est remplacée par `<redacted-email>` dans ce rapport public.

## Vérifications finales

- `npx tsc --noEmit -p tsconfig.json` : exit 0 avant toute modification, puis exit 0 sur l’état final.
- `npm run build` : exit 0 ; le lanceur `buddy` a été rejoué après cette reconstruction.
- `npx eslint <27 fichiers TypeScript touchés>` : 0 erreur, 9 avertissements de dette déjà présents (`any`/imports inutilisés).
- Vitest ciblé des fichiers touchés et du contrat research voisin : 13 fichiers, 97/97 tests verts.
- `RUN_REAL_TESTS=1 npx vitest run tests/commands/skills-command-real.test.ts` : 13/13 tests verts.
- Smokes réels : 102 aides de premier niveau exit 0 lors de l’inventaire ; après le build final, sept consultations exit 0, les aides ciblées D7 restent sans télémétrie et les conseils d’options `doctor`, `skills list`, `improve status`, `--profile` et `--quiet` sortent à 1 avec une commande corrective complète.
- La suite complète d’environ 27 000 tests n’a pas été lancée, conformément à la mission.

## Sorties des consultations demandées

Rejeu final du vrai lanceur après le dernier `npm run build`. Toutes les commandes sont sorties avec le code 0. Seule l’adresse de compte est masquée.

### `buddy doctor`

```text
🔍 Code Buddy Doctor

  ⚠️ sox (voice input): not found — optional; install SoX only to use voice input
  ⚠️ ICM (infinite context memory): not found — optional; install ICM only to use infinite-context memory

  Summary: 19 passed, 2 warnings, 0 errors
```

### `buddy skills list`

```text
Installed skills (2 usable / 4 enabled / 4 total):
  ! research-cli-reviewed-workflow v0.1.0 (local)  missing SKILL.md
  ! learned-real-review v1.0.0 (local)  missing SKILL.md
  + pdfcommander v0.0.0 (local)
  + browser-automation v0.0.0 (local)

Health: 2 ok / 2 issue(s). Run buddy skills doctor.
```

### `buddy skills doctor`

```text
Skill package doctor: 2 issue(s) across 4 installed package(s).
  2 missing entries point inside the OS temp directory.
  ! research-cli-reviewed-workflow v0.1.0: missing-file
      path: /tmp/tools-skill-candidate-install-rw9FK3/.codebuddy/skills/research-cli-reviewed-workflow/SKILL.md
      next: This lockfile entry points inside the OS temp directory and SKILL.md is gone; delete the stale entry after reviewer approval unless you intentionally want to reconstruct it.
      command: buddy skills doctor --repair-stale-temp --approved-by <reviewer>
  ! learned-real-review v1.0.0: missing-file
      path: /tmp/tools-learning-skill-candidate-aGE4hv/.codebuddy/skills/learned-real-review/SKILL.md
      next: This lockfile entry points inside the OS temp directory and SKILL.md is gone; delete the stale entry after reviewer approval unless you intentionally want to reconstruct it.
      command: buddy skills doctor --repair-stale-temp --approved-by <reviewer>
```

### `buddy whoami`

```text
ChatGPT: ✅ connected
  Account:    <redacted-email>
  Plan:       pro
  Model:      gpt-5.6-sol
```

### `buddy improve status`

```text
Autonomy: propose-only
Capability coverage: 3/3 (100%)
Uncovered: (none)
Archive: 73 validated improvement(s), total Δ=71
Store: 4 version(s); head 3/3, best 3/3 (5f07d4d0)
```

### `buddy autonomy status`

```text
Fleet store: /home/patrice/code-buddy/.codebuddy
Tasks: 0 (none)
Next auto-claimable: none (or all critical)
Blocked by deps: 0
Agents: none
```

### `buddy run list`

```text
Recent runs (20)

  [DONE] run_mt8cczgh_e56f5a  2026-08-25 07:26:28  (72ms)  Fix the README formatting
  [DONE] run_mt8ccza4_c2d2fb  2026-08-25 07:26:28  (176ms)  Fix the README formatting
  [FAIL] run_mt8ccz0w_6e25c3  2026-08-25 07:26:27  (266ms)  Fix the README formatting
  [FAIL] run_mt8ccxzl_5bc6d0  2026-08-25 07:26:26  (1.3s)  Fix the README formatting
  [FAIL] run_mt8ccxyx_0a6302  2026-08-25 07:26:26  (1.6s)  Improve the README safely
  [DONE] run_mt8cbfne_93633e  2026-08-25 07:25:16  (137ms)  Fix the README formatting
  [DONE] run_mt8cbfhz_c7c795  2026-08-25 07:25:15  (128ms)  Fix the README formatting
  [FAIL] run_mt8cbf5w_ec4c2c  2026-08-25 07:25:15  (360ms)  Fix the README formatting
  [FAIL] run_mt8cbe5k_88a708  2026-08-25 07:25:14  (1.2s)  Fix the README formatting
  [FAIL] run_mt8cbe3z_ffa9ac  2026-08-25 07:25:14  (1.7s)  Improve the README safely
  [DONE] run_mt8562ed_81e186  2026-08-25 04:05:08  (128ms)  Fix the README formatting
  [FAIL] run_mt8562b3_c272ae  2026-08-25 04:05:08  (909ms)  Improve the README safely
  [DONE] run_mt8562a5_402fb1  2026-08-25 04:05:08  (81ms)  Fix the README formatting
  [FAIL] run_mt85621g_54a294  2026-08-25 04:05:07  (263ms)  Fix the README formatting
  [FAIL] run_mt8561dk_19f139  2026-08-25 04:05:07  (785ms)  Improve the README safely
  [DONE] run_mt636mxf_202e6e  2026-08-23 17:34:03  (14ms)  interactive session
  [DONE] run_mt6323y0_bf8238  2026-08-23 17:30:32  (10ms)  interactive session
  [DONE] run_mt63235k_499294  2026-08-23 17:30:31  (11ms)  interactive session
  [DONE] run_mt6322in_2aa687  2026-08-23 17:30:30  (22ms)  interactive session
  [DONE] run_mt6321vx_ab979c  2026-08-23 17:30:29  (13ms)  interactive session
```

### Aides imbriquées des consultations

```text
$ buddy skills list --help
Usage: buddy skills list [options]

List installed skill packages

Options:
  --all       include disabled skills (default: enabled only)
  --json      output JSON
  -h, --help  display help for command
exit 0

$ buddy skills doctor --help
Usage: buddy skills doctor [options]

Audit installed skill packages for missing or modified SKILL.md files

Options:
  --repair-missing          remove missing-file lockfile entries after explicit
                            reviewer approval
  --repair-stale-temp       remove only missing skill entries that point inside
                            the OS temp directory
  --approved-by <reviewer>  reviewer/operator approving repair actions
  --json                    output JSON
  -h, --help                display help for command
exit 0

$ buddy improve status --help
Usage: buddy improve status [options]

Show capability-benchmark coverage, autonomy mode, archive, and git store
versions

Options:
  --json      output JSON
  -h, --help  display help for command
exit 0

$ buddy autonomy status --help
Usage: buddy autonomy status [options]

Show the fleet task queue + presence

Options:
  --dir <path>  colab dir
  --json        output JSON
  -h, --help    display help for command
exit 0

$ buddy run list --help
Usage: buddy run list [options]

List recent runs

Options:
  -n, --limit <n>  number of runs to show (default: "20")
  -h, --help       display help for command
exit 0
```

## Aides de premier niveau exécutées

Chaque bloc ci-dessous provient d’un processus réel `buddy <commande> --help`, exit 0, après la reconstruction de baseline et avant les corrections de verbosité. Les timestamps de D7 sont donc conservés comme preuve du défaut initial.

<details>
<summary><code>buddy --help</code> — exit 0</summary>

```text
Pour commencer — 6 démos qui montrent le cœur agent de code :
  1. buddy try
     Crée FizzBuzz, écrit son test et l’exécute dans un bac à sable.
  2. /loop "Corrige les tests en échec"              (dans une session buddy)
  3. buddy research "Cartographie ce dépôt"
  4. buddy dev pr "Ajoute une petite fonctionnalité"
  5. /think deep "Propose le refactoring le plus sûr" (dans une session buddy)
  6. /share create demo                              (dans une session buddy)


Usage: buddy [options] [command] [message...]

A conversational AI CLI tool powered by AI with text editor capabilities

Arguments:
  message                                  Initial message to send to Code Buddy

Options:
  -V, --version                            output the version number
  -d, --directory <dir>                    set working directory (default: "/home/patrice/code-buddy")
  -k, --api-key <key>                      CodeBuddy API key (or set GROK_API_KEY env var)
  -u, --base-url <url>                     CodeBuddy API base URL (or set GROK_BASE_URL env var)
  -m, --model <model>                      AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)
  -p, --prompt <prompt>                    process a single prompt and exit (headless mode, alias: --print)
  --print <prompt>                         alias for --prompt: process a single prompt and exit (headless mode)
  -b, --browser                            launch browser UI instead of terminal interface
  --max-tool-rounds <rounds>               maximum number of tool execution rounds (default: 400) (default: "400")
  -s, --security-mode <mode>               security mode: suggest (default), auto-edit, or full-auto
  -o, --output-format <format>             output format for headless mode: json, stream-json, text, markdown
  --init                                   initialize .codebuddy directory with templates and exit
  --dry-run                                preview changes without applying them (simulation mode)
  -c, --context <patterns>                 load specific files into context using glob patterns (e.g., 'src/**/*.ts,!**/*.test.ts')
  --no-cache                               disable response caching
  --no-self-heal                           disable self-healing auto-correction
  --force-tools                            enable tools/function calling for local models (LM Studio)
  --probe-tools                            auto-detect tool support by testing the model at startup
  --plain                                  use plain text output (minimal formatting)
  --no-color                               disable colored output
  --no-emoji                               disable emoji in output
  --list-models                            list available models from the API endpoint and exit
  --continue                               continue from the most recent saved session (like mistral-vibe)
  --resume <sessionId>                     resume a specific session by ID (supports partial matching)
  --search-sessions <query>                search saved sessions by content
  --max-price <dollars>                    maximum cost in dollars before stopping (like mistral-vibe) (default: "10.0")
  --auto-approve                           automatically approve all tool executions (like mistral-vibe)
  --system-prompt <id>                     system prompt to use: default, minimal, secure, code-reviewer, architect (or custom from ~/.codebuddy/prompts/)
  --list-prompts                           list available system prompts and exit
  --agent <name>                           use a custom agent configuration from ~/.codebuddy/agents/ (like mistral-vibe)
  --list-agents                            list available custom agents and exit
  --enabled-tools <patterns>               only enable tools matching patterns (comma-separated, supports glob: bash,*file*,search)
  --disabled-tools <patterns>              disable tools matching patterns (comma-separated, supports glob: bash,web_*)
  --setup                                  run interactive setup wizard for API key and configuration
  --vim                                    enable Vim keybindings for input
  --permission-mode <mode>                 permission mode: default, plan, acceptEdits, dontAsk, bypassPermissions
  --dangerously-skip-permissions           bypass all permission checks (use in trusted containers without network access)
  --allowed-tools <patterns>               only enable tools matching patterns (natively --allowedTools)
  --disallowed-tools <patterns>            block tools matching patterns (natively --disallowedTools)
  --mcp-debug                              enable MCP debugging output
  --allow-outside                          allow file operations outside the workspace directory (disables workspace isolation)
  --output-schema <path>                   validate headless mode JSON output against a JSON Schema file
  --add-dir <paths...>                     grant additional writable directories (repeatable)
  --no-alt-screen                          disable alternate screen buffer for Ink UI
  --ephemeral                              skip session persistence (do not save session to disk)
  --system-prompt-override <text>          replace the entire system prompt with this text
  --system-prompt-file <path>              replace the entire system prompt with contents of a file
  --append-system-prompt <text>            append text to the default system prompt
  --append-system-prompt-file <path>       append file contents to the default system prompt
  --fallback-model <model>                 auto-fallback model when default is overloaded
  --profile <name>                         apply a built-in or configured profile (core, all, or [profiles.<name>])
  --from-pr <pr>                           link session to a GitHub pull request (number or URL)
  --yolo                                   enable YOLO mode (full autonomy with guardrails, $100 cost cap)
  --quiet                                  suppress informational logs (only show errors and responses)
  --verbose                                enable verbose/debug output
  --speak                                  enable automatic speech synthesis of agent responses using Text-to-Speech
  --tts-provider <provider>                TTS provider (edge-tts, espeak, say, piper, audioreader)
  -h, --help                               display help for command

Commands:
  git                                      Git operations with AI assistance
  try                                      Run an isolated 60-second coding-agent demo (ChatGPT OAuth or local Ollama)
  import                                   Import project rules and MCP servers from Cursor, Cline, Copilot, or Claude Code
  explain                                  Explain an unfamiliar repository in one Markdown or self-contained HTML artifact
  changelog                                Generate grouped release notes from Conventional Commits
  ws                                       Manage and search the opt-in multi-repository workspace
  provider                                 Manage AI providers (Claude, ChatGPT, Grok, Gemini)
  mcp                                      Manage MCP servers or expose Code Buddy with `buddy mcp serve`
  campaign                                 Native editorial, book-promotion and PubCommander campaign workspace
  influencer                               Influencer & book-trailer media pipeline (scripts/influencer)
  maison                                   Household rhythm, holidays, quiet modes and private meal safety
  pipeline                                 Manage and run pipeline workflows
  channels [options] [action]              Manage channel connections (Telegram, Discord, Slack, etc.)
  server [options]                         Start the Code Buddy HTTP/WebSocket API server
  voice [options]                          Push-to-talk voice commands — speak an instruction, the agent acts, the reply is spoken
  remind [options] [action] [args...]      Reminders — the robot reminds you (meds…) and you flag them done (add|list|agenda|done|rm)
  rules [options] [action] [args...]       Administer sensory rules (event→action) — list|enable|disable|rm|runs|validate|add
  gui [options]                            Launch the Code Buddy desktop GUI (Electron)
  desktop [options]                        Alias for 'buddy gui'
  install-gui                              Install Electron and build the desktop GUI
  login [options] [provider]               Authenticate with a provider (chatgpt | xai — uses your subscription, no API key)
  logout [provider]                        Clear stored credentials for a provider (chatgpt | xai)
  whoami                                   Show current authentication status (email, plan, OAuth model)
  llm [options] [action] [prompt...]       List active LLMs, or run several together: llm ensemble|consensus|race <prompt>
  council [options] [task...]              Ask a capability-routed AI council with conductor roles, judge + reconcile the answers, and learn winners per task type
  mcp-server [options]                     Legacy alias for `buddy mcp serve`
  daemon                                   Manage the Code Buddy daemon (background process)
  trigger                                  Manage event triggers for automated agent responses
  speak                                    Synthesize speech using AudioReader TTS
  assistant                                Manage the voice assistant (Lisa): improvement loop, voice
  widgets                                  Inline conversation widgets: list, preview, generate (authored)
  doctor                                   Diagnose Code Buddy environment, dependencies, and configuration
  security-audit                           Run a security audit of your Code Buddy environment
  onboard                                  Interactive setup wizard for Code Buddy
  webhook                                  Manage webhook triggers
  ollama                                   Inspect or update the local Ollama runtime
  heartbeat                                Manage the heartbeat engine (periodic agent wake)
  hub                                      Skills marketplace (search, install, publish)
  curator                                  Propose-only maintenance report (memory, skills, CKG, lessons, costs)
  gateway-pairing                          Operator approval for gateway device pairing
  screen                                   Capture, record, or watch the screen / a window (real-time machine context)
  autonomy|colab                           Autonomous fleet loop (claim + run colab tasks on local-first models)
  device                                   Manage paired device nodes (SSH, ADB, local)
  identity                                 Manage agent identity files (SOUL.md, USER.md, etc.)
  companion                                Configure Buddy as a ChatGPT-backed voice companion
  groups                                   Manage group chat security
  auth-profile                             Manage authentication profiles (API key rotation)
  fleet                                    Inspect Fleet routing and dispatch policy decisions
  code-explorer                            Interact with CodeExplorer for code understanding and session syncing
  hermes                                   Inspect the native Hermes-inspired Code Buddy agent profile
  acp                                      Run Code Buddy as an ACP (Agent Client Protocol) agent over stdio for editor integration
  tools                                    Inspect tool profiles and effective tool availability
  autonomous-code                          Run a guarded Agentic Coding Cell task contract
  session                                  Manage saved sessions
  config                                   Show environment variable configuration and validation
  dev                                      Golden-path developer workflows (plan, run, pr, fix-ci, explain)
  run                                      Inspect and replay agent runs (observability)
  cron                                     Author and manage scheduled cron jobs
  skills                                   Browse and manage installed skill packages
  pairing                                  Manage DM pairing security (allowlist for messaging channel senders)
  shadow                                   Inspect or run speculative validation in the persistent shadow worktree
  knowledge                                Manage agent knowledge bases (Knowledge.md files injected as context)
  research                                 Wide Research: spawn parallel agent workers to research a topic (Manus AI-inspired)
  meeting                                  Create grounded meeting notes from a local transcript, audio, or video file
  scrape                                   Scrape a web page locally with Scrapling (with web_fetch fallback)
  papers                                   Paper QA: ask a question over a corpus of scientific PDFs and get a grounded, cited answer
  science                                  AI-Scientist-lite (EXPERIMENTAL, opt-in CODEBUDDY_AI_SCIENTIST=true): human-gated, sandboxed experiment — single pass or bounded best-first discovery loop (--loop)
  gpu-worker                               Run the authenticated PanoWorld/LongCat GPU job worker
  vision-train                             Synthetic perception-training loop (EXPERIMENTAL, opt-in CODEBUDDY_VISION_TRAIN=true): score the robot vision (YOLO) on labeled generated/real scenes → a weakness benchmark
  lora                                     Krea 2 LoRA pipeline: init dataset, train cloud (fal, opt-in CODEBUDDY_LORA_TRAIN=true) or local plan, install into ComfyUI
  flow                                     Execute a multi-agent planning flow (OpenManus-compatible): plan → execute → synthesize
  film                                     Produce a long-form film from a scene plan: generate a clip per scene → montage with transitions + music → quality gate (resumable). Subcommands: generate|assemble|status
  goal                                     Run the agent toward a standing goal until a judge model confirms it is done (Ralph loop)
  loop                                     Boucle de dev autonome (plan→exécute→vérifie→juge→décide) jusqu'à fait prouvé ou budget
  intent                                   Inspect the current Intent Graph and secret-redacted Proof Ledger
  intents                                  Manage replayable intent specifications (EXPERIMENTAL, opt-in CODEBUDDY_INTENTS=true)
  replay                                   Inspect, restore, or fork a time-travel session timeline
  share                                    Export a saved session as a self-contained, shareable HTML replay
  cost                                     Aggregate saved-session cost and token usage by model, provider, or day
  forge                                    Counterfactual Forge: compare competing strategies against one proof contract
  exchange                                 Sovereign execution market: constitution, multi-LLM bids, Shadow Twin and proof-gated award
  capsule                                  Compile proven outcomes into proof-backed, multi-runtime portable workflows
  todo                                     Manage persistent task list (todo.md) — injected at end of every agent turn for focus
  execpolicy                               Manage execution policy rules (allow/deny/ask/sandbox) for shell commands
  lessons                                  Manage lessons learned — self-improvement loop for recurring patterns (injected every turn)
  spec                                     Spec-driven, review-gated work pipeline (durable stories; approve before implementing)
  user-model                               Manage the local user model — working preferences, propose/review (no silent write)
  update                                   Update Code Buddy (switch channels: stable, beta, dev)
  tunnel                                   Manage ngrok tunnels for the Code Buddy remote gateway
  nodes                                    Manage companion app nodes (macOS, iOS, Android)
  secrets                                  Manage API keys and credentials (encrypted vault)
  approvals                                Manage tool/action approval requests
  insights                                 Token, cost, and activity analytics (read-only)
  bundles                                  Group skills under a single named slash-command bundle
  improve                                  Recursive self-improvement: empirically validate and apply reversible learning improvements
  evolve                                   Git-versioned evolutionary self-improvement: evaluate code variants, keep the best (human-gated)
  lsp                                      Language Server Protocol diagnostics
  proxy                                    Start an OpenAI-compatible HTTP proxy in front of Code Buddy (for third-party clients)
  deploy                                   Generate cloud deployment configurations (Fly, Railway, Render, Nix)
  backup [options] [subcommand] [args...]  Manage .codebuddy/ backups (create, verify, list, restore)
  cloud [subcommand] [args...]             Manage cloud background agent tasks (submit, status, list, cancel, logs)
  completions                              Generate or install shell completion scripts (bash, zsh, fish, powershell)
```

</details>


<details>
<summary><code>buddy git --help</code> — exit 0</summary>

```text
Usage: buddy git [options] [command]

Git operations with AI assistance

Options:
  -h, --help                 display help for command

Commands:
  commit-and-push [options]  Generate AI commit message and push to remote
  help [command]             display help for command
```

</details>

<details>
<summary><code>buddy try --help</code> — exit 0</summary>

```text
Usage: buddy try [options]

Run an isolated 60-second coding-agent demo (ChatGPT OAuth or local Ollama)

Options:
  --verbose   Afficher la télémétrie de l'agent pendant la démo
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy import --help</code> — exit 0</summary>

```text
Usage: buddy import [options]

Importer les règles et serveurs MCP d’agents concurrents sans écraser
l’existant

Options:
  --dry-run        Lister les imports sans écrire de fichier (default: false)
  --from <chemin>  Dossier source situé dans le projet courant (default: ".")
  -h, --help       display help for command
```

</details>

<details>
<summary><code>buddy explain --help</code> — exit 0</summary>

```text
Usage: buddy explain [options] [chemin]

Comprendre un dépôt inconnu dans un artefact Markdown ou HTML autonome

Arguments:
  chemin                    Dossier du dépôt à analyser (default: ".")

Options:
  --out <fichier.md|.html>  Fichier de sortie (Markdown par défaut)
  --depth <quick|deep>      Profondeur de collecte (default: "quick")
  --html                    Produire un HTML autonome zéro CDN (default: false)
  -h, --help                display help for command
```

</details>

<details>
<summary><code>buddy changelog --help</code> — exit 0</summary>

```text
Usage: buddy changelog [options]

Générer des release notes depuis les Conventional Commits

Options:
  --since <tag|YYYY-MM-DD|ref>  Début exclu de la plage, ou date YYYY-MM-DD
  --to <ref>                    Fin incluse de la plage Git (default: "HEAD")
  --out <CHANGELOG.md>          Préfixer les release notes dans ce fichier
                                Markdown
  --json                        Émettre la structure groupée en JSON sur stdout
                                (default: false)
  -h, --help                    display help for command
```

</details>

<details>
<summary><code>buddy ws --help</code> — exit 0</summary>

```text
Usage: buddy ws [options] [command]

Manage and search the opt-in multi-repository workspace

Options:
  -h, --help                display help for command

Commands:
  list|ls                   List configured repositories and their validity
  add <name> <path>         Add a git repository to the resolved workspace.json
  rm|remove <name>          Remove a repository from the resolved
                            workspace.json
  search [options] <query>  Search the enabled multi-repository workspace
  help [command]            display help for command
```

</details>

<details>
<summary><code>buddy provider --help</code> — exit 0</summary>

```text
Usage: buddy provider [options] [command]

Manage AI providers

Options:
  -h, --help                    display help for command

Commands:
  list|ls                       List available AI providers
  current|show                  Show current active provider
  set|use [options] <provider>  Set the active AI provider
  models [provider]             List available models for a provider
  inventory [options]           Show runtime-discovered models across local and
                                network machines
  model <model>                 Set the AI model to use
  help [command]                display help for command
```

</details>

<details>
<summary><code>buddy mcp --help</code> — exit 0</summary>

```text
Usage: buddy mcp [options] [command]

Manage MCP servers or expose Code Buddy over MCP

Options:
  -h, --help              display help for command

Commands:
  serve [options]         Expose Code Buddy tools as an MCP server over stdio
  enable <name>           Enable a configured MCP server
  disable <name>          Disable a configured MCP server
  profile                 Manage mission-specific MCP server sets
  add [options] <name>    Add an MCP server
  add-json <name> <json>  Add an MCP server from JSON configuration
  remove <name>           Remove an MCP server
  list                    List configured MCP servers
  audit [options] [name]  Measure MCP prompt footprint by server and tool
  test <name>             Test connection to an MCP server
  help [command]          display help for command
[2026-08-25T16:29:50.627Z]  INFO  [self-improve] reloaded 5 authored tool(s): authored__slugify_text, authored__count_words, authored__reverse, authored__slugify, authored__greet
```

</details>

<details>
<summary><code>buddy campaign --help</code> — exit 0</summary>

```text
Usage: buddy campaign [options] [command]

Native editorial, book-promotion and PubCommander campaign workspace

Options:
  -h, --help                          display help for command

Commands:
  status [options]                    Show every configured PubCommander
                                      capability module
  overview [options]                  Aggregate the editorial queue, assets,
                                      blogs, performance and automations
  library [options] <kind>            Browse templates, styles, pillars or
                                      viral references
  transcribe [options] <youtube-url>  Extract a YouTube transcript for research
                                      or book-promotion inspiration
  draft [options]                     Create a guarded PubCommander draft
                                      directly from Code Buddy
  submit <post-id>                    Send a draft to human approval; never
                                      self-approves or publishes
  analytics [options]                 Inspect real stored publication
                                      performance
  help [command]                      display help for command
[2026-08-25T16:29:50.804Z]  INFO  [self-improve] reloaded 5 authored tool(s): authored__slugify_text, authored__count_words, authored__reverse, authored__slugify, authored__greet
```

</details>

<details>
<summary><code>buddy influencer --help</code> — exit 0</summary>

```text
Usage: buddy influencer [options] [command]

Influencer & book-trailer media pipeline (scripts/influencer)

Options:
  -h, --help           display help for command

Commands:
  list                 List influencer Python scripts
  short <subjects...>  Generate influencer shorts for one or more subjects
  broll                Generate the B-roll batch
  clips                Generate the Lisa clip batch
  readme               Show the influencer pipeline README
  help [command]       display help for command
```

</details>


<details>
<summary><code>buddy maison --help</code> — exit 0</summary>

```text
Usage: buddy maison [options] [command]

Household rhythm, public holidays, presence posture and quiet modes

Options:
  -h, --help                 display help for command

Commands:
  status [options]           Show the factual Maison context without assuming
                             that a free day means presence
  mode [options] <mode>      Set an explicit household posture
  silence [options]          Stop non-essential spontaneous contact immediately
  resume                     Return to normal household rhythm
  holidays [options] [year]  Show official French public holidays and their
                             provenance
  timer                      Persistent named cooking timers that survive a
                             restart
  food                       Private food constraints, deterministic recipe
                             checks, plans and inventory
  help [command]             display help for command
```

</details>

<details>
<summary><code>buddy pipeline --help</code> — exit 0</summary>

```text
Usage: buddy pipeline [options] [command]

Manage and run pipeline workflows

Options:
  -h, --help            display help for command

Commands:
  run [options] <file>  Run a pipeline from a YAML/JSON file
  list|ls [options]     List available pipeline definitions
  validate <file>       Validate a pipeline definition file
  status                Show status of pipeline system and available transforms
  help [command]        display help for command
```

</details>

<details>
<summary><code>buddy channels --help</code> — exit 0</summary>

```text
Usage: buddy channels [options] [action]

Manage channel connections (Telegram, Discord, Slack, etc.)

Arguments:
  action             start|stop|status|list (default: "list")

Options:
  --type <type>      Channel type
                     (telegram|discord|slack|whatsapp|signal|google-chat|teams|matrix|webchat)
  --instance <name>  Named channel instance, or default for an unnamed entry
  --config <path>    Channel config file path
  --json             Output JSON for status
  -h, --help         display help for command
```

</details>

<details>
<summary><code>buddy server --help</code> — exit 0</summary>

```text
Usage: buddy server [options]

Start the Code Buddy HTTP/WebSocket API server

Options:
  --port <port>  server port (default: "3000")
  --host <host>  server host (default: "0.0.0.0")
  --no-auth      disable JWT authentication (loopback development only)
  -h, --help     display help for command
```

</details>

<details>
<summary><code>buddy voice --help</code> — exit 0</summary>

```text
Usage: buddy voice [options]

Push-to-talk voice commands — speak an instruction, the agent acts, the reply
is spoken

Options:
  --mode <mode>  voice ACT posture: default (guarded workspace, default) | plan
                 (read-only) | acceptEdits | dontAsk | bypassPermissions
                 (default: "default")
  -h, --help     display help for command
```

</details>

<details>
<summary><code>buddy remind --help</code> — exit 0</summary>

```text
Usage: buddy remind [options] [action] [args...]

Reminders — the robot reminds you (meds…) and you flag them done
(add|list|agenda|done|rm)

Options:
  --at <time>       time of day HH:MM (for `add`)
  --date <date>     one-shot date YYYY-MM-DD — fires once then retires (not
                    recurring)
  --days <csv>      days of week 0=Sun..6=Sat, e.g. 1,3,5 (default: every day)
  --ahead <n>       agenda: how many days ahead to list (default 7)
  --daily           every day (default when --days omitted)
  --message <text>  custom spoken/sent text
  -h, --help        display help for command
```

</details>

<details>
<summary><code>buddy rules --help</code> — exit 0</summary>

```text
Usage: buddy rules [options] [action] [args...]

Administer sensory rules (event→action) —
list|enable|disable|rm|runs|validate|add

Options:
  --json <rule>       rule JSON (for `add`)
  --from-file <path>  read rule JSON from a file (for `add`)
  --limit <n>         max rows (for `runs`) (default: "20")
  -h, --help          display help for command
```

</details>

<details>
<summary><code>buddy gui --help</code> — exit 0</summary>

```text
Usage: buddy gui [options]

Launch the Code Buddy desktop GUI (Electron)

Options:
  --dev       start with Vite dev server (hot reload)
  --detach    run in background
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy desktop --help</code> — exit 0</summary>

```text
Usage: buddy desktop [options]

Alias for 'buddy gui'

Options:
  --dev       start with Vite dev server
  --detach    run in background
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy install-gui --help</code> — exit 0</summary>

```text
Usage: buddy install-gui [options]

Install Electron and build the desktop GUI

Options:
  -h, --help  display help for command
```

</details>


<details>
<summary><code>buddy login --help</code> — exit 0</summary>

```text
Usage: buddy login [options] [provider]

Authenticate with a provider (chatgpt | xai — uses your subscription, no API
key)

Options:
  --code <code>  Complete an xAI login with the code shown in the browser
  -h, --help     display help for command
```

</details>

<details>
<summary><code>buddy logout --help</code> — exit 0</summary>

```text
Usage: buddy logout [options] [provider]

Clear stored credentials for a provider (chatgpt | xai)

Options:
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy whoami --help</code> — exit 0</summary>

```text
Usage: buddy whoami [options]

Show current authentication status (email, plan, OAuth model)

Options:
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy llm --help</code> — exit 0</summary>

```text
Usage: buddy llm [options] [action] [prompt...]

List active LLMs, or run several together: llm ensemble|consensus|race <prompt>

Options:
  --order <policy>  Ordering: resilience | free-first | manual
  -h, --help        display help for command
```

</details>

<details>
<summary><code>buddy council --help</code> — exit 0</summary>

```text
Usage: buddy council [options] [task...]

Ask a capability-routed AI council with conductor roles, judge + reconcile the
answers, and learn winners per task type

Options:
  -n, --count <n>    How many models to consult (default 3)
  --models <list>    Restrict to these providers/models (comma list)
  --judge <model>    Provider/model to use as the impartial judge
  --task-type <tag>  Override inferred task type
                     (code|reasoning|french|vision|general)
  --no-consensus     Skip the consensus/agreement summary
  --scoreboard       Print the learned model ranking and exit
  --fleet            Also consult connected fleet peers (other machines' Code
                     Buddy) over the network
  --no-conductor     Disable adaptive council roles and ask every model the
                     exact same prompt
  --no-synthesis     Disable the final collective synthesis pass
  -h, --help         display help for command
```

</details>

<details>
<summary><code>buddy mcp-server --help</code> — exit 0</summary>

```text
Usage: buddy mcp-server [options]

Legacy alias for `buddy mcp serve`

Options:
  --list          List available MCP tools and exit
  --allow-write   Expose write, shell, and execution tools
  --tools <glob>  Restrict exposed tool names with glob patterns
  -h, --help      display help for command
```

</details>

<details>
<summary><code>buddy daemon --help</code> — exit 0</summary>

```text
Usage: buddy daemon [options] [command]

Manage the Code Buddy daemon (background process)

Options:
  -h, --help        display help for command

Commands:
  start [options]   Start the daemon
  stop              Stop the daemon
  restart           Restart the daemon
  status [options]  Show daemon status
  logs [options]    Show daemon logs
  help [command]    display help for command
```

</details>

<details>
<summary><code>buddy trigger --help</code> — exit 0</summary>

```text
Usage: buddy trigger [options] [command]

Manage event triggers for automated agent responses

Options:
  -h, --help             display help for command

Commands:
  list                   List all triggers
  add <spec>             Add a trigger (format: type:condition action:target)
  remove <id>            Remove a trigger by ID
  add-webhook [options]  Add a webhook trigger (GitHub, GitLab, Slack, Linear,
                         PagerDuty, generic)
  list-webhooks          List webhook triggers
  test [options] <id>    Test a webhook trigger with sample data
  help [command]         display help for command
```

</details>

<details>
<summary><code>buddy speak --help</code> — exit 0</summary>

```text
Usage: buddy speak [options] [text...]

Synthesize speech (AudioReader, Pocket, or expressive Voicebox)

Options:
  --engine <engine>     TTS engine: audioreader | pocket | voicebox
  --voice <voice>       Voice ID, Pocket preset/sample, or Voicebox profile
  --language <lang>     Language for Pocket or Voicebox
  --list-voices         List available voices
  --speed <speed>       Speaking speed (0.25-4.0) (default: "1.0")
  --format <format>     Output format (wav, mp3) (default: "wav")
  --url <url>           AudioReader API URL (default: "http://localhost:8000")
  --voicebox-url <url>  Voicebox API URL (defaults to CODEBUDDY_VOICEBOX_URL)
  -h, --help            display help for command
```

</details>

<details>
<summary><code>buddy assistant --help</code> — exit 0</summary>

```text
Usage: buddy assistant [options] [command]

Manage the voice assistant (Lisa): improvement loop, voice, config

Options:
  -h, --help                                      display help for command

Commands:
  show                                            Show the effective voice assistant config
  set <key> <value>                               Set one voice assistant environment value
  voice <name>                                    Use Pocket TTS with the given voice
  voices                                          List Pocket TTS preset voices
  voicebox [options]                              Inspect the Voicebox endpoint, GPU, models, languages, and profiles
  latency [options]                               Measure cached-answer latency to first PCM without playing or publishing audio
  voicebox-clone [options] <name> <audio>         Create an authorized Voicebox clone from one local reference sample
  voicebox-preset [options] <name>                Create a Voicebox profile from a functional built-in speaker
  voicebox-model [options] <action> <model-name>  Download, cancel, unload, or delete a Voicebox model
  voicebox-delete [options] <profile-id>          Delete a Voicebox profile and its samples
  preview <name>                                  Synthesize and play a Pocket TTS voice preview
  apply                                           Restart assistant user services so systemd reloads the env files
  doctor [options]                                Check the local robot organs; safe/read-only unless --repair is explicit
  improve [options]                               Run one improvement cycle: reflect on recent conversation and adapt (MySoulmate-style)
  repair-voice-incident [options]                 Quarantine a bounded acoustic-feedback incident; dry-run unless --apply is explicit
  replay-voice [options]                          Replay a voice JSONL offline to audit feedback-loop suppression (never speaks)
  quality [options]                               Evaluate recent user/Lisa exchanges without exposing their raw content
  benchmark [options]                             Run the reproducible Lisa conversation suite (Darkstar/Ollama or current provider)
  relational-benchmark [options]                  Run the deterministic raw-free relational detector self-test
  corpus-init [options]                           Create Lisa’s private annotated pilot corpus (mode 0600)
  compare [options]                               Compare 2-12 Lisa models with anonymized responses and a private review packet
  compare-reveal [options]                        Reveal model identities after a human has ranked the blind review packet
  route-apply [options]                           Activate a safe, human-reviewed blind-pilot winner across Lisa surfaces
  route-status [options]                          Show the active evidence-backed Lisa route and raw-free outcomes
  route-rollback                                  Restore the previous Lisa routing profile, or disable the current one
  route-disable                                   Immediately disable Lisa pilot routing without restoring another profile
  help [command]                                  display help for command
```

</details>


<details>
<summary><code>buddy widgets --help</code> — exit 0</summary>

```text
Usage: buddy widgets [options] [command]

Inline conversation widgets: list, preview, and generate (authored) widgets

Options:
  -h, --help                display help for command

Commands:
  list                      List curated and authored widgets
  preview [options] <kind>  Render a widget to an HTML file and print its path
  stats                     List authored widget data types and
                            automatic-render usage
  gen [options] <kind>      Generate (LLM) an authored widget for a kind, gate
                            it, and keep it if safe
  help [command]            display help for command
```

</details>

<details>
<summary><code>buddy doctor --help</code> — exit 0</summary>

```text
Usage: buddy doctor [options]

Diagnose Code Buddy environment, dependencies, and configuration

Options:
  -v, --verbose  Show all checks including passing ones
  --fix          Auto-fix issues that can be resolved automatically
  -h, --help     display help for command
```

</details>

<details>
<summary><code>buddy security-audit --help</code> — exit 0</summary>

```text
Usage: buddy security-audit [options]

Run a security audit of your Code Buddy environment

Options:
  --deep      Deep scan (git history, npm audit)
  --fix       Auto-fix file permission issues
  --json      Output as JSON
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy onboard --help</code> — exit 0</summary>

```text
Usage: buddy onboard [options]

Interactive setup wizard for Code Buddy

Options:
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy webhook --help</code> — exit 0</summary>

```text
Usage: buddy webhook [options] [command]

Manage webhook triggers

Options:
  -h, --help                      display help for command

Commands:
  list                            List registered webhooks
  add [options] <name> <message>  Register a new webhook
  remove <id>                     Remove a webhook
  help [command]                  display help for command
```

</details>

<details>
<summary><code>buddy ollama --help</code> — exit 0</summary>

```text
Usage: buddy ollama [options] [command]

Inspect or update the local Ollama runtime

Options:
  -h, --help        display help for command

Commands:
  status [options]  Show local Ollama version and models
  update [options]  Run the official Ollama Windows update script
  help [command]    display help for command
```

</details>

<details>
<summary><code>buddy heartbeat --help</code> — exit 0</summary>

```text
Usage: buddy heartbeat [options] [command]

Manage the heartbeat engine (periodic agent wake)

Options:
  -h, --help        display help for command

Commands:
  start [options]   Start the heartbeat engine
  stop              Stop the heartbeat engine
  status [options]  Show heartbeat status
  tick              Manually trigger a single heartbeat tick
  help [command]    display help for command
```

</details>

<details>
<summary><code>buddy hub --help</code> — exit 0</summary>

```text
Usage: buddy hub [options] [command]

Skills marketplace (search, install, publish)

Options:
  -h, --help                  display help for command

Commands:
  search [options] <query>    Search for skills
  install [options] <name>    Install a skill from the hub
  uninstall <name>            Uninstall a skill
  update [name]               Update installed skills (or a specific skill)
  list [options]              List installed skills
  usage                       Show local skill usage telemetry
  info <name>                 Show details about an installed skill
  publish [options] <path>    Publish a skill to the hub
  sync [options]              Sync installed skills with lockfile
  tap                         Manage repository-backed skill taps
  well-known [options] <url>  Discover skills from a
                              /.well-known/skills/index.json endpoint
  verify [options] <name>     Verify an installed skill's recorded signature
                              against the trusted keyring
  keys                        Manage trusted publisher signing keys
  help [command]              display help for command
```

</details>

<details>
<summary><code>buddy curator --help</code> — exit 0</summary>

```text
Usage: buddy curator [options] [command]

Rapport d'entretien propose-only (mémoire, skills, CKG, leçons, coûts)

Options:
  -h, --help      display help for command

Commands:
  scan [options]  Scanner la couche apprenante et écrire le rapport
                  (.codebuddy/curator/)
  latest          Afficher le dernier rapport généré
  help [command]  display help for command
```

</details>

<details>
<summary><code>buddy gateway-pairing --help</code> — exit 0</summary>

```text
Usage: buddy gateway-pairing [options] [command]

Operator approval for gateway device pairing (pending -> approve/reject ->
token)

Options:
  -h, --help                    display help for command

Commands:
  pending [options]             List devices awaiting pairing approval
  list [options]                List paired (approved) devices
  approve [options] <deviceId>  Approve a device and mint its scoped token
                                (shown once)
  reject [options] <deviceId>   Reject a pending pairing request
  revoke [options] <deviceId>   Revoke an already-paired device (invalidates
                                its token)
  help [command]                display help for command
```

</details>


<details>
<summary><code>buddy screen --help</code> — exit 0</summary>

```text
Usage: buddy screen [options] [command]

Capture, record, or watch the screen / a window

Options:
  -h, --help         display help for command

Commands:
  capture [options]  Capture a single frame to an image file
  record [options]   Record screen video (Ctrl-C to stop, or --duration)
  watch [options]    Watch the screen: periodic frames, idle-dedup, optional
                     OCR + secret redaction
  list-windows       List open windows (X11, via xwininfo) for --region
                     targeting
  help [command]     display help for command
```

</details>

<details>
<summary><code>buddy autonomy --help</code> — exit 0</summary>

```text
Usage: buddy autonomy|colab [options] [command]

Autonomous fleet loop — claim and run colab tasks on local-first models

Options:
  -h, --help                             display help for command

Commands:
  run [options]                          Run the autonomous loop (default: one tick; --watch for continuous)
  briefing [options]                     Build/show the evidence-first morning brief from the autonomy ledger
  bench [options]                        Benchmark live Tailnet Ollama peers and rank the network model tier
  status [options]                       Show the fleet task queue + presence
  tasks                                  Manage fleet colab tasks
  swarm [options] <goal>                 Create a workers → verifier → synthesizer task graph
  link [options] <childId> <parentId>    Add a dependency: childId depends on parentId
  unlink [options] <childId> <parentId>  Remove a dependency edge
  install [options]                      Install the autonomous daemon as an always-on systemd service (survives reboot)
  service [options] <action>             Control the installed autonomy service: start | stop | restart | status
  uninstall [options]                    Remove the autonomous daemon systemd service
  help [command]                         display help for command
```

</details>

<details>
<summary><code>buddy device --help</code> — exit 0</summary>

```text
Usage: buddy device [options] [command]

Manage paired device nodes (SSH, ADB, local)

Options:
  -h, --help             display help for command

Commands:
  list                   List all paired devices
  pair [options]         Pair a new device
  remove <id>            Remove a paired device
  snap <id>              Take a camera snapshot on a device
  screenshot <id>        Take a screenshot on a device
  record [options] <id>  Record the screen on a device
  run <id> <command...>  Run a command on a device
  help [command]         display help for command
```

</details>

<details>
<summary><code>buddy identity --help</code> — exit 0</summary>

```text
Usage: buddy identity [options] [command]

Manage agent identity files (SOUL.md, USER.md, etc.)

Options:
  -h, --help            display help for command

Commands:
  show                  Show loaded identity files
  get <name>            Show content of a specific identity file
  set <name> <content>  Set content of an identity file (writes to project
                        .codebuddy/)
  awaken [options]      Install the Buddy companion identity in project
                        .codebuddy/SOUL.md
  prompt                Show the combined identity prompt injection
  help [command]        display help for command
```

</details>

<details>
<summary><code>buddy companion --help</code> — exit 0</summary>

```text
Usage: buddy companion [options] [command]

Configure Buddy as a ChatGPT-backed voice companion

Options:
  -h, --help                    display help for command

Commands:
  setup [options]               Install companion identity and configure
                                voice-first defaults
  status                        Show companion readiness across ChatGPT auth,
                                identity, voice, TTS, and camera
  doctor [options]              Diagnose Lisa persona / spokenPrompt /
                                ROBOT_NAME alignment (exit 1 on errors)
  continuity                    Manage the integrity-protected companion
                                lineage across models, machines, and future
                                bodies
  migration|migrate             Export, verify, and safely restore an encrypted
                                companion lineage bundle
  live [options]                Build a live-session preflight brief for voice,
                                vision, memory, and fleet
  listen-check|heard [options]  Transcribe the latest real companion WAV and
                                show whether the voice gate would answer
  interactions [options]        List the built-in voice interaction shortcuts
                                used before the LLM path
  self                          Record Buddy companion self-state into the
                                local percept journal
  evaluate [options]            Evaluate Buddy companion readiness and record
                                self-improvement suggestions
  radar [options]               Compare Buddy against Hermes, OpenClaw, Lisa,
                                and companion systems
  improve [options]             Run Buddy companion self-improvement cycle:
                                radar, missions, and next brief
  impulses|brief [options]      Build Buddy companion proactive impulses from
                                readiness, senses, missions, and safety state
  check-in|say [options]        Prepare a short Buddy spoken check-in from
                                local companion state
  missions                      Manage Buddy companion self-improvement
                                missions
  skills                        Curate reviewed companion skills from repeated
                                missions and percepts
  gateway                       Bridge external chat channels into the
                                companion percept and safety model
  cards                         Create and inspect typed companion UI cards
  safety                        Inspect Buddy companion safety ledger events
  camera                        Manage the companion camera bridge
  percepts                      Inspect Buddy companion percepts recorded from
                                camera, voice, screen, tools, and self-state
  tts-cache                     Inspect the local Piper/TTS synthesis cache
                                used by the voice assistant
  help [command]                display help for command
```

</details>

<details>
<summary><code>buddy groups --help</code> — exit 0</summary>

```text
Usage: buddy groups [options] [command]

Manage group chat security

Options:
  -h, --help        display help for command

Commands:
  status            Show group security status
  list              List configured groups
  block <userId>    Add a user to the global blocklist
  unblock <userId>  Remove a user from the global blocklist
  help [command]    display help for command
```

</details>

<details>
<summary><code>buddy auth-profile --help</code> — exit 0</summary>

```text
Usage: buddy auth-profile [options] [command]

Manage authentication profiles (API key rotation)

Options:
  -h, --help                     display help for command

Commands:
  list                           List authentication profiles
  add [options] <id> <provider>  Add an authentication profile
  remove <id>                    Remove an authentication profile
  reset                          Reset all profiles (clears cooldowns)
  help [command]                 display help for command
```

</details>

<details>
<summary><code>buddy fleet --help</code> — exit 0</summary>

```text
Usage: buddy fleet [options] [command]

Inspect Fleet routing, toolsets, and dispatch policy decisions

Options:
  -h, --help                               display help for command

Commands:
  profiles [options]                       List available Fleet dispatch profiles
  token [options]                          Mint a fleet JWT (peer:invoke + fleet:listen) so another machine can join via /fleet listen --jwt
  toolsets [options] [profile] [tools...]  Inspect Hermes-style Fleet toolset descriptors
  policy [options] [profile] [tools...]    Preview tool policy decisions for a Fleet dispatch profile
  help [command]                           display help for command
```

</details>

<details>
<summary><code>buddy code-explorer --help</code> — exit 0</summary>

```text
Usage: buddy code-explorer [options] [command]

Interact with CodeExplorer for code understanding and session syncing

Options:
  -h, --help              display help for command

Commands:
  ask <query>             Consult CodeExplorer for a query or code
                          understanding request
  push-session <summary>  Push the session summary to CodeExplorer as technical
                          memory
  help [command]          display help for command
```

</details>

<details>
<summary><code>buddy hermes --help</code> — exit 0</summary>

```text
Usage: buddy hermes [options] [command]

Inspect the native Hermes-inspired Code Buddy agent profile

Options:
  -h, --help                               display help for command

Commands:
  kanban                                   Manage the persistent Hermes-compatible Kanban board for this workspace
  portal                                   Inspect Nous Portal auth, subscription, and Tool Gateway routing readiness
  claw                                     Migrate a legacy OpenClaw installation into Code Buddy
  status [options] [dispatchProfile]       Show a compact Hermes readiness overview across parity, providers, runtimes, browser, messaging, mobile, learning, and skills
  smoke [options]                          Run the safe local Hermes smoke suite for runtime, browser, and protocol gateways
  parity [options]                         Show the machine-checkable official Hermes parity manifest
  todo [options]                           Show the prioritized remaining Hermes feature work
  tools-parity|tools [options]             Compare official Hermes tool names against built-in Code Buddy tool schemas
  toolsets [options] [dispatchProfile]     Show the native Fleet toolsets used by the Hermes Agent profile
  profile [options] [dispatchProfile]      Show the Hermes Agent profile mapped onto Code Buddy primitives
  identity|id                              Inspect the built-in Hermes Agent identity and guardrails
  prompt-size [options] [dispatchProfile]  Show an offline byte breakdown of the Hermes prompt and active tool schemas
  memory                                   Inspect Hermes memory provider readiness
  learning                                 Inspect Hermes closed learning loop readiness
  skills                                   Inspect Hermes-compatible skill package readiness
  messaging                                Inspect Hermes messaging gateway readiness
  mobile                                   Inspect Hermes mobile supervision gateway readiness
  trajectories|trajectory                  Inspect Hermes trajectory export, recall, and research eval compatibility
  protocols|protocol                       Inspect Hermes MCP, A2A, and ACP gateway readiness
  protocols-smoke [options] [target]       Run an opt-in live smoke for local MCP stdio plus A2A/ACP HTTP routes
  providers|provider                       Inspect Hermes provider and active model readiness
  model|models                             Inspect the active Hermes model with compact setup guidance
  plan [options] [dispatchProfile]         Print a short Hermes integration checklist for the selected dispatch profile
  agent [options] [dispatchProfile]        Print the built-in Hermes Agent system prompt
  hooks [options]                          Show the Hermes lifecycle hook contract and configured handlers
  doctor [options] [dispatchProfile]       Check the built-in Hermes Agent profile and effective tool filter
  browser                                  Inspect Hermes browser backend readiness
  browser-smoke [options] <backendId>      Run an opt-in live smoke for one Hermes browser backend
  runtime                                  Inspect Hermes runtime backend readiness
  runtime-smoke [options] <backendId>      Run an opt-in live smoke for one Hermes runtime backend
  help [command]                           display help for command
[2026-08-25T16:29:54.404Z]  INFO  [self-improve] reloaded 5 authored tool(s): authored__slugify_text, authored__count_words, authored__reverse, authored__slugify, authored__greet
```

</details>


<details>
<summary><code>buddy acp --help</code> — exit 0</summary>

```text
Usage: buddy acp [options]

Run Code Buddy as an ACP (Agent Client Protocol) agent over stdio for editor
integration (e.g. Zed)

Options:
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy tools --help</code> — exit 0</summary>

```text
Usage: buddy tools [options] [command]

Inspect tool profiles and effective tool availability

Options:
  -h, --help                                  display help for command

Commands:
  profile [options] [profile] [toolNames...]  Inspect a Hermes/Fleet tool profile against real or provided tools
  browser-operator                            Preview Browser Operator session contracts without starting a browser
  skill-candidate                             Inspect and install reviewed SKILL.md candidates
  help [command]                              display help for command
[2026-08-25T16:29:54.860Z]  INFO  [self-improve] reloaded 5 authored tool(s): authored__slugify_text, authored__count_words, authored__reverse, authored__slugify, authored__greet
```

</details>

<details>
<summary><code>buddy autonomous-code --help</code> — exit 0</summary>

```text
Usage: buddy autonomous-code [options]

Run a guarded Agentic Coding Cell task contract

Options:
  --task-file <path>                               path to an Agentic Coding Cell JSON task contract
  --audit-overnight-manifest <path>                audit an overnight manifest without running another supervision cycle
  --resume <runId>                                 resume a run from a checkpoint state
  --resume-from-manifest <path>                    resume a run from an overnight manifest and reuse its diagnostic artifact paths
  --run-id <runId>                                 unique run identifier for checkpointing
  --edit-proposal-file <path>                      path to a controlled edit proposal JSON file
  --edit-proposal-producer-dispatch-file <path>    write a data-only dispatch artifact for a future edit-proposal producer
  --edit-proposal-review-file <path>               write a compact review snapshot for a controlled edit proposal
  --generate-edit-proposal-file <path>             run the data-only edit-proposal producer and write a controlled proposal JSON file
  --preview-edits                                  preview declared scoped edit operations without writing files
  --apply-edits                                    apply declared scoped edit operations after preflight passes
  --require-preview                                require a successful scoped edit preview before applying edits
  --proposal-prompt-file <path>                    write a constrained prompt for producing an edit proposal JSON file
  --proposal-loop-file <path>                      write a Cowork proposal loop packet with prompts, artifacts, and commands
  --proposal-loop-canvas-file <path>               write a ReactFlow-style canvas for the proposal loop packet
  --proposal-loop-cowork-import-file <path>        write a standalone Cowork import manifest for proposal-loop artifacts
  --proposal-loop-cowork-import-check-file <path>  write a passive artifact availability check for the Cowork import manifest
  --proposal-loop-cowork-workspace-file <path>     write a Cowork workspace summary from the import manifest
  --proposal-loop-next-action-file <path>          write a compact Cowork next-action snapshot for the proposal loop
  --proposal-loop-artifacts-dir <path>             materialize a non-writing Cowork proposal loop artifact bundle
  --approval-file <path>                           write a compact Cowork approval-state JSON artifact
  --approval-decision-file <path>                  path to a controlled Cowork approval decision JSON file
  --approval-decision-prompt-file <path>           write a constrained prompt for producing an approval decision JSON file
  --require-approval                               require an approved decision file before applying scoped edits
  --require-fleet-collaboration                    fail generated proposals unless Fleet collaboration completed at least one peer call
  --require-overnight-completion                   fail supervised overnight runs unless the minimum window and Fleet proof actually completed
  --require-overnight-readiness                    fail supervised overnight runs unless the window and required Fleet proof are ready
  --recover-from-supervision <path>                resume watchdog supervision from a supervision-recovery.json handoff
  --workflow-builder-prompt-file <path>            write a constrained prompt for designing a workflow canvas
  --workflow-builder-proposal-file <path>          path to a controlled workflow builder proposal JSON file
  --workflow-builder-proposal-canvas-file <path>   write a canvas JSON artifact from a validated workflow builder proposal
  --workflow-file <path>                           write a PostCommander-style workflow canvas JSON artifact
  --workflow-events-file <path>                    write a compact workflow event timeline JSON artifact
  --workflow-progress-file <path>                  write a compact workflow progress snapshot JSON artifact
  --run-verification                               run declared verification commands after preflight passes
  --verification-timeout-ms <ms>                   timeout per verification command
  --autonomy-preset <name>                         budget preset for autonomous runs: standard or overnight
  --overnight-manifest-file <path>                 write an overnight run manifest with checkpoint, artifacts, and resume command
  --supervise-from-manifest <path>                 run repeated bounded resume cycles from an overnight manifest
  --supervise-cycles <count>                       maximum supervision cycles when using --supervise-from-manifest
  --supervision-fleet-triage-file <path>           write a Fleet triage handoff JSON when recoverable supervision stops with Fleet enabled
  --supervision-fleet-triage-result-file <path>    write the attempted Fleet triage result JSON for recoverable supervision stops
  --supervise-max-stalled-cycles <count>           stop supervision after the same progress state repeats this many cycles
  --supervise-max-error-cycles <count>             stop supervision after this many consecutive cycle errors
  --supervision-events-file <path>                 append per-cycle supervision JSONL events when using --supervise-from-manifest
  --supervision-recovery-file <path>               write recovery handoff JSON when supervised manifest runs stop before a terminal status
  --supervise-sleep-ms <ms>                        delay between supervision cycles
  --max-cost-usd <usd>                             maximum allowed cost in USD
  --max-iterations <count>                         maximum self-correction iterations
  --report-file <path>                             write the JSON report to a file
  --json                                           output JSON
  -h, --help                                       display help for command
```

</details>

<details>
<summary><code>buddy session --help</code> — exit 0</summary>

```text
Usage: buddy session [options] [command]

Manage saved sessions

Options:
  -h, --help                   display help for command

Commands:
  list|ls [options]            List recent saved sessions
  search [options] <query...>  Search saved sessions by content
  resume <sessionId>           Resume a saved session by ID or partial ID
  last                         Resume the most recently used session
  help [command]               display help for command
```

</details>

<details>
<summary><code>buddy config --help</code> — exit 0</summary>

```text
Usage: buddy config [options] [command]

Show environment variable configuration and validation

Options:
  -h, --help      display help for command

Commands:
  show [options]  Show all environment variables and their values
  validate        Validate current environment configuration
  get <name>      Show the value and definition of a single environment
                  variable
  help [command]  display help for command
```

</details>

<details>
<summary><code>buddy dev --help</code> — exit 0</summary>

```text
Usage: buddy dev [options] [command]

Golden-path developer workflows (plan, run, pr, fix-ci, explain)

Options:
  -h, --help                       display help for command

Commands:
  plan <objective>                 Profile repo + produce a task plan (no
                                   implementation)
  run [options] <objective>        Plan + implement + test + save artifacts in
                                   RunStore
  pr [options] <objective>         Run a workflow then generate a PR summary
  fix-ci [options]                 Read CI/test logs and propose patches to fix
                                   failures
  issue [options] <url-or-number>  Fetch a GitHub issue, plan + implement +
                                   test + create PR
  explain                          Summarise repo conventions, structure, and
                                   critical paths
  help [command]                   display help for command
```

</details>

<details>
<summary><code>buddy run --help</code> — exit 0</summary>

```text
Usage: buddy run [options] [command]

Inspect and replay agent runs (observability)

Options:
  -h, --help                                           display help for command

Commands:
  list [options]                                       List recent runs
  doctor [options]                                     Report stale running runs and other run ledger drift without mutating stored runs
  show <runId>                                         Show complete timeline, metrics, and artifacts for a run
  search [options] <query...>                          Search run summaries, events, and text artifacts
  index-artifacts [options]                            Backfill the durable artifact search index for historical run folders
  index-doctor [options]                               Report (and optionally repair) stale artifact index rows whose run folders were pruned or moved
  lineage [options] <runId>                            Show the fork family tree of a run (ancestors + descendants)
  recall-pack [options] <query...>                     Build a compact recall pack from matching run summaries, events, and artifacts
  trajectory-export [options] <runId>                  Export a redacted run trajectory for debugging, audit, or evals
  trajectory-batch [options] [query...]                Export a redacted batch of run trajectories plus compressed agent context
  retrospective [options] <runId>                      Run the Learning Agent over a redacted trajectory and propose review-gated lessons/skills
  golden-evals [options] [fixtureId] [runId]           List golden workflow eval fixtures, or evaluate one run against one fixture
  policy-evals [options] [policyId] [runId]            List trajectory policy evals, or evaluate one run against one policy
  mobile-snapshot [options] <query...>                 Build a redacted review-only snapshot for mobile supervision
  mobile-gateway-contract [options] <query...>         Describe the review-only mobile supervision gateway contract
  mobile-gateway-check [options] <query...>            Evaluate a hypothetical mobile gateway request against the review-only policy
  mobile-gateway-review-draft [options] <query...>     Build a local-only operator review draft for a hypothetical mobile gateway request
  mobile-gateway-listener-shell [options] <query...>   Build the disabled local listener shell for the future mobile gateway
  mobile-pairing-state [options] <query...>            Build a preview-only local pairing state for the future mobile gateway
  mobile-pairing-acceptance-plan [options] <query...>  Build a no-network pairing acceptance plan for the future mobile gateway
  mobile-approval-queue [options] <query...>           Build a local-only mobile approval queue for the future gateway
  tail <runId>                                         Stream run events in real-time (follow mode)
  replay [options] <runId>                             Show timeline and re-execute test steps
  help [command]                                       display help for command
```

</details>

<details>
<summary><code>buddy cron --help</code> — exit 0</summary>

```text
Usage: buddy cron [options] [command]

Author and manage scheduled cron jobs (incl. watchdog + pre-check)

Options:
  -h, --help             display help for command

Commands:
  list [options]         List scheduled cron jobs
  show [options] <id>    Show one cron job
  pause [options] <id>   Pause a cron job by id (or id prefix)
  resume [options] <id>  Resume a cron job by id (or id prefix)
  run [options] <id>     Run a cron job immediately by id (or id prefix)
  update [options] <id>  Update a cron job by id (or id prefix)
  add [options] <name>   Add a cron job (message or --watchdog), with optional
                         --pre-check and --deliver
  remove <id>            Remove a cron job by id (or id prefix)
  help [command]         display help for command
```

</details>

<details>
<summary><code>buddy skills --help</code> — exit 0</summary>

```text
Usage: buddy skills [options] [command]

Browse, inspect and manage installed SKILL.md packages

Options:
  -h, --help                       display help for command

Commands:
  list [options]                   List installed skill packages
  doctor [options]                 Audit installed skill packages for missing
                                   or modified SKILL.md files
  usage [options]                  Show local usage telemetry, most-used first
  learning-usage [options]         Show Learning Agent skill outcome telemetry
  update-preview [options] <name>  Preview a hub-backed skill update diff
                                   without applying it
  update [options] <name>          Update an installed skill to a
                                   hub/cache-backed version
  patch [options] <name>           Patch text in an installed skill package
  reset [options] <name>           Reset an installed skill to its
                                   hub/cache-backed version
  enable [options] <name>          Enable an installed skill
  disable [options] <name>         Disable an installed skill (stays installed
                                   but inactive)
  deprecate [options] <name>       Deprecate an installed skill (disabled and
                                   marked deprecated)
  delete [options] <name>          Delete an installed skill package
  rollback [options] <name>        Rollback an installed skill to a saved
                                   snapshot
  tap                              Manage repository-backed skill taps
  well-known [options] <url>       Discover skills from a
                                   /.well-known/skills/index.json endpoint
  import [options]                 Import external skills from a directory or a
                                   named source (firewall-gated)
  imported [options]               List imported skills (with provenance +
                                   pinned status)
  exchange                         Export, verify and install locally signed
                                   skill packages
  sources                          Manage skill sources (the import
                                   referential)
  help [command]                   display help for command
```

</details>

<details>
<summary><code>buddy pairing --help</code> — exit 0</summary>

```text
Usage: buddy pairing [options] [command]

Manage DM pairing security (allowlist unknown senders on messaging channels)

Options:
  -h, --help                   display help for command

Commands:
  status                       Show pairing mode configuration and statistics
  list [options]               List approved senders
  pending                      List pending pairing requests
  approve [options] <code>     Approve a pending pairing request by code
  add [options] <senderId>     Directly approve a sender without a pairing code
  revoke [options] <senderId>  Revoke approval for a sender
  enable                       Enable DM pairing mode (requires restart of
                               channel adapters)
  help [command]               display help for command
```

</details>


<details>
<summary><code>buddy shadow --help</code> — exit 0</summary>

```text
Usage: buddy shadow [options] [command]

Inspect or run speculative validation in the persistent shadow worktree

Options:
  -h, --help      display help for command

Commands:
  status          Show shadow worktree state and effective configuration
  run             Validate the current working tree changes in the shadow
                  worktree
  help [command]  display help for command
```

</details>

<details>
<summary><code>buddy knowledge --help</code> — exit 0</summary>

```text
Usage: buddy knowledge [options] [command]

Manage agent knowledge bases (Knowledge.md files injected as agent context)

Options:
  -h, --help                display help for command

Commands:
  list                      List all loaded knowledge entries
  show <title>              Display a knowledge entry by title
  search [options] <query>  Search knowledge base with keyword query
  add [options]             Add a new knowledge entry (interactive)
  remove <title>            Remove a knowledge entry by title
  context [options]         Show the full knowledge context block the agent
                            would receive
  help [command]            display help for command
```

</details>

<details>
<summary><code>buddy research --help</code> — exit 0</summary>

```text
Usage: buddy research [options] [command] <topic>

Wide Research: spawn parallel agent workers to research a topic comprehensively

Arguments:
  topic                              The topic to research

Options:
  -w, --workers <n>                  Legacy shorthand: set both items and
                                     concurrency (max: 20)
  --items <n>                        Total independent research items (default:
                                     5, max: 250)
  --concurrency <n>                  Maximum parallel workers per wave
                                     (default: 5, max: 20)
  -r, --rounds <n>                   Max tool rounds per worker (default: 15)
                                     (default: "15")
  --worker-timeout-ms <n>            Per-worker timeout in milliseconds
                                     (default: 90000) (default: "90000")
  --timeout-ms <n>                   Overall research timeout in milliseconds
                                     (default: auto-scaled by waves)
  -f, --report <file>                Save the report to a Markdown file
  --context <text>                   Additional context injected into each
                                     worker
  -m, --model <model>                Override the model for this research run
  --wide                             Force parallel workers even in
                                     non-interactive runs (default: direct
                                     single-pass) (default: false)
  --deep                             Deep Research: deterministic, cited
                                     pipeline (plan → search → scrape → dedup →
                                     cited synthesis) (default: false)
  --iterations <n>                   Deep Research (Phase B) gap-loop rounds: 1
                                     = single round (default, = Phase A), 2-3
                                     iterates research→gap-analysis→re-search
                                     until convergence (max 5). Only with
                                     --deep (default: "1")
  --perspectives <n>                 Deep Research (Phase C, STORM): research
                                     the topic from N diversified personas
                                     (praticien/sceptique/historique/architecte…)
                                     in parallel, then co-write an
                                     outline-first cited article. Default 0 =
                                     off. Implies --deep. Takes precedence over
                                     --iterations. Clamped [2,6] (default: "0")
  --storm                            Deep Research (Phase C, STORM) with the
                                     default perspective count (4). Alias for
                                     --perspectives 4. Implies --deep (default:
                                     false)
  --ckg                              Deep Research (Phase D): bridge the run to
                                     the Collective Knowledge Graph — recall
                                     prior collective knowledge (injected as a
                                     distinct "Mémoire collective" section) and
                                     ingest the deduped sources for
                                     cross-run/agent accumulation. Also enabled
                                     by CODEBUDDY_COLLECTIVE_MEMORY=true. Rides
                                     on --deep; combinable with
                                     --iterations/--perspectives (default:
                                     false)
  --checkpoint <file>                Persist a resumable Wide Research
                                     checkpoint (atomic JSON)
  --resume <file>                    Resume a compatible Wide Research
                                     checkpoint in place
  --json                             Emit one structured Wide Research JSON
                                     result (implies --wide) (default: false)
  -h, --help                         display help for command

Commands:
  sync [options] <peer>              Pull first-hand lessons/facts from an
                                     opted-in fleet peer
  ingest [options] <topic>           Fetch scientific publications on a topic
                                     and ingest them into the collective
                                     knowledge graph (auto-linked)
  ingest-code [options]              Ingest Code Explorer code-graph insights
                                     (hotspots, cycles, …) into the knowledge
                                     graph
  ingest-connector [options] <name>  Ingest read-only content from a personal
                                     MCP connector into the knowledge graph
  recall [options] <query>           Query the collective knowledge base
                                     (hybrid semantic search, cross-lingual)
  stats                              Show the collective knowledge graph size
  list [options]                     List the indexed documents/entities in the
                                     collective knowledge graph (newest first)
  fact                               Structured facts in the collective memory
                                     (reconciled, decaying)
  mirror [options]                   Write a read-only Markdown mirror of the
                                     structured facts (one file per category,
                                     Obsidian-friendly)
  show <idOrName>                    Show one knowledge-graph node (id or name)
                                     with its bi-temporal status and history
  retract [options] <idOrName>       Retract a knowledge-graph node
                                     (append-only tombstone; a later remember()
                                     revives it)
  topics                             Manage the auto-ingest research topics
```

</details>

<details>
<summary><code>buddy meeting --help</code> — exit 0</summary>

```text
Usage: buddy meeting [options] [command]

Turn a local transcript, audio, or video file into grounded meeting notes

Options:
  -h, --help               display help for command

Commands:
  notes [options] <input>  Extract summary, decisions, actions, questions,
                           evidence, and timestamped transcript
  help [command]           display help for command
```

</details>

<details>
<summary><code>buddy scrape --help</code> — exit 0</summary>

```text
Usage: buddy scrape [options] [url]

Scrape a web page locally with Scrapling (web_fetch fallback when unavailable)

Arguments:
  url                     Public HTTP or HTTPS URL to scrape

Options:
  --mode <mode>           Scraping mode (choices: "http", "stealth", "dynamic",
                          default: "http")
  --format <format>       Output format (choices: "md", "text", "html",
                          default: "md")
  --css <field=selector>  Extract a named CSS selector (repeatable) (default:
                          [])
  --out <file>            Write output to a file instead of stdout
  --setup                 Install Scrapling into ~/.codebuddy/scrapling/.venv
  --browsers              With --setup, install browser runtimes for
                          stealth/dynamic modes
  --check                 Check whether Scrapling is installed and print its
                          version
  -h, --help              display help for command
```

</details>

<details>
<summary><code>buddy papers --help</code> — exit 0</summary>

```text
Usage: buddy papers [options] [command]

Paper QA: ask a question over a local corpus of scientific PDFs and get a
grounded, cited answer

Options:
  -h, --help                display help for command

Commands:
  ask [options] <question>  Answer a question from PDF papers with an anchored,
                            cited answer (or an honest refusal)
  help [command]            display help for command
```

</details>

<details>
<summary><code>buddy science --help</code> — exit 0</summary>

```text
Usage: buddy science [options] <goal>

AI-Scientist-lite (EXPERIMENTAL, opt-in CODEBUDDY_AI_SCIENTIST=true):
human-gated, sandboxed experiment — a single pass (idea → novelty → GATE → run
→ analyse → report → review → GATE → publish) or a bounded best-first discovery
loop (--loop). Empirical scoring (--score), hardened sandbox (--sandbox
docker|e2b).

Arguments:
  goal                         The research goal / question to experiment on

Options:
  --hypothesis <text>          Supply the hypothesis directly (skips LLM
                               ideation)
  --code-file <path>           Supply the experiment code from a file (skips
                               LLM authoring)
  --language <lang>            Experiment language:
                               python|javascript|typescript|shell (default:
                               "python")
  -m, --model <model>          Override the model for this run
  --timeout <ms>               Experiment execution timeout in ms (clamped to
                               the runner cap)
  -r, --report <file>          Write the final Markdown report to a file
  --no-publish                 Never publish (still runs + reviews; GATE #2
                               auto-declines)
  --score                      Phase 1: empirically score the experiment
                               metric, record a variant, human keep-gate it
                               (decoupled from the repo)
  --metric-key <key>           Metric key to parse from the experiment stdout
                               (with --score) (default: "accuracy")
  --baseline-score <n>         Experiment baseline score to beat (with
                               --score); omit to keep the first stepping-stone
  --no-higher-is-better        Treat the metric as lower-is-better, e.g. a loss
                               (with --score)
  --sandbox <backend>          Phase 2 execution sandbox: isolate|docker|e2b
                               (default isolate). docker cuts the network
                               (--network none); e2b runs off-host. Also set
                               via CODEBUDDY_SCIENCE_SANDBOX
  --require-network-isolation  Phase 2: refuse to run (fail closed) if the
                               chosen sandbox cannot cut network egress,
                               instead of silently degrading to the
                               network-open isolate runner. Implies --sandbox
                               docker when no backend is given
  --loop                       Phase 3 (EXPERIMENTAL): run the BOUNDED
                               multi-generation best-first tree search
                               discovery loop instead of a single pass.
                               Autonomous BETWEEN two human gates (approve
                               plan+budget, then approve the best result),
                               capped by --max-generations / --max-experiments
                               / --budget
  --max-generations <n>        Phase 3 HARD CAP: max generations (default 5,
                               clamped ≤100)
  --max-experiments <n>        Phase 3 HARD CAP: max experiments executed
                               (default 10, clamped ≤500)
  --budget <duration>          Phase 3 HARD CAP: wall-clock budget, e.g. 500,
                               30s, 10m, 2h (default 30m)
  --parallel <n>               Phase 3: parallel workers per generation
                               (default 1, clamped ≤8)
  --max-cost <n>               Phase 3 HARD CAP: cost budget in arbitrary units
                               — the loop stops the instant it is reached. Only
                               fires when armed with --cost-per-experiment
                               (default cost 0). Also via
                               CODEBUDDY_SCIENCE_MAX_COST
  --cost-per-experiment <n>    Phase 3: cost charged per executed experiment;
                               accumulates toward --max-cost (default 0 = the
                               cost cap never fires). Also via
                               CODEBUDDY_SCIENCE_COST_PER_EXPERIMENT
  -h, --help                   display help for command
```

</details>

<details>
<summary><code>buddy gpu-worker --help</code> — exit 0</summary>

```text
Usage: buddy gpu-worker [options]

Run the authenticated PanoWorld/LongCat GPU job worker

Options:
  --host <host>              Bind host (use a Tailscale address on Darkstar)
                             (default: "127.0.0.1")
  --port <port>              Bind port (default: "4310")
  --state-dir <path>         Persistent queue and job artifacts (default:
                             "/home/patrice/.codebuddy/gpu-worker")
  --root <path...>           Allowed input/output roots
  --worker-id <id>           Worker identifier (default: "darkstar")
  --max-concurrency <count>  Concurrent jobs (1–2) (default: "1")
  -h, --help                 display help for command
```

</details>

<details>
<summary><code>buddy vision-train --help</code> — exit 0</summary>

```text
Usage: buddy vision-train [options]

Score the robot vision on labeled synthetic/real scenes (train-the-brain
benchmark)

Options:
  --count <n>           generate mode: number of synthetic scenes (default:
                        "12")
  --prop <name>         generate mode: labeled prop in peopled scenes
                        (desk|chair|none) (default: "desk")
  --images <dir>        folder mode: perceive images from a directory instead
                        of generating
  --labels <file>       folder mode: JSON mapping filename -> {label: count}
                        ground truth
  --coco <file>         folder mode: derive ground truth from a COCO
                        annotations file (e.g. BlenderProc output) instead of
                        --labels
  --provider <name>     generate mode: image provider (comfyui|openai|xai)
  --model <ckpt>        generate mode: image model/checkpoint
  --min-confidence <n>  YOLO min confidence (default: "0.35")
  --ckg                 publish weak spots to the Collective Knowledge Graph
                        (needs CODEBUDDY_COLLECTIVE_MEMORY=true)
  --out <dir>           report output directory (default:
                        ".codebuddy/vision-train")
  -h, --help            display help for command
```

</details>

<details>
<summary><code>buddy lora --help</code> — exit 0</summary>

```text
Usage: buddy lora [options] [command]

Krea 2 character/style LoRA: init dataset, train (cloud fal or local plan),
install into ComfyUI

Options:
  -h, --help                       display help for command

Commands:
  init [options] <name>            Create a LoRA project under
                                   .codebuddy/lora/<name>/images
  validate [options] <nameOrPath>  Validate images/captions for a project
  promote [options] <nameOrPath>   Promote an approved identity manifest into
                                   the project images directory
  dataset [options] [name]         Generate a synthetic training image set
                                   (ComfyUI/xAI/OpenAI)
  pack [options] <nameOrPath>      Zip images (+ captions) for fal upload
  train                            Train a Krea 2 LoRA (cloud or local plan)
  install [options] <file>         Copy a .safetensors LoRA into ComfyUI
                                   models/loras
  status                           Readiness for Lisa selfie (image backend,
                                   LoRA, Telegram)
  list                             List projects and ComfyUI LoRAs
  lisa                             Shortcut: init a Lisa character LoRA project
                                   (trigger ohwx lisa)
  avatars                          List multi-style avatar profiles (Krea
                                   brunette muse + classic)
  selfie [options]                 Generate a photo of Lisa (LoRA trigger) and
                                   send it on Telegram
  selfie-cache [options]           Pre-generate rotating Lisa selfies under
                                   safe/sensual/explicit tier folders
  help [command]                   display help for command
```

</details>


<details>
<summary><code>buddy flow --help</code> — exit 0</summary>

```text
Usage: buddy flow [options] <goal>

Execute a multi-agent planning flow (OpenManus-compatible)

Arguments:
  goal                   The goal to plan and execute

Options:
  --max-retries <n>      Max retries per failed step (default: "1")
  --default-agent <key>  Default agent key (default: "default")
  --verbose              Show step-by-step progress (default: false)
  -m, --model <model>    Override the model for this flow run
  -h, --help             display help for command
```

</details>

<details>
<summary><code>buddy film --help</code> — exit 0</summary>

```text
Usage: buddy film [options] [command]

Produce a long-form film from a scene plan: generate clips → montage with
transitions + music → quality gate

Options:
  -h, --help                     display help for command

Commands:
  generate [options] <name>      Create/resume a film project, generate a clip
                                 per scene, then assemble it
  assemble <name>                (Re)assemble the already-generated clips into
                                 the film — no generation, no cost
  status <name>                  Show a film project: scene statuses, progress,
                                 and recent decisions
  from-prompt [options] <pitch>  Génère une vidéo de présentation narrée depuis
                                 un simple sujet (le LLM planifie les scènes →
                                 narration Piper → rendu premium + sous-titres
                                 karaoké). $0 via ChatGPT.
  help [command]                 display help for command
```

</details>

<details>
<summary><code>buddy goal --help</code> — exit 0</summary>

```text
Usage: buddy goal [options] <goal>

Run the agent toward a standing goal until a judge model confirms it is done
(Ralph loop)

Arguments:
  goal                   The goal to pursue

Options:
  --max-turns <n>        Turn budget (default 20, or goals.maxTurns from
                         settings)
  --judge-model <model>  Model for the goal judge (default: session model)
  -m, --model <model>    Override the agent model for this run
  --max-tool-rounds <n>  Max tool rounds per turn (default: 50)
  -h, --help             display help for command
```

</details>

<details>
<summary><code>buddy loop --help</code> — exit 0</summary>

```text
Usage: buddy loop [options] <goal>

Boucle de dev autonome : plan → exécute → vérifie (Verifier) → juge → décide,
jusqu'à fait (prouvé) ou budget

Arguments:
  goal                      L'objectif de développement à atteindre

Options:
  --max-turns <n>           Budget de tours (défaut 20, ou goals.maxTurns)
  --budget <usd>            Budget coût session en USD (pause si dépassé)
  --judge-model <model>     Modèle du juge (défaut: modèle de session)
  --verify-cmd <shell>      Gate de vérif DÉTERMINISTE (exit 0 = CONFIRMED) au
                            lieu du Verifier LLM — ex. "npm test"
  --no-verify               Désactiver le gate Verifier indépendant (boucle
                            juge-seule)
  --no-structural           Désactiver la couche structurelle zéro-LLM
                            (fichiers vides/conflits/omissions/JSON) avant le
                            Verifier
  --no-plan                 Désactiver la décomposition en plan
  -m, --model <model>       Override du modèle agent pour ce run
  --permission-mode <mode>  Posture de permission : default, plan, acceptEdits,
                            dontAsk, bypassPermissions
  --max-tool-rounds <n>     Max tool rounds par tour (default: 50)
  -h, --help                display help for command
```

</details>

<details>
<summary><code>buddy intent --help</code> — exit 0</summary>

```text
Usage: buddy intent [options] [view]

Inspect the current durable Intent Graph or its secret-redacted Proof Ledger

Arguments:
  view         graph|proofs|progress|integrity|outcomes|constitution|exchange|shadows
               (default: "graph")

Options:
  --json       Print structured JSON
  --limit <n>  Maximum proof records to show (default: 100)
  -h, --help   display help for command
```

</details>

<details>
<summary><code>buddy intents --help</code> — exit 0</summary>

```text
Usage: buddy intents [options] [command]

Manage replayable intent specifications (opt-in CODEBUDDY_INTENTS=true)

Options:
  -h, --help         display help for command

Commands:
  new <description>  Generate and store an intent from a natural-language task
  list               List stored intents
  show <id>          Show one intent as Markdown
  check <id>         Replay every verification criterion for an intent
  drift              Re-check done intents and their referenced files
  done <id>          Mark an intent done
  archive <id>       Archive an intent
```

</details>

<details>
<summary><code>buddy replay --help</code> — exit 0</summary>

```text
Usage: buddy replay [options] <sessionId>

Inspect, restore, or fork a time-travel session timeline

Arguments:
  sessionId              Session id to replay

Options:
  --at <turn>            Inspect a specific turn
  --fork <newSessionId>  Fork the session through --at into this exact id
  -y, --yes              Restore without an interactive confirmation (default:
                         false)
  -h, --help             display help for command
```

</details>

<details>
<summary><code>buddy share --help</code> — exit 0</summary>

```text
Usage: buddy share [options] [sessionId]

Exporter une session en replay HTML autonome et partageable

Arguments:
  sessionId             ID de session; la plus récente par défaut

Options:
  --out <fichier.html>  Chemin du fichier HTML de sortie
  --last                Exporter explicitement la session la plus récente
                        (default: false)
  --open                Ouvrir le fichier dans le navigateur (best-effort)
                        (default: false)
  -h, --help            display help for command
```

</details>

<details>
<summary><code>buddy cost --help</code> — exit 0</summary>

```text
Usage: buddy cost [options]

Afficher les dépenses agrégées depuis les sessions sauvegardées (read-only)

Options:
  --last                     Limiter le rapport à la session la plus récente
                             (default: false)
  --session <id>             Limiter le rapport à un ID de session
  --since <7d|YYYY-MM-DD>    Limiter les tours à une période
  --by <model|provider|day>  Ventilation du tableau (default: "model")
  --json                     Produire un JSON lisible par machine (default:
                             false)
  -h, --help                 display help for command
```

</details>

<details>
<summary><code>buddy forge --help</code> — exit 0</summary>

```text
Usage: buddy forge [options] [command]

Compare counterfactual strategies against one shared Intent Graph proof
contract

Options:
  -h, --help                     display help for command

Commands:
  create [options] <label>       Create a planned counterfactual branch
  evaluate [options] <branchId>  Score a branch from the current intent Proof
                                 Ledger
  compare [options]              Rank every counterfactual branch
  select [branchId]              Select an eligible winner; omit id to choose
                                 the best score
  help [command]                 display help for command
```

</details>


<details>
<summary><code>buddy exchange --help</code> — exit 0</summary>

```text
Usage: buddy exchange [options] [command]

Sovereign execution market: constitution → bids → Shadow Twin → proof-gated
award

Options:
  -h, --help                  display help for command

Commands:
  constitution [options]      Inspect or update the mission autonomy
                              constitution
  bid [options] <label>       Submit a model or fleet offer against the current
                              intent contract
  rank [options]              Rank bids on the policy-compatible Pareto
                              frontier
  rehearse [options] <bidId>  Record measured Shadow Twin observations for a
                              bid
  award [options] <bidId>     Award a ready bid and create its proof-gated
                              Forge branch
  reject <bidId>              Reject a bid without mutating the intent contract
  help [command]              display help for command
```

</details>

<details>
<summary><code>buddy capsule --help</code> — exit 0</summary>

```text
Usage: buddy capsule [options] [command]

Proof-backed portable workflows compiled from proven outcomes

Options:
  -h, --help               display help for command

Commands:
  list [options]
  create [options]         Compile the latest proven outcome into a portable
                           capsule
  activate [options] <id>
  revoke <id>
  help [command]           display help for command
```

</details>

<details>
<summary><code>buddy todo --help</code> — exit 0</summary>

```text
Usage: buddy todo [options] [command]

Manage the persistent task list (todo.md) — injected into every agent turn

Options:
  -h, --help             display help for command

Commands:
  list|ls [options]      List all todo items
  add [options] <text>   Add a new todo item
  done <id>              Mark an item as completed
  update [options] <id>  Update an item
  remove|rm <id>         Remove an item
  clear-done             Remove all completed items
  context                Preview the todo context block injected into each
                         agent turn
  help [command]         display help for command
```

</details>

<details>
<summary><code>buddy execpolicy --help</code> — exit 0</summary>

```text
Usage: buddy execpolicy [options] [command]

Manage execution policy rules — allow/deny/ask/sandbox for shell commands
(Codex-inspired)

Options:
  -h, --help                            display help for command

Commands:
  check [options] <command>             Evaluate a shell command string against
                                        all active rules
  check-argv [options] <cmd> [args...]  Evaluate a parsed argv token array
                                        (prefix rules take priority over
                                        regex/glob)
  list [options]                        List all active policy rules
  list-prefix                           List token-array prefix rules
  add-prefix [options] <tokens...>      Add a token-array prefix rule (e.g.
                                        "add-prefix git push --action deny")
  show-dangerous <command>              Check if a command matches known
                                        dangerous patterns
  dashboard                             Show full execution policy dashboard
  help [command]                        display help for command
```

</details>

<details>
<summary><code>buddy lessons --help</code> — exit 0</summary>

```text
Usage: buddy lessons [options] [command]

Manage lessons learned (self-improvement loop) — injected into every agent turn

Options:
  -h, --help                       display help for command

Commands:
  list|ls [options]                List all lessons, optionally filtered by
                                   category
  show [options] <id>              Show one lesson by id, with the file(s) it
                                   lives in
  rm|remove [options] <id>         Delete a lesson by id (from every file it
                                   lives in)
  edit [options] <id>              Edit a lesson in place (id, date and source
                                   are preserved)
  add [options] <content>          Add a new lesson
  search [options] <query>         Search lessons by keyword
  graph [options]                  Build a mini-Obsidian concept graph from
                                   lessons
  clear [options]                  Remove lessons (all or by category)
  context                          Preview the lessons context block injected
                                   into each agent turn
  stats                            Show statistics about recorded lessons
  export [options]                 Export lessons to stdout or a file
  provenance [options] <lessonId>  Show what created a lesson and which runs
                                   have used it
  use [options] <lessonId>         Record that a run loaded a lesson (used-by
                                   provenance)
  candidate|candidates             Review queue for proposed lessons
                                   (approve/edit/discard before they reach
                                   lessons.md)
  decay [options]                  Remove old INSIGHT lessons past their age
                                   limit
  help [command]                   display help for command
```

</details>

<details>
<summary><code>buddy spec --help</code> — exit 0</summary>

```text
Usage: buddy spec [options] [command]

Spec-driven, review-gated work pipeline (durable stories; approve before
implementing)

Options:
  -h, --help        display help for command

Commands:
  init <title...>   Create a spec project and make it active
  list [options]    List spec projects
  status [options]  Show sprint status of the active (or --project) project
  plan              Agentic, phased, review-gated planning (PRD → architecture
                    → stories)
  next [options]    Feed the next approved story to the autonomous coding
                    runner (lineage: story → run → outcome)
  story             Manage stories (add, show, approve, start, complete, block,
                    reopen)
  epic              Manage epics
  help [command]    display help for command
```

</details>

<details>
<summary><code>buddy user-model --help</code> — exit 0</summary>

```text
Usage: buddy user-model|usermodel [options] [command]

Local model of the user's working preferences — propose/review (no silent
write, working preferences only)

Options:
  -h, --help                   display help for command

Commands:
  show [options]               Show the active user model (accepted
                               observations)
  list|ls [options]            List observations, optionally filtered by status
  observe [options] <content>  Propose an observation about the user (does NOT
                               write the model)
  accept [options] <id>        Accept an observation into the model (requires a
                               reviewer)
  discard [options] <id>       Discard an observation (removes it from the
                               model if accepted)
  clear [options]              Remove observations (all, or by status)
  analyze [options]            Analyze a session to propose review-gated user
                               preferences
  help [command]               display help for command
```

</details>

<details>
<summary><code>buddy update --help</code> — exit 0</summary>

```text
Usage: buddy update [options]

Update Code Buddy (switch channels: stable, beta, dev)

Options:
  --channel <channel>  Switch update channel (stable, beta, dev)
  --check              Check for updates without installing
  --force              Force reinstall even if up-to-date
  --tag <ref>          Install from GitHub ref (branch or tag, e.g. main,
                       v1.2.3)
  --from-source        Alias for --tag main (install from GitHub main branch)
  -h, --help           display help for command
```

</details>

<details>
<summary><code>buddy tunnel --help</code> — exit 0</summary>

```text
Usage: buddy tunnel [options] [command]

Manage ngrok tunnels for the Code Buddy remote gateway

Options:
  -h, --help       display help for command

Commands:
  start [options]  Start an ngrok tunnel
  help [command]   display help for command
```

</details>

<details>
<summary><code>buddy nodes --help</code> — exit 0</summary>

```text
Usage: buddy nodes [options] [command]

Manage companion app nodes (macOS, iOS, Android)

Options:
  -h, --help                              display help for command

Commands:
  list [options]                          List paired nodes
  pair <platform> <name>                  Request pairing with a new companion node
  approve <code>                          Approve a pending pairing request
  describe <nodeId>                       Show detailed info about a node
  remove <nodeId>                         Remove a paired node
  invoke [options] <nodeId> <capability>  Invoke a capability on a node
  pending                                 List pending pairing requests
  help [command]                          display help for command
```

</details>


<details>
<summary><code>buddy secrets --help</code> — exit 0</summary>

```text
Usage: buddy secrets [options] [command]

Manage API keys and credentials (encrypted vault)

Options:
  -h, --help             display help for command

Commands:
  list                   List all stored secrets (names only)
  set <name> <value>     Set a secret value
  get <name>             Get a secret value
  remove <name>          Remove a secret
  rotate <name> <value>  Mark a secret as rotated (update timestamp)
  audit                  Audit secrets — check for missing, old, or env-only
                         keys
  import-env             Import secrets from current environment variables
  help [command]         display help for command
```

</details>

<details>
<summary><code>buddy approvals --help</code> — exit 0</summary>

```text
Usage: buddy approvals [options] [command]

Manage tool/action approval requests

Options:
  -h, --help              display help for command

Commands:
  list [options]          List approval requests
  approve <id>            Approve a pending request
  deny <id>               Deny a pending request
  policy [action] [mode]  Show or set the approval policy
  help [command]          display help for command
```

</details>

<details>
<summary><code>buddy insights --help</code> — exit 0</summary>

```text
Usage: buddy insights [options] [command]

Token, cost, and activity analytics (read-only)

Options:
  --json             Output machine-readable JSON
  -h, --help         display help for command

Commands:
  summary [options]  Aggregated token/cost/activity overview (default)
  cost [options]     Cost and token breakdown
  tools [options]    Tool usage analytics
```

</details>

<details>
<summary><code>buddy bundles --help</code> — exit 0</summary>

```text
Usage: buddy bundles [options] [command]

Group skills under a single named slash-command bundle

Options:
  -h, --help                          display help for command

Commands:
  list [options]                      List all defined skill bundles
  create [options] <name> <skill...>  Create or replace a bundle from installed
                                      skill IDs
  show [options] <name>               Show the skills in a bundle
  remove [options] <name>             Remove a bundle
  help [command]                      display help for command
```

</details>

<details>
<summary><code>buddy improve --help</code> — exit 0</summary>

```text
Usage: buddy improve [options] [command]

Recursive self-improvement: empirically validate and apply reversible learning
improvements

Options:
  -h, --help                       display help for command

Commands:
  digest [options]                 Summarise recent self-improvement as
                                   readable Markdown, JSON, or a standalone
                                   HTML card
  bench [options]                  Measure active models on the curated
                                   capability benchmark (opt-in)
  status [options]                 Show capability-benchmark coverage, autonomy
                                   mode, archive, and git store versions
  cycle [options]                  Run one improvement cycle (propose →
                                   empirically validate → keep/rollback)
  tools [options]                  Author + behaviorally validate NEW tools for
                                   the agent (held-out gated, anti-gaming)
  skills [options]                 Author + safety-gate NEW skills for the
                                   agent (firewall + coverage)
  skills-list [options]            List installed authored skills (with pinned
                                   status)
  skills-pin [options] <name>      Pin an authored skill (protect it from
                                   curation overwrite/remove/consolidation)
  skills-unpin [options] <name>    Unpin an authored skill
  skills-restore [options] <name>  Restore a previously archived authored skill
  skills-consolidate [options]     Merge overlapping authored skills into one
                                   umbrella (coverage-gated)
  loop [options]                   Run improvement cycles until no further
                                   validated progress is made
  archive [options]                List empirically-validated improvements kept
                                   by the engine
  versions [options]               List git-versioned learning-store states
                                   with their benchmark scores
  restore [options]                Restore the learnable state to a known-good
                                   version (revert to one that works better)
  verify [options] <lesson>        Paired LIVE gate: does a lesson actually
                                   improve behavior? (agent±lesson on graded
                                   tasks, Bayesian)
  rules                            Learn behavioral rules validated against a
                                   labeled trajectory corpus (correctness, not
                                   keywords)
  corpus                           Curate the labeled trajectory corpus the
                                   rule learner validates against
  help [command]                   display help for command
```

</details>

<details>
<summary><code>buddy evolve --help</code> — exit 0</summary>

```text
Usage: buddy evolve [options] [command]

Git-versioned evolutionary self-improvement: evaluate code variants, keep the
best (human-gated)

Options:
  -h, --help             display help for command

Commands:
  list [options]         List evaluated candidate variants, ranked by fitness
  tree                   Show the genealogy of evaluated variants — the
                         generations of recursive self-improvement
  review [options] <id>  Show a variant's fitness + diff vs baseline
                         (read-only)
  keep [options] <id>    Merge a reviewed variant into the CURRENT branch
                         (human-gated; needs --confirm)
  run [options]          Author + evaluate candidate variant(s) toward a
                         weakness (gated by CODEBUDDY_EVOLVE=true)
  help [command]         display help for command
```

</details>

<details>
<summary><code>buddy lsp --help</code> — exit 0</summary>

```text
Usage: buddy lsp [options] [command]

Language Server Protocol diagnostics (type errors, hover, references)

Options:
  -h, --help                    display help for command

Commands:
  status [options]              List supported LSP servers and whether their
                                binaries are installed
  diagnostics [options] <file>  Show diagnostics (type errors / warnings) for a
                                file via the LSP client
  help [command]                display help for command
```

</details>

<details>
<summary><code>buddy proxy --help</code> — exit 0</summary>

```text
Usage: buddy proxy [options]

Start an OpenAI-compatible HTTP proxy in front of Code Buddy (for third-party
clients)

Options:
  --port <port>  proxy port (default: "8787")
  --host <host>  proxy host (default: "127.0.0.1")
  --no-auth      disable JWT authentication (loopback dev only)
  --json         print startup info as JSON
  -h, --help     display help for command
```

</details>

<details>
<summary><code>buddy deploy --help</code> — exit 0</summary>

```text
Usage: buddy deploy [options] [command]

Generate cloud deployment configurations

Options:
  -h, --help                 display help for command

Commands:
  platforms                  List supported cloud platforms
  init [options] <platform>  Generate deployment config for a platform
  nix [options]              Generate Nix flake configuration
  help [command]             display help for command
```

</details>

<details>
<summary><code>buddy backup --help</code> — exit 0</summary>

```text
Usage: buddy backup [options] [subcommand] [args...]

Manage .codebuddy/ backups (create, verify, list, restore)

Options:
  --only-config           Only backup configuration files
  --no-include-workspace  Exclude workspace data
  --output <path>         Custom output directory
  -h, --help              display help for command
```

</details>


<details>
<summary><code>buddy cloud --help</code> — exit 0</summary>

```text
Usage: buddy cloud [options] [subcommand] [args...]

Manage cloud background agent tasks (submit, status, list, cancel, logs)

Options:
  -h, --help  display help for command
```

</details>

<details>
<summary><code>buddy completions --help</code> — exit 0</summary>

```text
Usage: buddy completions [options] [shell]

Generate or install shell completion scripts (bash, zsh, fish, powershell)

Arguments:
  shell       Shell type: bash, zsh, fish, powershell, or "install"

Options:
  -h, --help  display help for command
```

</details>
