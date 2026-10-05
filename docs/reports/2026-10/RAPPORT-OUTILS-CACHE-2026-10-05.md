# MISSION 03 — La liste d’outils change-t-elle entre deux questions, et que coûte-t-elle au cache ?

Worktree : `<dev>/cb-outils-cache-2026-10-05`
Branche : `perf/outils-fixes-cache-2026-10-05`
Tête de départ (candidate `integration/2.3.0-candidate-2026-10-05`) : `08950a208d583847d7b82c52460865c67370f43e`
Tête finale de la branche avant ce rapport : `c2caf98a1` (`perf(tools)` → `fix(tools)` → ce rapport).
Moteur auteur : DeepSeek 4.1 Flash via opencode-go. Revue : Grok.
Aucun push.

## Résumé

**Le bris existe et il est net.** En configuration actuelle (A), la liste d’outils
change à chaque question — 5 listes distinctes pour 5 questions — et le taux de
cache du **premier accès de chaque tour 2 à 5** tombe à **0,555** (moyenne).
Avec le noyau fixe (`CODEBUDDY_TOOLS_FIXED=true`), la liste est **identique sur
les 5 tours** et le taux monte à **0,971**. La variante `append` laisse un noyau
stable en tête mais **n’améliore pas le cache** (0,568) : le suffixe choisi par la
question précède le bloc des messages dans la requête, donc il invalide aussi le
préfixe de messages. Coût mesuré : ~2 816 jetons de préfixe non réutilisés par
tour sous A (et sous append) que le noyau fixe, lui, réutilise.

## Dispositif de mesure

- **Moteur** : `deepseek/deepseek-v4.1-flash` via OpenRouter. Clé lue dans
  `~/.codebuddy/media.env`, exportée en `GROK_API_KEY` / `GROK_BASE_URL`
  (jamais `-k/-u`).
- **Routage fournisseur** : `OPENROUTER_PROVIDER_ORDER=Wafer`,
  `OPENROUTER_PROVIDER_ONLY=Wafer`, `OPENROUTER_PROVIDER_ALLOW_FALLBACKS=false`.
  `servi_par` de la sonde = **Wafer sur 94/94 requêtes** des 9 runs.
  Motif : le fournisseur `DeepSeek` (le seul à `supports_implicit_caching: true`)
  est **exclu par l’entrée de compte** ; message d’erreur entier :
  `CodeBuddy API error: 404 0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy. We removed them for the following reasons (an endpoint may have matched multiple reasons): Paid model training violation (account settings): 1 endpoint excluded; configurable at https://openrouter.ai/settings/privacy`
  `Wafer` rapporte bien des jetons en cache (`prompt_tokens_details.cached_tokens`).
- **Un processus, cinq questions** via `agent.processUserMessage()` cinq fois
  (le lot Grok le note : `-p` ne fait qu’un tour par processus). Liste des
  questions (fichier de données du harnais `_qa/outils-cache/harness.mts`) :
  1. lecture de fichier (`Lis le fichier src/utils/logger.ts …`),
  2. recherche (`Cherche ou est defini clearCache …`),
  3. édition (`remplace la ligne BONJOUR par BONSOIR …`),
  4. texte sans outil (`Explique … un cache de prompt depend du prefixe …`),
  5. contient « navigateur » (`Ouvre mon navigateur et va sur https://example.com …`).
- **Sonde** : `~/.local/share/flotte-pilote-opus/cache-buddy-hook.mjs` avec
  `CACHE_BUDDY_LOG` propre à la mission. Une **sur-couche locale** (dans le
  harnais) attache chaque requête à son tour (`toolSearch`, jetons, fournisseur)
  pour éviter tout appariement fragile par ordre.
- **HOME isolé** `_qa/outils-cache/home` ; `CODEBUDDY_DISABLE_MCP=true` (aucun
  serveur MCP joignable en bac) ; `CODEBUDDY_AUTO_CONFIRM=true`.
- **3 répétitions** par variante ; chaque répétition = nouveau processus.
  `maxToolRounds=3`. Total : 9 runs, 94 requêtes fournisseur, 0 tour en erreur.

## Tableau A / fixe / append

Moyennes sur 3 répétitions. « Taux premier accès » = `cached / prompt` de la
première requête du tour (c’est lui qui dit si le préfixe du tour précédent a
été réutilisé). « Global » = `Σcached/Σprompt` sur toutes les requêtes du tour.

| Indicateur | A (actuel) | `true` (noyau fixe) | `append` |
|---|---|---|---|
| Empreintes distinctes (5 tours) | **5** (`fa7d…`,`9ea5…`,`8f58…`,`a96d…`,`7d76…`) | **1** (`ae10c7518191`) | **5** (`720e…`,`9834…`,`9bfe…`,`dbb4…`,`b544…`) |
| Noyau de tête identique | non | oui | oui (16/16 vérifiés sur 15 tours) |
| Outils par requête | 20 | 16 | 21 |
| Jetons d’outils / requête (est. dépôt) | 3 576–3 971 | **2 912** | 3 650–4 045 |
| Taux premier accès, tours 1–5 (moy.) | 0,509 | **0,947** | 0,579 |
| **Taux premier accès, tours 2–5 (moy.)** | **0,555** | **0,971** | **0,568** |
| Taux global, tous appels (moy.) | 0,653 | 0,833 | 0,722 |
| Jetons de prompt moyens / requête | 13 487,6 | 13 234,4 | 13 786,0 |
| Jetons en cache moyens / requête | 9 296 | **10 816** | 10 363,9 |
| Appels `tool_search` | 2 | 4 | 0 |
| Outil nécessaire resté introuvable | aucun | aucun | aucun |

