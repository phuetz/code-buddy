# Réparation R24 — Fournisseurs ChatGPT Responses et OpenAI-compatible

Date : 2026-09-02

Dépôt : `/home/patrice/DEV/cb-repar-providers-2026-09-02`

Branche : `fix/repar-providers-2026-09-02`

## Coordination et périmètre

`docs/FABLE5-CODEX-COORDINATION.md` a été lu avant les modifications. Aucun
chantier `R24` n’y est inscrit. La mission interdit de modifier ce fichier ; la
réservation de la zone est donc consignée ici : fournisseurs ChatGPT Responses
et OpenAI-compatible, plus leurs tests ciblés.

`AUDIT-A-REPARER.md` a été lu intégralement. Il confirme les six chemins D1–D6
et leurs sondes faux-SSE/faux-fournisseur. Aucun réseau, appel LLM ou service
n’a été utilisé. `ComfyUI` et les autres services en cours n’ont pas été
touchés.

Fichiers sales préexistants laissés hors commits : `AUDIT-A-REPARER.md` non
suivi et `node_modules` non suivi. `docs/FABLE5-CODEX-COORDINATION.md` est
intact.

## Correctifs

| D | Correctif | Commit |
|---|---|---|
| D1 | Le parser rejette le JSON SSE malformé, `type: "error"` et toute fermeture sans événement terminal ; plus de `stop` fabriqué. | `fix(providers): fermer les faux succès SSE Codex` |
| D2 | `TextDecoder` est flushé à la fin du body et le reliquat sans `\n\n` est rejoué dans le parseur commun. | `fix(providers): traiter le dernier événement SSE Codex` |
| D3 | `response.incomplete` devient `finish_reason: 'length'` avec `truncated: true`, conservé par `chat()`. | `fix(providers): signaler les réponses Codex tronquées` |
| D4 | Une recherche xAI demandée mais non supportée déclenche un `warn` visible ; `chat()` et les chunks portent `searchHonored: false`, tout en omettant le champ legacy incompatible. | `fix(providers): signaler les réponses xAI sans recherche` |
| D5 | Le remap non-Codex nomme explicitement le slug demandé et le modèle réellement utilisé dans un `warn`; body, chunks et `chat()` exposent le modèle effectif. | `fix(providers): avertir du remap de modèle Codex` |
| D6 | `choices: []` et les réponses fournisseurs vides sont rejetés par `chat()`/`chatStream()` avec `réponse vide du fournisseur`; le fallback d’un itérateur vide est averti. | `fix(providers): refuser les réponses fournisseurs vides` |

## Preuves rouge → vert

Les tests ont été ajoutés avant le correctif correspondant. Les sorties
ci-dessous sont les résumés exacts des commandes exécutées ; aucun `npm test`
global n’a été lancé.

### D1 — faux flux SSE

```text
$ npx vitest run tests/codebuddy/providers/provider-chatgpt-responses.test.ts --reporter=verbose
Test Files  1 failed (1)
Tests  3 failed | 55 passed (58)
```

Après correction :

```text
Test Files  1 passed (1)
Tests  58 passed (58)
```

### D2 — dernier événement sans ligne vide

```text
$ npx vitest run tests/codebuddy/providers/provider-chatgpt-responses.test.ts -t "final SSE event" --reporter=verbose
Test Files  1 failed (1)
Tests  1 failed | 58 skipped (59)
Error: ChatGPT Responses stream ended without a terminal event
```

Après correction :

```text
Test Files  1 passed (1)
Tests  1 passed | 58 skipped (59)
```

### D3 — `response.incomplete`

```text
$ npx vitest run tests/codebuddy/providers/provider-chatgpt-responses.test.ts -t "incomplete" --reporter=verbose
Test Files  1 failed (1)
Tests  2 failed | 59 skipped (61)
```

Après correction :

```text
Test Files  1 passed (1)
Tests  2 passed | 59 skipped (61)
```

### D4 — recherche xAI omise

```text
$ npx vitest run tests/codebuddy/providers/provider-openai-compat.test.ts -t "search" --reporter=verbose
Test Files  1 failed (1)
Tests  2 failed | 5 skipped (7)
```

Après correction :

```text
Test Files  1 passed (1)
Tests  2 passed | 5 skipped (7)
```

### D5 — remap de modèle

```text
$ npx vitest run tests/codebuddy/providers/provider-chatgpt-responses.test.ts -t "proactive remap" --reporter=verbose
Test Files  1 failed (1)
Tests  1 failed | 60 skipped (61)
```

Après correction :

```text
Test Files  1 passed (1)
Tests  1 passed | 60 skipped (61)
```

### D6 — choix et itérateur vides

```text
$ npx vitest run tests/codebuddy/providers/provider-openai-compat.test.ts -t "empty" --reporter=verbose
Test Files  1 failed (1)
Tests  2 failed | 7 skipped (9)
```

Après correction :

```text
Test Files  1 passed (1)
Tests  2 passed | 7 skipped (9)
```

## Vérifications finales

```text
$ npx vitest run tests/codebuddy/ tests/providers/ --reporter=dot
Test Files  37 passed (37)
Tests  522 passed (522)

$ npx vitest run tests/codebuddy/providers/provider-chatgpt-responses.test.ts tests/codebuddy/providers/provider-openai-compat.test.ts --reporter=dot
Test Files  2 passed (2)
Tests  70 passed (70)

$ npm run typecheck
Process exited with code 0

$ npx eslint src/codebuddy/client.ts src/codebuddy/providers/provider-chatgpt-responses.ts src/codebuddy/providers/provider-openai-compat.ts tests/codebuddy/providers/provider-chatgpt-responses.test.ts tests/codebuddy/providers/provider-openai-compat.test.ts
Process exited with code 0
```

`git diff --check` est passé avant chaque commit. Six commits thématiques
`fix(providers): …` ont été créés avec des `git add` nominatifs ; aucun push,
reset, prune ou ajout global n’a été effectué.
