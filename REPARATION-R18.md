# Réparation R18 — fournisseurs Gemini

Date : 2026-09-02
Branche : `fix/repar-gemini-2026-09-02`
Base observée : `0f841d59a`
Audit source : `AUDIT-A-REPARER.md`

## État initial

Le rapport est créé avant toute modification de code, conformément à la mission.
Le worktree comportait déjà les non-suivis `AUDIT-A-REPARER.md` et `node_modules`.
`docs/FABLE5-CODEX-COORDINATION.md` a été lu mais n’est pas modifié, conformément
à l’interdiction explicite de la mission.

## Périmètre et méthode

Périmètre : `provider-gemini-native.ts`, `provider-gemini-cli.ts`,
`provider-agy-cli.ts`, leurs tests et les contrats d’exécution directement cités.
Les tests utiliseront uniquement de faux flux et de faux processus ; aucun réseau
et aucun binaire `gemini`/`agy` réel ne seront sollicités.

Chaque D sera d’abord vérifié contre le code et le contrat de
`provider-interface.ts`. Un D infirmé sera signalé avec son chemin et ne sera pas
corrigé par hypothèse.

## Vérifications et correctifs

| D | Vérification au code | Verdict | Correctif / preuve |
|---|---|---|---|
| D1 | `provider-gemini-native.ts:1001-1023` émettait le motif mappé, puis `:1056-1067` émettait toujours `stop`. Le contrat `provider-interface.ts:24-37` expose le type OpenAI sans `error`. Le commit `54bee9fd8` n’avait corrigé que l’absence de `finishReason` et les replis après émission. | CONFIRMÉ | Corrigé : un motif terminal est mémorisé, émis une fois après le footer ; la fin sans motif conserve le `stop` historique mais est avertie. |
| D2 | `provider-gemini-cli.ts:318-324` journalisait l’événement `error` sans état terminal ni exception ; `:325-340` acceptait ensuite `result` et émettait `stop`. | CONFIRMÉ | Corrigé : erreur terminale, arrêt de lecture, rejet du générateur et suppression des `result` déjà en file. |
| D3 | `provider-gemini-cli.ts:518-523` marquait `killed` pour la taille, `:509-513` pour le timeout, mais `:535` ne rejetait que si `killed && code !== 0`; un code `0` résolvait donc la sortie partielle. | CONFIRMÉ | Corrigé : tout `killed` est rejeté, quel que soit le code de sortie, avec message timeout ou stdout dépassé. |
| D4 | `provider-gemini-native.ts:574-610` retentait deux fois puis renvoyait un message assistant inventé avec `finish_reason: 'stop'` au lieu de lever. | CONFIRMÉ | Corrigé : `Gemini malformed function call retries exhausted` est levée après épuisement. |
| D5 | `provider-gemini-native.ts:623-645` transformait `parts` vide en phrase française fabriquée et conservait un succès (`finishReason || 'stop'`). | CONFIRMÉ | Corrigé : `Gemini returned empty content parts` est levée après journalisation d’erreur. |

Le troisième fournisseur relu ne porte aucun des cinq D :
`provider-agy-cli.ts:89-100` rejette les sorties non nulles et vides en mode
non-streaming ; `:116-159` conserve les erreurs de spawn, timeout, annulation et
troncature, et n’émet `stop` qu’après une sortie non vide et un code nul.

## Preuve rouge → vert

Avant modification de la production :

```text
npx vitest run tests/codebuddy/providers/provider-gemini-cli.test.ts tests/codebuddy/providers/gemini-stream-integrity.test.ts
2 fichiers en échec ; 6 tests en échec (D1, D2, D3×2, D4, D5)
```

Après correction :

```text
npx vitest run tests/codebuddy/providers/provider-gemini-cli.test.ts tests/codebuddy/providers/gemini-stream-integrity.test.ts
2 fichiers passés ; 32 tests passés

npx vitest run tests/codebuddy/providers/
10 fichiers passés ; 125 tests passés

npx vitest run tests/codebuddy/
20 fichiers passés ; 254 tests passés
```

Les tests utilisent uniquement `fetch` simulé, `ReadableStream` simulé et le
mock de `child_process.spawn` existant. Le timeout et la taille testent
explicitement une fermeture simulée avec le code `0`; aucun binaire ou réseau
réel n’est utilisé.

## Correctifs livrés

- D1 : le motif Gemini est mémorisé et émis une seule fois dans le chunk
  terminal, après le footer de grounding ; `MAX_TOKENS` devient `length` et
  `SAFETY`/`RECITATION` deviennent `content_filter` sans `stop` contradictoire.
- D2 : un événement JSONL `error` devient une erreur terminale, arrête la
  lecture et empêche tout `result` déjà en file d’émettre `stop`.
- D3 : tout processus marqué `killed` est rejeté, indépendamment de son code de
  sortie ; timeout et troncature ont leurs messages explicites.
- D4 : l’épuisement des deux reprises `MALFORMED_FUNCTION_CALL` lève
  `Gemini malformed function call retries exhausted`.
- D5 : des `parts` vides journalisent une erreur et lèvent
  `Gemini returned empty content parts`; aucun texte artificiel n’est produit.

## Preuves

Vérifications supplémentaires : `npm run typecheck` exit 0 (typecheck racine et
Darkstar) ; `npx eslint` sur les trois providers et les deux fichiers de tests
exit 0, avec 5 warnings `any` préexistants et 0 erreur ; `git diff --check`
exit 0. Le commit final est celui créé sur la branche indiquée ci-dessus ; aucun
push n’a été effectué.
