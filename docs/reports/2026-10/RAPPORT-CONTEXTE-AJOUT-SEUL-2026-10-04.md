# Rapport — contexte en ajout seul (2026-10-04)

Agent : Grok 4.7. Worktree `/data/patrice/DEV/cb-cache-prefixe-2026-10-04`, branche `perf/cache-prefixe-2026-10-04`.

Départ `01c3452de598ef4d8ed475f028a88943964302c9` (lot préfixe de cache livré, revue « prêt à fusionner », aucun bloquant). Correctif `62336a7f33cad1a73a4ca0aaf791209e43dc8984` (`fix(cache): sceller le contexte variable en ajout seul`). Aucun push. HOME isolé : `_qa/contexte-ajout-seul/home`. Le texte des consignes au modèle n'a pas été réécrit.

Le rapport détaillé (journal de sonde, tableaux complets, mesure des outils) est sous `/home/patrice/Videos/Partage/20261004-grok-contexte-ajout-seul/auteur/RAPPORT.md`. Le journal brut, sans clé, est `probe.jsonl` à côté.

## Correctif

Le préfixe déjà envoyé ne change plus. Le premier tour détache le bloc variable du message 0 (`splitVolatileSuffix`) et le scelle dans l'historique comme un `<environment_context>`. Les tours suivants n'assignent plus `messages[0]`. Un fait nouveau (date, dossier, projet, mémoire, leçon, tâche, JIT) est un message ajouté à la fin, dédoublonné s'il est identique. La compaction (`prepareTurnMessages` / `compactTurnMessagesInPlace`) est le seul moment où ce préfixe peut être réécrit.

Le repère Anthropic marque le dernier message system de tête et, s'il est distinct, le dernier message qui n'est pas une queue `ephemeral="true"`. `src/services/prompt-builder.ts` n'est pas modifié : il émet toujours le bloc variable, l'exécuteur le détache. Dix fichiers, +819 / −23.

## Inventaire

« Réécrit » : le contenu d'un message déjà envoyé change. « Ajoute » : un message nouveau en fin d'historique.

| Élément | Produit dans | Sort | Déjà envoyé ? |
| --- | --- | --- | --- |
| Date, dossier, plateforme, architecture, shell, Node.js, fuseau | `src/prompts/system-base.ts` (`<context>`), aussi `prompt-manager.ts` | Un `<environment_context>` scellé | Non. Réémis seulement si la date, le dossier, ou le projet présent, changent. Une plateforme seule, à date et dossier identiques, ne réémet rien. |
| Ligne `Project:` | Suffixe volatile du prompt | Dans le message d'environnement | Ajout si le projet change. |
| Mémoire persistante | `<persistent_memory>` (`prompt-builder`) | `appendMemoryIfChanged`, sans la ligne `Project:` | Ajout si le texte n'est pas déjà dans un message system. |
| CODEBUDDY.md et JIT | `src/context/jit-context.ts` | Sceau | Ajout. Doublon exact retiré. |
| `<lessons_context>` | `lessons-tracker.ts`, enveloppe `<context type="lessons">` | Sceau | Ajout, dédoublonné. |
| `<todo_context>` | `getTodoTracker(cwd).buildContextSuffix()` | Sceau. Le cache 5 s est vidé par `add`. | Ajout, dédoublonné. |
| `<runtime_settings ephemeral="true">` | `runtime-settings-context.ts` | Scellé (pas une queue jetée), puis dédoublonné | Ajout. Le repère Anthropic ne le marque pas en queue. |
| `<workspace_context>` | `injectInitialContext`, premier tour. Vide sous Vitest. | Sceau | Ajout au premier tour. |
| Indices de middleware | `<context type="middleware-hint">` | Historique | Ajout. |
| Liste d'outils RAG | `clearCache()` à chaque message utilisateur (`codebuddy-agent.ts`) | Argument `tools` | Ne réécrit pas l'historique. Gel par requête et ses tours d'outils, pas d'une question à l'autre. |
| Résumé de compaction | `context-pipeline.ts` | Remplace le transcript | Oui. Seule réécriture permise. |
| Ton du tour, fichier mentionné, bloc compagnon | `ephemeral="true"`, `file_mention`, `companion_current_turn_context` | Copie envoyée, pas l'historique | Non écrits. Hors du préfixe persistant. |

Ollama, LM Studio et vLLM passent par `mergeSystemMessagesToFront` et restent hors contrat. OpenRouter laisse les messages en place : c'est le chemin mesuré. `--continue` / `--resume` relancent un processus ; `restoreSessionHistory` ne restaure pas les messages system, et `systemPrefixSealed` repart à faux. Le sceau tient dans un processus, pas d'un `buddy -p` à l'autre.

## Preuves

Avant le correctif, worktree détaché `01c3452de`, `npx vitest run tests/agent/execution/append-only-prefix.test.ts` : échec en 188 ms, `la requête 2 ne commence pas par la requête 1`. L'environnement du tour 1 n'était pas gardé ; la réponse `ok` prenait sa place.

Après : le même test est dans la suite verte. Cinq requêtes, chacune commence par la précédente, octet pour octet (`JSON.stringify` du préfixe). Le dossier, la date `2026-12-15`, la mémoire et la tâche n'apparaissent qu'après le changement, à la fin. Le message 0 du tour 5 est celui du tour 1.