Détail par tour (taux premier accès, moyenne des 3 répétitions) :

| Tour | A | fixe | append |
|---|---|---|---|
| 1 | 0,324 | 0,852 | 0,623 |
| 2 | 0,674 | 0,986 | 0,629 |
| 3 | 0,415 | 0,930 | 0,533 |
| 4 | 0,547 | 0,989 | 0,552 |
| 5 | 0,583 | 0,979 | 0,559 |

Variance inter-répétitions (tours 2–5, premier accès) : lisible dans
`logs/req-*.jsonl`. A = `T2 0,67/0,67/0,67`, `T3 0,34/0,34/0,56` ; fixe =
`T2 0,98/0,99/0,99`, `T3 0,92/0,96/0,91` ; append = `T2 0,63/0,63/0,63`,
`T3 0,59/0,56/0,45`. Le tour 1 est le plus variable (cache fournisseur
partagé entre répétitions, `T1` A = 0,00/0,00/0,97) : la conclusion porte donc
sur les tours 2–5, mesurés à l’intérieur de chaque processus.

## Preuve avant de s’en servir (tâche 4)

Fichier `tests/agent/execution/tool-selection-fixed.test.ts`, **24 tests verts** :

- `resolveFixedToolsMode` : `undefined`/`''`/`false`/`0`/`off` → `off` ;
  `true`/`1`/`on`/`yes`/`core` → `core` ; `append` (casse/espaces tolérés) → `append`.
- **byte-identique hors drapeau** : `getRelevantTools` est bien appelé et son
  résultat retourné tel quel quand `CODEBUDDY_TOOLS_FIXED` est absent.
- **A varie, fixe non** : la même stratégie rend `[view_file]` puis `[bash]` sur
  deux questions sous A, et la même liste sous `true` — c’est le test qui
  « échoue sur l’ancienne logique et passe sous fixe ».
- **ordre** : noyau fourni en ordre inversé dans le registre → la sélection
  ressort dans l’ordre du fichier de données.
- **surface** : `bash` retiré par la surface ne réapparaît **jamais** via le
  noyau (test dédié) ; `allowedToolNames` et le filtre de capacité modèle
  s’appliquent après le noyau.
- **`append`** : les 16 premiers noms sont exactement le noyau, les outils de la
  question sont ajoutés à la fin, sans doublon.
- **alwaysInclude appelant** (flotte/`lite`/`restore_context`) est conservé
  après le noyau.

**Mutation** : en remplaçant `selectFixedCoreTools` par
`available.filter(t => FIXED_TOOL_CORE.includes(name))` (ordre du registre),
**2 tests rougissent** (« ordre » et « true sert le noyau ») ; restauré, 24/24
verts. Trace : `logs/` et §Mesure des outils.

**Re-vérification à la reprise (2026-10-05 07:05)** :
`npx vitest run tests/agent/execution/tool-selection-fixed.test.ts` →
`1 passed / 24 passed` en 576 ms. L’analyse `_qa/outils-cache/analyse.json` et
les journaux `logs/req-*.jsonl` ont été relus : les chiffres du tableau sont
reproductibles depuis les traces brutes.

## Implémentation (tâche 2)

- `CODEBUDDY_TOOLS_FIXED` : **non positionné = comportement historique**
  (sélection RAG par question, byte-identique) ; `true`/`1`/`on`/`yes`/`core` =
  noyau fixe seul ; `append` = noyau puis outils de la question en fin de liste.
- Noyau **défini dans un fichier de données** `src/tools/fixed-tool-core.ts`
  (aucune logique), **ordonné** : `view_file, list_directory, search,
  create_file, str_replace_editor, apply_patch, bash, web_search, tool_search,
  restore_context, remember, memory_propose, lessons_add, lessons_propose,
  lessons_search, extension_forge`.
- Les autres outils restent atteignables : `getAllCodeBuddyTools` indexe tous
  les outils pour `tool_search`, et `expandCachedTools` ajoute l’outil découvert
  au tour courant. Mesure : 4 appels `tool_search` sous fixe (questions
  « navigateur »), aucun « No tools found », aucun outil manquant signalé
  (`getMostMissedTools` vide).
- Branchement dans
  `src/agent/execution/tool-selection-strategy.ts` `selectToolsForQuery`, **avant**
  les filtres existants (capacité modèle, `code_exec` off, `allowedToolNames`,
  skill) qui restent donc appliqués à la sortie. Échec du noyau → repli RAG.

