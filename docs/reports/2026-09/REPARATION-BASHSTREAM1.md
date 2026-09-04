# RÉPARATION BASHSTREAM1 — `bash` échoue « Streaming execution error: Unexpected end of JSON input » en headless sur MiniMax M3 (GMI)

Statut : TERMINÉ (04/09/2026). Commits : `3e8e9a746` (correctif), `9d24b9839` (test), (ce commit) documentaire.

## Mission

Source : `~/DEV/vitrine-drafts/vague-2026-09-04/MISSION-BASHSTREAM1-ARGUMENTS-VIDES-MINIMAX.md`.
Clone : `~/DEV/cb-bashstream1-2026-09-04`, branche `fix/bashstream1-arguments-vides-2026-09-04` (base `f42783007`).

## Constat de départ (mesuré par la lane PRIV3, 04/09/2026 07 h 08)

Journal : `~/.codebuddy/delegations/2026-09-04T070809-gmi-MISSION-PRIV3-RESIDUS-AGYSEC2.log`.
Sept fois de suite : `⚠️ WARN [notification] bash failed: Streaming execution error: Unexpected end of JSON input`, puis `Auto-repair attempt N/3`. Les autres outils du même tour (`view_file`, `create_file`, `str_replace_editor`) réussissaient.

Moteur : `GROK_BASE_URL=https://api.gmi-serving.com/v1`, modèle `MiniMaxAI/MiniMax-M3`, clé `GMI_API_KEY` dans `~/.codebuddy/media.env` (lecture seule ; GMI illimité jusqu'au 06/09).

## Cause exacte

**`src/agent/streaming/message-reducer.ts:29-38`** (avant correctif), fonction `reduceStreamChunk` / `reduce`.

Quand un delta introduit une clé tableau (`tool_calls`) pour la **première fois** dans l'accumulateur (`acc[key] === undefined`), l'ancien code faisait un **assignement direct par position de tableau** :
```ts
if (acc[key] === undefined || acc[key] === null) {
  acc[key] = value;                 // toute l'array du delta, telle quelle
  if (Array.isArray(acc[key])) {
    for (const arr of acc[key]) delete arr.index;   // le champ `index` est juste effacé…
  }
}
```
… au lieu de router par le champ `index` porté par chaque élément, comme le faisait déjà (depuis un correctif antérieur, VAGUE précédente) la branche « clé déjà connue » (lignes 41-60 de l'ancien fichier).

Cela fonctionne tant que le **premier** appel d'outil streamé par le fournisseur porte `index: 0` (le cas OpenAI/Grok/la plupart des fournisseurs). **MiniMax/GMI numérote ses `tool_calls` à partir de 1, jamais de 0** (mesuré : `view_file` → `index:1`, `bash` → `index:2`, `create_file` → `index:3`, aucun `index:0`). Le premier appel (par ex. `view_file` ou `bash` selon l'ordre choisi par le modèle) atterrit donc en **position de tableau 0** lors de ce premier assignement direct, mais ses deltas de continuation (le fragment `arguments`) portent `index: 1` et sont fusionnés par la branche par-index dans un **tout autre emplacement** (position 1) — un objet orphelin sans `name`/`id`. Résultat : le premier appel d'outil du tour garde `function.arguments === ""` **en permanence**, et l'objet orphelin qui contient le vrai texte des arguments est éliminé plus loin (le filtre `isIgnorableControlToolCall`/le test `hasCompleteTool` exigent un `function.name`).

Downstream, `JSON.parse(toolCall.function.arguments)` sans filet (`src/agent/tool-handler.ts:1470`, `executeStreamingBash` ; et `src/agent/tool-handler.ts:569`, `executeTool`) reçoit une chaîne vide → `SyntaxError: Unexpected end of JSON input` → capturé et reformaté en `Streaming execution error: …` (site bash) ou `Tool execution error: …` (site générique). Dans le journal PRIV3, `bash` était systématiquement le PREMIER appel du tour → touché sept fois de suite ; dans nos essais avec 3 appels parallèles (`view_file`, `bash`, `create_file`), c'est `view_file` (premier de la liste) qui échoue, jamais `bash`/`create_file` — confirmant que le défaut touche « le premier appel d'outil du tour », pas spécifiquement `bash`.

## Reproduction (preuve AVANT, appels réels GMI)

Commande de la mission (un seul outil, `bash` seul) a d'abord réussi (le seul appel du tour porte alors `index:0` chez MiniMax aussi — collision inoffensive). La reproduction fiable exige **plusieurs appels d'outils en parallèle dans le même tour**, exactement le scénario PRIV3 :

```
GROK_API_KEY=<clé GMI> GROK_BASE_URL=https://api.gmi-serving.com/v1 \
node_modules/.bin/tsx src/index.ts -m MiniMaxAI/MiniMax-M3 --permission-mode dontAsk \
  -p "Regarde le contenu du fichier package.json avec l'outil view_file, puis exécute la commande shell \`echo bonjourN\` avec l'outil bash, puis crée un fichier tN.txt avec l'outil create_file contenant le mot test, puis dis-moi ce que bash a affiché"
```

5 essais sur ce prompt (essais 2, 4, 5, 6 sur 7) ont produit l'échec, **toujours sur le premier outil de la liste (`view_file`)**, jamais sur les suivants :
```
⚠️ WARN  Tool error {"tool":"view_file","toolCallId":"call_...","error":"Unexpected end of JSON input"}
⚠️ WARN  [notification] view_file failed: Tool execution error: Unexpected end of JSON input
```
Message final produit (extrait, essai 2) : `"tool_calls":[{"id":"call_function_hmdtzwhxo1xm_1","function":{"name":"view_file","arguments":""}}, {"id":"...","function":{"name":"bash","arguments":"{\"command\": \"echo bonjour\"}"}}, ...]` — `view_file` a bien `arguments:""`, `bash` et `create_file` sont corrects.

**Deltas bruts capturés** (instrumentation temporaire retirée avant commit, `CODEBUDDY_DEBUG_RAW_STREAM=<fichier>` dans `provider-openai-compat.ts`, essai « bonjour4 ») :
```json
{"index":1,"id":"call_01a06ada19537ba3b4f09b5b","type":"function","function":{"name":"view_file","arguments":""}}
{"index":1,"function":{"arguments":"{\"path\":\"/home/patrice/DEV/cb-bashstream1-2026-09-04/package.json\"}"}}
{"index":2,"id":"call_01a06ada19537ba3b4f09b6a","type":"function","function":{"name":"bash","arguments":""}}
{"index":2,"function":{"arguments":"{\"command\":\"echo bonjour4\"}"}}
{"index":3,"id":"call_01a06ada19537ba3b4f09b79","type":"function","function":{"name":"create_file","arguments":"..."}}
```
→ confirme : pas d'`index:0`, la numérotation MiniMax commence à 1.

## Correctif

`src/agent/streaming/message-reducer.ts` — la branche « la clé n'existe pas encore dans l'accumulateur » ne fait plus d'assignement direct par position pour un **tableau** : elle route désormais, dès le premier delta, par le même mécanisme « fusion par `index`, repli sur la position dans CE delta » que les deltas suivants. Un fournisseur qui démarre à `index:0` (le cas courant) se comporte exactement comme avant (0 tombait déjà en position 0). Un fournisseur qui démarre à un `index` non nul (MiniMax/GMI) place désormais chaque appel d'outil dans le bon emplacement dès la première frappe, sans « trou » ni objet orphelin.

## Test rouge → vert

`tests/agent/streaming/message-reducer-parallel-tool-calls.test.ts` — nouveau cas « accumulates the first tool call correctly when the provider numbers tool_calls starting at 1, not 0 (MiniMax/GMI, BASHSTREAM1) », rejouant exactement la séquence de deltas ci-dessus.

- **Avant correctif** (reducer stashé, `git stash push -- src/agent/streaming/message-reducer.ts`) : `npx vitest run tests/agent/streaming/message-reducer-parallel-tool-calls.test.ts` → **1 test rouge sur 5** (`expected … to have a length of 3 but got 4` — l'objet orphelin apparaît comme 4ᵉ élément).
- **Après correctif** : **5 tests verts sur 5**, y compris les 4 tests préexistants (non-régression sur le cas `index:0` déjà couvert par une VAGUE antérieure).

## `npx vitest run tests/agent tests/codebuddy` (compte exact)

- **Avant correctif** (reducer stashé) : `Test Files 1 failed | 226 passed (227)` / `Tests 1 failed | 2970 passed (2971)`.
- **Après correctif** : `Test Files 227 passed (227)` / `Tests 2971 passed (2971)`.

Seul le nouveau test bouge entre les deux mesures — aucune régression ailleurs.

## `npx tsc --noEmit -p tsconfig.json`

Exit 0, 0 erreur.

## ESLint ciblé

`npx eslint src/agent/streaming/message-reducer.ts src/codebuddy/providers/provider-openai-compat.ts tests/agent/streaming/message-reducer-parallel-tool-calls.test.ts` → exit 0, 0 erreur.

## `git diff --check`

Exit 0, propre.

## Preuve APRÈS (appels réels GMI)

Commande exacte de la mission (un seul appel `bash`) : succès, comme avant correctif (cas non affecté) —
`"tool_calls":[{"function":{"name":"bash","arguments":"{\"command\": \"echo bonjour\"}"}}]`, résultat `"La commande a affiché :\n\n\`\`\`\nbonjour\n\`\`\`"`.

Scénario qui reproduisait l'échec (3 outils en parallèle, `view_file` en premier) rejoué **5 fois** après correctif : **0 échec sur 5** (`grep -c "Unexpected end of JSON input"` sur la sortie combinée des 5 essais → `0`). `view_file` retourne désormais le contenu réel de `package.json`, `bash` affiche `bonjourN`, `create_file` crée `tN.txt` — les trois systématiquement.

## Instrumentation temporaire

Un dump JSONL des deltas bruts (`CODEBUDDY_DEBUG_RAW_STREAM=<chemin>` dans `src/codebuddy/providers/provider-openai-compat.ts`, boucle `for await (const chunk of stream)`) a servi à capturer la preuve ci-dessus. **Retiré avant tout commit** (`git diff --stat` confirme ce fichier revenu à l'identique de la base).

## Commits

1. `fix(agent): réparer l'accumulateur de deltas streaming pour un index de départ non nul` — `src/agent/streaming/message-reducer.ts`.
2. `test(agent): rejouer la séquence de deltas MiniMax/GMI (BASHSTREAM1)` — `tests/agent/streaming/message-reducer-parallel-tool-calls.test.ts`.
3. `docs(bashstream1): réservation, rapport et bilan` — `.gitignore`, `docs/FABLE5-CODEX-COORDINATION.md`, ce rapport.

(SHA insérés après commit, voir bilan final transmis à l'appelant.)

## Ce qui reste ouvert

- Le défaut touchait en réalité « le premier appel d'outil du tour » chez MiniMax, pas spécifiquement `bash` — `bash` n'était que la victime la plus fréquente dans le journal PRIV3 parce qu'il était systématiquement le premier outil appelé dans ces tours-là. Le correctif est générique (accumulateur), pas un patch bash-only.
- Non vérifié : le comportement d'autres fournisseurs GMI/OpenAI-compat dont l'indexation `tool_calls` démarrerait ailleurs qu'à 0 ou 1 (ex. commencerait à 2, ou serait discontinue) — le correctif les couvre par construction (fusion toujours par `index`), mais aucun autre fournisseur de ce type n'a été observé en conditions réelles pendant cette mission.
- Pas de test end-to-end headless automatisé contre GMI (appel payant/réseau réel) — la preuve avant/après ci-dessus est manuelle, capturée dans ce rapport ; le test unitaire rejoue la séquence de deltas exacte mais ne refait pas l'appel réseau.