| Commande | Résultat |
| --- | --- |
| `npm test -- tests/services tests/agent tests/context tests/prompts` | 326 fichiers, 3852 tests, verts. 139,9 s. |
| `npm run lint` | 0 erreur, 2601 avertissements déjà présents. Code 0. |
| `npm run typecheck` | Code 2. Seulement `src/companion/core-adapter.ts`, `TS2307` `@phuetz/companion-core`, deux lignes. Déjà là au lot précédent. |
| `npm run build` | Code 2. Les deux mêmes `TS2307`. `tsc` s'arrête avant la copie des assets. |

## Mesures

Sonde : environnement du lanceur `buddy-openrouter.sh` rejoué sur ce worktree (`tsx src/index.ts`), lanceur non modifié. `OPENROUTER_PROVIDER_ORDER=Together` est un contrôle ; le défaut du produit reste vide. Modèle `deepseek/deepseek-v4.1-flash`, `--permission-mode plan`, phrase « Réponds uniquement le mot ok. ». Together sur les 16 appels. Avant = worktree détaché `01c3452de`.

Deux dossiers, même `calc.js`. Empreinte du premier message inchangée depuis le lot 1 (`698d9bbc7721`), outils `104cf936b44a`.

| Run | prompt | cached | taux | coût |
| --- | --- | --- | --- | --- |
| avant-a (froid) | 8483 | 0 | 0 % | 0,0025485 $ |
| avant-b | 8483 | 8320 | 98,1 % | 0,00010242 $ |
| apres-a (cache encore chaud) | 8493 | 8320 | 98,0 % | 0,00010542 $ |
| apres-b | 8493 | 8320 | 98,0 % | 0,00010542 $ |

Les 10 jetons de plus sont l'enveloppe `<environment_context>`, pas un second prompt.

Six tours, un seul processus (un `buddy -p` ne fait qu'un tour, et `--continue` ne restaure pas les messages system). Même phrase, outils `6e3856aa7b67`. Au tour 4 : autre dossier, `CODEBUDDY_MEMORY.md`, une tâche. Six réponses `ok`.

| Tour | Avant, sys / cached | Après, sys / cached |
| --- | --- | --- |
| 1 | `43edb4a533c7`, 0/9790 (0 %) | `43edb4a533c7`, 9600/9798 (98,0 %, chaud) |
| 2 | idem, 9216/9805 (94,0 %) | idem, 9728/9813 (99,1 %) |
| 3 | idem, 9344/9820 (95,2 %) | idem, 9728/9828 (99,0 %) |
| 4 | **`be57ac887b9c`**, 2944/9940 (**29,6 %**, 0,00215 $) | **`43edb4a533c7`**, 9728/10085 (**96,5 %**, 0,000188 $) |
| 5 | `be57ac887b9c`, 9344/9955 (93,9 %) | idem, 9984/10100 (98,9 %) |
| 6 | `be57ac887b9c`, 9344/9970 (93,7 %) | idem, 9984/10115 (98,7 %) |

Le tour 4 est celui qui compte : avant, le premier message change et le cache tombe à 29,6 % ; après, l'empreinte ne bouge pas, 96,5 % restent en cache (environ 11 fois moins cher), et les messages passent de 8 à 13. La sonde ne hache que le premier message ; le taux de jetons en cache prouve que le préfixe entier a été réutilisé.

## Tête

Correctif, 40 caractères : `62336a7f33cad1a73a4ca0aaf791209e43dc8984`.

Le commit documentaire (ce fichier et la ligne de coordination) est le successeur immédiat sur `perf/cache-prefixe-2026-10-04`.

## Ce que je n'ai pas pu vérifier

- Le taux de cache Anthropic en vrai : aucun appel Claude. Seul le placement du repère est testé.
- `--continue` / `--resume` d'un processus à l'autre : non mesuré, non corrigé.
- Ollama, LM Studio, vLLM : non remesurés.
- Un changement de date sur la sonde réelle (même jour calendaire). La date est couverte par le test des cinq tours.
- Windows.
- `npm run typecheck` et `npm run build` entièrement verts : `@phuetz/companion-core` est absent, comme avant.
- Que le modèle a lu le nouveau dossier : il a répondu `ok`. Les faits sont prouvés par le test unitaire.
- Le défaut produit de `OPENROUTER_PROVIDER_ORDER` reste vide. Together est un contrôle des deux côtés.

## Mesure des outils

HOME de LM Resizer : `_qa/contexte-ajout-seul/home`. `lm-resizer stats --json` : 9 commandes, 579915 octets bruts, 579769 réduits, 146 économisés ; 218403 jetons bruts, 218334 réduits, 69 économisés. Aucune vue réduite n'a caché un total utile (326/3852, 0 erreur / 2601 avertissements, les deux `TS2307`). `tee read` n'a pas été nécessaire.

Code Explorer : index déjà à jour (`status`, pas de `analyze`). 1 requête, 0 fichier épargné. Défaut : `code-explorer query "How does the CLI resume or continue an existing session across process invocations? --resume --continue session id"` a renvoyé l'interpréteur, l'export de session et Cowork, pas `--resume` / `--continue` de `src/index.ts` (vers 1712 et 2010).

Défaut voisin, LM Resizer : `lm-resizer exec -- npm run lint` retire 34 octets sur 474989. Le filtre `lossless:npm-test` sur le vitest du préfixe n'en retire aucun (2730 → 2730).