## Barrière

- `npm run typecheck` : **0 erreur**.
- `npm run lint` : **0 erreur**, 2 602 avertissements préexistants.
- `npm test -- tests/codebuddy tests/agent tests/tools` : **498/499 fichiers**,
  `5 586 passés / 2 échoués / 1 ignoré`. Les 2 échecs sont dans
  `tests/tools/lessons-tools.test.ts` (résolution du compilateur TypeScript
  local : `tsc not found in node_modules/.bin` attendu, mais un `tsc` global a
  répondu avec son `--help`). Fichier non touché par la mission ; le chemin
  par défaut (drapeau absent) est inchangé — échec environnemental.
  Message d’erreur entier :
  `AssertionError: expected '❌ **typescript**: FAIL\n...(truncated…' to contain 'tsc not found in node_modules/.bin'`
  et `AssertionError: expected false to be true // Object.is equality`.

## Verdict (sur le CACHE seulement)

1. **Le bris existe.** Sous A, la liste d’outils est figée pour une question et
   ses tours d’outils, mais **change à chaque nouvelle question** : 5 empreintes
   distinctes pour 5 questions, y compris entre deux questions d’un même type.
2. **Combien.** Premier accès des tours 2–5 : A = **0,555** de cache ;
   noyau fixe = **0,971**. Écart ≈ **0,42 point de taux**, soit ≈ **2 816 jetons
   de préfixe re-facturés par tour** (fixe T2 = 11 264 en cache contre A T2 =
   8 448, à prompt ≈ 11,4–12,5 k).
3. **`append` ne corrige pas le cache** (0,568) bien que le noyau soit
   identique en tête sur les 15 tours mesurés : le suffixe par question est
   inséré avant le bloc des messages, donc il déplace tout ce qui suit. Utile
   seulement si l’on veut garder la sélection par question à moindre coût de
   préfixe (le noyau partagé reste caché), pas pour supprimer le bris.
4. **Bonus de taille** : le noyau fixe envoie 16 schémas / ≈ 2 912 jetons contre
   20 schémas / ≈ 3 576–3 971 jetons sous A (les autres outils restant
   atteignables par `tool_search`).

Cette mission **ne tranche pas la réussite** des tâches : c’est la phase 2, sur
le banc de la mission 02, avec un petit modèle local **et** un gros.

## Ce que je n’ai pas pu vérifier

- **La réussite des tâches** (aboutissement, qualité) : non mesurée ici ; phase 2.
- **Le petit modèle local** (qwen3:4b / tunnel Darkstar) : non exécuté dans
  cette session ; seul un gros modèle via OpenRouter a été mesuré.
- **Anthropic / Gemini** : non mesurés — cache et ordre `tools` du transport
  propres à chaque fournisseur.
- **Le fournisseur DeepSeek** (seul à `supports_implicit_caching: true`) : exclu
  par le garde-fou de compte ; le cache observé est celui de Wafer.
- **MCP activé** : les runs sont faits `CODEBUDDY_DISABLE_MCP=true` ; les outils
  MCP pourraient changer les empreintes sans changer la conclusion.
- **Windows / macOS**, et le **cache cross-session** réel : le tour 1 varie
  (partage de cache Wafer entre répétitions) ; les tours 2–5 sont, eux, nets.

## Mesure des outils

**Code Explorer** — défaut rencontré. Le dépôt n’était pas indexé
(`code-explorer status` → `NOT INDEXED`). `code-explorer analyze .` lancé en
arrière-plan a été **tué avec le shell** au bout du délai de 120 s de l’outil
bash, sans progression réutilisable :
`Candidates: 7621 parseable of 9952 files walked (0.05s)` puis plus rien ; il
n’existe pas de moyen documenté de le laisser tourner entre deux appels. Résultat :
**0 requête `code-explorer query` utile**, 0 fichier épargné, l’index n’a jamais
été disponible. Reproduire : `nohup code-explorer analyze . &` puis attendre plus
de 120 s dans une même commande.

**LM Resizer** — 4 appels `exec` : `npm run typecheck` (×2, l’un pour attraper
les 4 `TS2454`), `npm run lint`, `npx vitest run tests/…`. Un identifiant `tee`
vu : `[tee:e458bf95fa9a]` (typecheck). La vue réduite n’a **rien caché d’utile** :
les erreurs `TS2454`, le résumé ESLint (`✖ 2602 problems (0 errors…)`), le
résumé Vitest (`498/499`, `5586 passed`) et les deux `AssertionError` complets
sont restés visibles ; la relecture ciblée du fichier de test en échec a suffi
(42/44 verts, 2 rouges environnementaux). `lm-resizer stats --json` du HOME
courant : `commands=99508`, `original_bytes=867746851`,
`compressed_bytes=518805185`, `bytes_saved=351112988`,
`tokens_saved=17248594` (historique global du HOME, non attribuable à la
mission) ; le HOME isolé `_qa/outils-cache/home` affiche 0 entrée (les appels
`lm-resizer` n’ont pas été faits sous ce HOME).
